/**
 * Planner Agent — takes a user topic and produces a document outline.
 *
 * Output: Array of section specs. Each spec tells the Writer Agent exactly
 * what to write, with target block types and word counts.
 *
 * The planner does NOT write content — only structure.
 */

import { getModel } from "../../utils/model.js";
import { extractJson } from "../schemas/document.schema.js";
import { bus } from "../events/bus.js";

const SYSTEM_PROMPT = `You are a document planner. Given a topic, create a structured outline for a professional document.

You MUST respond with a single JSON object — no markdown, no prose.

Return this exact structure:
{
  "title": "Document Title",
  "subtitle": "One-line description",
  "sections": [
    {
      "id": "s1",
      "name": "Section Name",
      "description": "Brief description of what this section covers",
      "blockTypes": ["heading", "paragraph", "bullets"],
      "targetWordCount": 200
    }
  ]
}

RULES:
- Create 5-10 sections appropriate for the topic.
- For technical topics: include sections for architecture (diagram), API endpoints (api_table), database schema (schema), code examples (code), risks (risk_matrix), requirements (prd), and roadmap (timeline).
- For business topics: include stats, comparison tables, decision logs, quotes, timelines.
- Every outline MUST include: an introduction (text), a conclusion, and at least one visual section (stats, diagram, table, or timeline).
- blockTypes must be chosen from: heading, paragraph, bullets, stats, table, mermaid, code, api_table, schema, risk_matrix, decision_log, prd, quote, timeline, callout
- id must be unique: s1, s2, s3, etc.
- targetWordCount: 100-400 words per section.
- Start JSON with { — no fences.`;

/**
 * @param {string} topic
 * @param {string} [jobId]
 * @returns {Promise<{ title: string, subtitle: string, sections: object[] }>}
 */
export async function plan(topic, jobId = "") {
  bus.emit("planner.started", { jobId, topic });

  const llm = getModel("pdf");
  const response = await llm.invoke([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user",   content: `Create a document outline for: ${topic}` },
  ]);

  const raw = response?.content?.trim() ?? "";
  const parsed = extractJson(raw);

  if (!parsed || !parsed.sections || !Array.isArray(parsed.sections)) {
    throw new Error("Planner returned invalid outline JSON");
  }

  bus.emit("planner.finished", { jobId, outline: parsed.sections.length });
  return parsed;
}
