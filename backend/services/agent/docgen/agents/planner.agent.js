/**
 * Planner Agent — turns a topic into a document outline.
 *
 * The planner commits to a LAYOUT per section before a single word is written.
 * That ordering is the whole point: when composition is chosen first, the writer
 * is writing *into* a shape and can be held to that shape's word budget. When
 * content came first (the old behaviour) every section defaulted to prose and
 * bullets, and the renderer had nothing to work with but a column of text.
 *
 * The planner does NOT write content — only structure.
 */

import { getModel, invokePdfModel } from "../../utils/model.js";
import { extractJson }   from "../schemas/document.schema.js";
import { layoutCatalogue, enforceRhythm, LAYOUTS } from "../design/layouts.js";
import { bus }           from "../events/bus.js";

function systemPrompt(format) {
  const isDeck = format === "pptx";

  return `You are a document planner. Given a topic, design the STRUCTURE of a professional ${isDeck ? "slide deck" : "document"}.

You MUST respond with a single JSON object — no markdown, no prose.

{
  "title": "${isDeck ? "Deck" : "Document"} Title",
  "subtitle": "One-line description",
  "sections": [
    {
      "id": "s1",
      "name": "Section Name",
      "description": "What this section must establish, in one sentence",
      "layout": "bullets"${isDeck ? ',\n      "notes": "What the presenter says over this slide"' : ""}
    }
  ]
}

AVAILABLE LAYOUTS — pick the one that fits what the section has to DO:
${layoutCatalogue(format)}

RULES:
- Plan ${isDeck ? "8-12 slides" : "6-10 sections"}.
- Choose the layout from the section's JOB, not from habit. A section comparing two
  options is "comparison". A section with real numbers is "metrics" or "chart". A
  section describing how something is wired together is "diagram".
- VARIETY IS MANDATORY: never use the same layout more than twice in the whole
  outline, and never twice in a row. An outline that is mostly "bullets" is a failure.
- At least ONE THIRD of sections must use a visual layout: metrics, chart, diagram,
  timeline, comparison, steps, or table.
- Only choose "chart" or "metrics" when the topic genuinely has quantities. Do not
  invent statistics to justify a layout — pick a different layout instead.
- Only choose "code" for technical topics.
- Use "prose" sparingly — at most twice in the whole outline.
- "quote" is a rhythm device: at most one, never first or last.
- id must be unique: s1, s2, s3, …${isDeck ? "\n- notes: 2-3 sentences of speaker notes per slide." : ""}
- Start JSON with { — no fences.`;
}

/**
 * @param {string} topic
 * @param {{ jobId?: string, format?: "pdf"|"pptx", style?: string }} [opts]
 * @returns {Promise<{ title: string, subtitle: string, sections: object[] }>}
 */
export async function plan(topic, opts = {}) {
  const { jobId = "", format = "pdf", style = "Professional", sovereign = false, modelState = {} } = opts;
  bus.emit("planner.started", { jobId, topic, format });

  const messages = [
    { role: "system", content: systemPrompt(format) },
    { role: "user",   content: `Create an outline for: ${topic}\n\nTone: ${style}` },
  ];
  const response = format === "pdf" && !sovereign
    ? await invokePdfModel({ ...modelState, sovereign }, messages)
    : await getModel(format === "pptx" ? "ppt" : "pdf", { sovereign }).invoke(messages);

  const parsed = extractJson(response.text ?? response.content ?? "");

  const usableSections = Array.isArray(parsed?.sections)
    ? parsed.sections.filter((section) => typeof section?.name === "string" && section.name.trim())
    : [];
  if (!usableSections.length) {
    throw Object.assign(new Error("Planner returned an invalid outline"), { code: "PDF_PLANNER_OUTPUT" });
  }

  // Drop layouts the model invented, then enforce rhythm structurally. The prompt
  // asks for variety; this guarantees it even when the model ignores the ask.
  const cleaned = usableSections.map((s, i) => ({
    ...s,
    id:     `s${i + 1}`,
    name:   s.name.trim().slice(0, 300),
    description: typeof s.description === "string" ? s.description.slice(0, 4000) : s.name,
    layout: LAYOUTS[s.layout] && !LAYOUTS[s.layout].structural ? s.layout : "bullets",
  }));

  const { sections, changes } = enforceRhythm(cleaned);
  if (changes.length) console.log(`[planner] Rhythm corrections: ${changes.join("; ")}`);

  bus.emit("planner.finished", {
    jobId,
    sections: sections.length,
    layouts: sections.map((s) => s.layout),
    corrections: changes,
  });

  const title = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title : topic;
  const subtitle = typeof parsed.subtitle === "string" ? parsed.subtitle : "";
  return { title: title.slice(0, 300), subtitle: subtitle.slice(0, 300), sections };
}
