/**
 * Writer Agent — writes one section INTO a layout the planner already chose.
 *
 * Two things changed here versus the old writer, and both matter for how the
 * output reads:
 *
 *  1. It is shown ONLY the block types its layout can place. Previously every
 *     block type was on the menu for every section, so the model reached for
 *     heading+paragraph+bullets nearly every time and the document flattened out.
 *
 *  2. It writes to a word BUDGET set by the layout and the medium, and the budget
 *     is enforced in code afterwards rather than merely requested. A slide budget
 *     is a quarter of a page budget, which is why the same document can render as
 *     a readable deck instead of slides full of paragraphs.
 *
 * Sections are independent, so they still run concurrently.
 */

import { getModel }    from "../../utils/model.js";
import { extractJson } from "../schemas/document.schema.js";
import { getLayout, wordBudget } from "../design/layouts.js";
import { bus }         from "../events/bus.js";

// ─── Block reference, one entry per type ──────────────────────────────────────

const BLOCK_SPECS = {
  heading:      `{ "type": "heading", "text": "...", "level": 1 }`,
  paragraph:    `{ "type": "paragraph", "text": "..." }`,
  bullets:      `{ "type": "bullets", "title": "..." (optional), "items": ["...", "..."] }`,
  stats:        `{ "type": "stats", "title": "...", "items": [{ "label": "...", "value": "42%" }] }`,
  table:        `{ "type": "table", "title": "...", "columns": ["..."], "rows": [["..."]] }`,
  mermaid:      `{ "type": "mermaid", "title": "...", "diagram_type": "flowchart|sequence|er|state|class", "source": "graph TD\\n  A[Client] --> B[API]" }`,
  code:         `{ "type": "code", "title": "...", "language": "javascript", "code": "...", "description": "..." }`,
  api_table:    `{ "type": "api_table", "title": "...", "endpoints": [{ "method": "GET", "path": "/api/...", "description": "...", "auth": true, "status": "stable" }] }`,
  schema:       `{ "type": "schema", "title": "...", "tables": [{ "name": "...", "columns": [{ "name": "...", "type": "...", "constraints": "...", "description": "..." }] }] }`,
  risk_matrix:  `{ "type": "risk_matrix", "title": "...", "risks": [{ "name": "...", "likelihood": "low|medium|high", "impact": "low|medium|high", "mitigation": "...", "owner": "..." }] }`,
  decision_log: `{ "type": "decision_log", "title": "...", "decisions": [{ "id": "ADR-001", "decision": "...", "rationale": "...", "status": "accepted", "date": "...", "owner": "..." }] }`,
  prd:          `{ "type": "prd", "title": "...", "requirements": [{ "id": "REQ-001", "requirement": "...", "priority": "must|should|could|wont", "status": "open" }] }`,
  quote:        `{ "type": "quote", "text": "...", "source": "..." }`,
  timeline:     `{ "type": "timeline", "title": "...", "events": [{ "date": "Q1 2026", "title": "...", "description": "...", "status": "done|active|upcoming" }] }`,
  callout:      `{ "type": "callout", "variant": "info|warning|tip|caution|success", "title": "...", "text": "..." }`,
  conclusion:   `{ "type": "conclusion", "title": "...", "points": ["...", "..."] }`,
  chart:        `{ "type": "chart", "chart_type": "column|bar|line|donut|progress", "title": "...", "unit": "%" (optional), "categories": ["Q1","Q2"], "series": [{ "name": "Revenue", "values": [12, 18] }], "takeaway": "The one sentence this chart is making" }`,
  comparison:   `{ "type": "comparison", "title": "...", "left": { "title": "Option A", "items": ["...","..."] }, "right": { "title": "Option B", "items": ["...","..."] } }`,
  two_col:      `{ "type": "two_col", "title": "...", "columns": [{ "title": "...", "text": "..." (optional), "items": ["..."] }, { "title": "...", "items": ["..."] }] }`,
  steps:        `{ "type": "steps", "title": "...", "steps": [{ "title": "...", "description": "..." }] }`,
};

