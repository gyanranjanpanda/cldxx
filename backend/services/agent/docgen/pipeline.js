/**
 * Document Generation Pipeline — orchestrates the full flow:
 *
 *   Planner → Writer (parallel) → Validator → Normalizer → Intelligence → Renderer → Exporter
 *
 * This is the single entry point for document generation.
 * The pdf.agent.js becomes a thin wrapper that calls this.
 */

import { plan }             from "./agents/planner.agent.js";
import { writeAllSections } from "./agents/writer.agent.js";
import { validate }         from "./pipeline/validator.js";
import { normalize }        from "./pipeline/normalizer.js";
import { enhance }          from "./pipeline/intelligence.js";
import { renderDocument }   from "./renderer/render.js";
import { exportDocument }   from "./exporters/index.js";
import { SCHEMA_VERSION }   from "./schemas/document.schema.js";
import { bus }              from "./events/bus.js";

/**
 * @param {{ topic: string, theme?: string, format?: string, style?: string, jobId?: string }} opts
 * @returns {Promise<{ buffer: Buffer, doc: object, meta: { pages: number, format: string, title: string } }>}
 */
export async function generateDocument(opts) {
  const {
    topic,
    theme  = "professional",
    format = "pdf",
    style  = "Professional",
    jobId  = `doc-${Date.now()}`,
  } = opts;

  // ── 1. Plan ─────────────────────────────────────────────────────────────
  const outline = await plan(topic, jobId);

  // ── 2. Write (parallel) ─────────────────────────────────────────────────
  const blocks = await writeAllSections(
    outline.sections,
    { topic, style },
    jobId,
  );

  // ── 3. Assemble raw document ────────────────────────────────────────────
  const rawDoc = {
    version: SCHEMA_VERSION,
    meta: {
      title:   outline.title,
      author:  "cldxAI",
      theme,
      subject: outline.subtitle,
    },
    blocks: [
      { type: "cover", title: outline.title, subtitle: outline.subtitle },
      { type: "toc" },
      ...blocks,
      // If no conclusion was written, add a minimal one
      ...(blocks.some((b) => b.type === "conclusion") ? [] : [{
        type: "conclusion",
        title: "Conclusion",
        points: ["Refer to the sections above for detailed analysis."],
      }]),
    ],
  };

  // ── 4. Validate ─────────────────────────────────────────────────────────
  const validation = validate(rawDoc, jobId);
  let doc;

  if (validation.doc) {
    doc = validation.doc;
  } else {
    // Soft-fail: strip blocks that failed validation, keep the rest
    console.warn(`[pipeline] Validation failed: ${validation.error}`);
    console.warn("[pipeline] Attempting block-level recovery...");

    const { Block } = await import("./schemas/document.schema.js");
    const safeBlocks = rawDoc.blocks.filter((b) => Block.safeParse(b).success);

    if (safeBlocks.length < 3) {
      throw new Error(`Document validation failed with too few valid blocks: ${validation.error}`);
    }

    const recoveredDoc = { ...rawDoc, blocks: safeBlocks };
    const revalidation = validate(recoveredDoc, jobId);
    if (!revalidation.doc) {
      throw new Error(`Document recovery failed: ${revalidation.error}`);
    }
    doc = revalidation.doc;
    console.log(`[pipeline] Recovered ${safeBlocks.length}/${rawDoc.blocks.length} blocks`);
  }

  // ── 5. Normalize ────────────────────────────────────────────────────────
  const normalized = normalize(doc, jobId);
  doc = normalized.doc;

  // ── 6. Intelligence ─────────────────────────────────────────────────────
  const enhanced = enhance(doc, jobId);
  doc = enhanced.doc;

  // ── 7. Render ───────────────────────────────────────────────────────────
  bus.emit("render.started", { jobId });
  const html = renderDocument(doc);
  bus.emit("render.finished", { jobId, htmlSize: html.length });

  // ── 8. Export ───────────────────────────────────────────────────────────
  const buffer = await exportDocument({
    type: format,
    html,
    document: doc,
    jobId,
  });

  return {
    buffer,
    doc,
    meta: {
      pages: enhanced.suggestions.find((s) => s.startsWith("Estimated"))?.match(/\d+/)?.[0] ?? "?",
      format,
      title: doc.meta.title,
    },
  };
}
