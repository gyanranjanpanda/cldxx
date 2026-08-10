/**
 * Writer Agent — takes a section spec from the Planner and produces flat blocks.
 *
 * Each section is written INDEPENDENTLY, enabling parallel execution with Promise.all().
 * The writer returns an array of blocks for a single section.
 */

import { getModel }    from "../../utils/model.js";
import { extractJson } from "../schemas/document.schema.js";
import { bus }         from "../events/bus.js";

const SYSTEM_PROMPT = `You are a document section writer. Given a section specification, generate the content as a flat array of document blocks.

You MUST respond with a single JSON object — no markdown, no prose.

Return this structure:
{
  "blocks": [
    { "type": "heading", "text": "Section Title", "level": 1 },
    { "type": "paragraph", "text": "Content paragraph..." },
    ...more blocks
  ]
}

AVAILABLE BLOCK TYPES:

heading    — { "type": "heading", "text": "...", "level": 1|2|3 }
paragraph  — { "type": "paragraph", "text": "..." }
bullets    — { "type": "bullets", "title": "..." (optional), "items": ["...", "..."] }
stats      — { "type": "stats", "title": "...", "items": [{ "label": "...", "value": "..." }] }
table      — { "type": "table", "title": "...", "columns": ["..."], "rows": [["..."]] }
mermaid    — { "type": "mermaid", "title": "...", "diagram_type": "flowchart|sequence|er|gantt|class|state", "syntax": "mermaid", "source": "graph TD\\n  A --> B" }
code       — { "type": "code", "title": "...", "language": "javascript", "code": "...", "description": "..." }
api_table  — { "type": "api_table", "title": "...", "endpoints": [{ "method": "GET|POST|PUT|PATCH|DELETE", "path": "/api/...", "description": "...", "auth": true|false, "status": "stable|beta|deprecated" }] }
schema     — { "type": "schema", "title": "...", "tables": [{ "name": "...", "columns": [{ "name": "...", "type": "...", "constraints": "...", "description": "..." }] }] }
risk_matrix— { "type": "risk_matrix", "title": "...", "risks": [{ "name": "...", "likelihood": "low|medium|high", "impact": "low|medium|high", "mitigation": "...", "owner": "..." }] }
decision_log— { "type": "decision_log", "title": "...", "decisions": [{ "id": "ADR-001", "decision": "...", "rationale": "...", "status": "accepted|rejected|pending|superseded", "date": "...", "owner": "..." }] }
prd        — { "type": "prd", "title": "...", "requirements": [{ "id": "REQ-001", "requirement": "...", "priority": "must|should|could|wont", "status": "open|in-progress|done|cancelled", "notes": "..." }] }
quote      — { "type": "quote", "text": "...", "source": "..." }
timeline   — { "type": "timeline", "title": "...", "events": [{ "date": "...", "title": "...", "description": "...", "status": "done|active|upcoming" }] }
callout    — { "type": "callout", "variant": "info|warning|tip|caution|success", "title": "...", "text": "..." }

RULES:
- Always start with a heading block.
- Use the block types specified in the section spec.
- All text must be plain prose — no HTML, no markdown symbols.
- Mermaid source must be valid Mermaid DSL.
- Code must be real, working examples.
- Return JSON starting with { — no fences.`;

/**
 * Write a single section.
 * @param {{ id: string, name: string, description: string, blockTypes: string[], targetWordCount: number }} spec
 * @param {{ topic: string, style?: string }} context
 * @param {string} [jobId]
 * @returns {Promise<object[]>} — array of blocks
 */
export async function writeSection(spec, context, jobId = "") {
  const llm = getModel("pdf");

  const userPrompt = `Write this section:

Section: ${spec.name}
Description: ${spec.description}
Required block types: ${spec.blockTypes.join(", ")}
Target word count: ${spec.targetWordCount} words
Style: ${context.style || "Professional"}

Document topic: ${context.topic}

Generate blocks for this section only. Start with a heading.`;

  const response = await llm.invoke([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user",   content: userPrompt },
  ]);

  const raw = response?.content?.trim() ?? "";
  const parsed = extractJson(raw);

  if (!parsed?.blocks || !Array.isArray(parsed.blocks)) {
    console.warn(`[writer] Section "${spec.name}" returned invalid blocks — using fallback`);
    return [
      { type: "heading", text: spec.name, level: 1 },
      { type: "paragraph", text: spec.description },
    ];
  }

  bus.emit("writer.section", { jobId, sectionId: spec.id, blockCount: parsed.blocks.length });
  return parsed.blocks;
}

/**
 * Retry wrapper — handles Gemini 429 rate limits with exponential backoff.
 */
async function withRetry(fn, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err?.status === 429 || err?.message?.includes("429");
      if (!isRateLimit || attempt === maxAttempts) throw err;

      // Parse retry delay from error if available, else exponential backoff
      const retryMatch = err.message?.match(/retry in ([\d.]+)s/i);
      const waitSec = retryMatch ? parseFloat(retryMatch[1]) + 2 : Math.pow(2, attempt) * 5;
      console.log(`[writer] Rate limited — waiting ${waitSec.toFixed(0)}s before retry (attempt ${attempt}/${maxAttempts})`);
      await new Promise((r) => setTimeout(r, waitSec * 1000));
    }
  }
}

/**
 * Run promises in batches of `batchSize` with a delay between batches.
 */
async function batchedMap(items, batchSize, delayMs, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    // Delay between batches (not after the last one)
    if (i + batchSize < items.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return results;
}

/**
 * Write ALL sections with rate-limit-safe batched concurrency.
 * Gemini free tier: 5 RPM → we send 3 at a time with 15s gaps.
 * Gemini paid tier: much higher limits → batches fly through with minimal delay.
 *
 * @param {object[]} sections — array of section specs from planner
 * @param {{ topic: string, style?: string }} context
 * @param {string} [jobId]
 * @returns {Promise<object[]>} — flat array of all blocks
 */
export async function writeAllSections(sections, context, jobId = "") {
  bus.emit("writer.started", { jobId, sectionCount: sections.length });

  const BATCH_SIZE = 3;
  const BATCH_DELAY_MS = 15000; // 15s between batches to respect free-tier RPM

  const results = await batchedMap(
    sections,
    BATCH_SIZE,
    BATCH_DELAY_MS,
    (spec) => withRetry(() => writeSection(spec, context, jobId)),
  );

  const allBlocks = results.flat();
  bus.emit("writer.finished", { jobId, blockCount: allBlocks.length });
  return allBlocks;
}