function systemPrompt(layout, budget, format) {
  const specs = layout.blocks
    .map((t) => `${t.padEnd(13)} — ${BLOCK_SPECS[t] ?? ""}`)
    .join("\n");

  return `You write ONE section of a ${format === "pptx" ? "slide deck" : "document"}, into a layout that has already been chosen.

Layout: ${layout.id} — ${layout.intent}
Word budget: ${budget} words TOTAL across the whole section. This is a hard ceiling.

Respond with a single JSON object — no markdown, no prose:
{ "blocks": [ ... ] }

BLOCK TYPES YOU MAY USE (this layout places these and nothing else):
${specs}

RULES:
- Start with the heading block if this layout includes one, then the layout's main block.
- Do NOT exceed the word budget. Write tight. ${format === "pptx"
    ? "This is a SLIDE: fragments, not sentences. Six to nine words per bullet. No paragraphs."
    : "Short sentences. No filler, no throat-clearing, no restating the heading."}
- Never open with "In this section we will…" or "It is important to note that…".
- Every claim must be concrete. Prefer a number, a name or a mechanism over an adjective.
- ${layout.id === "chart"
    ? "The chart needs REAL numbers with a consistent unit. `values` must be parallel to `categories`. Keep it to 8 categories and 4 series at most. Never invent precise-looking statistics you cannot support — if the topic has no quantities, emit bullets instead."
    : "Use only the block types listed above."}
- All text is plain prose — no HTML, no markdown symbols, no emoji.
- Return JSON starting with { — no fences.`;
}

// ─── Budget enforcement ───────────────────────────────────────────────────────

const countWords = (s) => (String(s ?? "").trim().match(/\S+/g) ?? []).length;

/** Total prose words in a block — code and diagram source don't count as prose. */
function blockWords(b) {
  switch (b.type) {
    case "paragraph":  return countWords(b.text);
    case "heading":    return countWords(b.text);
    case "bullets":    return (b.items ?? []).reduce((n, i) => n + countWords(i), 0);
    case "quote":      return countWords(b.text) + countWords(b.source);
    case "callout":    return countWords(b.text) + countWords(b.title);
    case "conclusion": return (b.points ?? []).reduce((n, i) => n + countWords(i), 0);
    case "steps":      return (b.steps ?? []).reduce((n, s) => n + countWords(s.title) + countWords(s.description), 0);
    case "comparison": return [...(b.left?.items ?? []), ...(b.right?.items ?? [])].reduce((n, i) => n + countWords(i), 0);
    case "two_col":    return (b.columns ?? []).reduce((n, c) => n + countWords(c.text) + (c.items ?? []).reduce((m, i) => m + countWords(i), 0), 0);
    case "chart":      return countWords(b.takeaway);
    case "code":       return countWords(b.description);
    default:           return 0;
  }
}

/**
 * Bring a section back under budget by dropping trailing content, never by
 * truncating mid-sentence. Overflow is the single most common way a generated
 * slide ends up unreadable, and the prompt alone does not prevent it.
 */
function trimToBudget(blocks, budget) {
  let total = blocks.reduce((n, b) => n + blockWords(b), 0);
  if (total <= budget * 1.15) return { blocks, trimmed: false };

  const out = blocks.map((b) => ({ ...b }));

  // Shed list items from the back first — they degrade most gracefully.
  for (let i = out.length - 1; i >= 0 && total > budget; i--) {
    const b = out[i];
    const lists = { bullets: "items", conclusion: "points", steps: "steps" };
    const key = lists[b.type];
    if (key && Array.isArray(b[key])) {
      const floor = b.type === "steps" ? 2 : 2;
      while (b[key].length > floor && total > budget) {
        const dropped = b[key].pop();
        total -= b.type === "steps"
          ? countWords(dropped.title) + countWords(dropped.description)
          : countWords(dropped);
      }
    }
  }

  // Then shed whole trailing sentences from paragraphs.
  for (let i = out.length - 1; i >= 0 && total > budget; i--) {
    const b = out[i];
    if (b.type !== "paragraph") continue;
    const sentences = String(b.text).match(/[^.!?]+[.!?]+/g) ?? [b.text];
    while (sentences.length > 1 && total > budget) {
      total -= countWords(sentences.pop());
    }
    b.text = sentences.join(" ").trim();
  }

  return { blocks: out, trimmed: true };
}

// ─── Single section ───────────────────────────────────────────────────────────

/**
 * @param {{ id: string, name: string, description: string, layout: string }} spec
 * @param {{ topic: string, style?: string, format?: "pdf"|"pptx" }} context
 * @param {string} [jobId]
 * @returns {Promise<object[]>}
 */
export async function writeSection(spec, context, jobId = "") {
  const format = context.format ?? "pdf";
  const layout = getLayout(spec.layout);
  const budget = wordBudget(layout.id, format);
  const llm    = getModel("pdf", { sovereign: context.sovereign === true });

  const userPrompt = `Section: ${spec.name}
What it must establish: ${spec.description}
Document topic: ${context.topic}
Tone: ${context.style || "Professional"}

Write this section only.`;

  const response = await llm.invoke([
    { role: "system", content: systemPrompt(layout, budget, format) },
    { role: "user",   content: userPrompt },
  ]);

  const parsed = extractJson(response?.content?.trim() ?? "");

  if (!parsed?.blocks || !Array.isArray(parsed.blocks)) {
    console.warn(`[writer] Section "${spec.name}" returned invalid blocks — using fallback`);
    return [
      { type: "heading", text: spec.name, level: 1 },
      { type: "paragraph", text: spec.description },
    ];
  }

  // Guarantee the section opens with a level-1 heading — the composer cuts
  // sections on those, so a missing one silently merges two sections into one.
  // This holds even for layouts whose prompt omits `heading` (metrics, quote):
  // there the renderer consumes the heading as the page title instead of drawing
  // it, so it costs nothing but keeps section boundaries findable.
  let blocks = parsed.blocks;
  if (blocks[0]?.type !== "heading") {
    blocks = [{ type: "heading", text: spec.name, level: 1 }, ...blocks];
  } else {
    blocks[0].level = 1;
  }

  const { blocks: fitted, trimmed } = trimToBudget(blocks, budget);
  if (trimmed) console.log(`[writer] Trimmed "${spec.name}" to its ${budget}-word ${layout.id} budget`);

  bus.emit("writer.section", {
    jobId, sectionId: spec.id, layout: layout.id, blockCount: fitted.length, trimmed,
  });
  return fitted;
}

// ─── Concurrency ──────────────────────────────────────────────────────────────

/** Retry wrapper — handles provider 429s with backoff. */
async function withRetry(fn, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isRateLimit = err?.status === 429 || err?.message?.includes("429");
      if (!isRateLimit || attempt === maxAttempts) throw err;

      const retryMatch = err.message?.match(/retry in ([\d.]+)s/i);
      const waitSec = retryMatch ? parseFloat(retryMatch[1]) + 2 : 2 ** attempt * 5;
      console.log(`[writer] Rate limited — waiting ${waitSec.toFixed(0)}s (attempt ${attempt}/${maxAttempts})`);
      await new Promise((r) => setTimeout(r, waitSec * 1000));
    }
  }
  throw lastErr;
}

/** Run in batches with a gap between them, to stay inside free-tier RPM. */
async function batchedMap(items, batchSize, delayMs, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    results.push(...await Promise.all(batch.map(fn)));
    if (i + batchSize < items.length) await new Promise((r) => setTimeout(r, delayMs));
  }
  return results;
}

/**
 * Write ALL sections.
 * @param {object[]} sections — section specs from the planner, each carrying a layout
 * @param {{ topic: string, style?: string, format?: "pdf"|"pptx" }} context
 * @param {string} [jobId]
 * @returns {Promise<object[]>} — flat array of blocks
 */
export async function writeAllSections(sections, context, jobId = "") {
  bus.emit("writer.started", { jobId, sectionCount: sections.length });

  const BATCH_SIZE = 3;
  const BATCH_DELAY_MS = 15000;

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
