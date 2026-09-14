/**
 * Document Generation Pipeline — the single entry point for both formats.
 *
 *   Planner → Writer → Validator → Normalizer → Composer → Intelligence → Renderer → Exporter
 *              (layout-aware)                    (new)
 *
 * The planner commits to a layout per section, the writer writes into it under a
 * word budget, and the composer groups the resulting blocks back into laid-out
 * sections. PDF renders those sections to HTML and paginates by measurement;
 * PPTX draws them straight to slides. Same tree, two media.
 */

import { plan }             from "./agents/planner.agent.js";
import { writeAllSections } from "./agents/writer.agent.js";
import { validate }         from "./pipeline/validator.js";
import { normalize }        from "./pipeline/normalizer.js";
import { compose }          from "./pipeline/composer.js";
import { enhance }          from "./pipeline/intelligence.js";
import { renderDocument }   from "./renderer/render.js";
import { exportDocument, HTML_FREE_FORMATS } from "./exporters/index.js";
import { SCHEMA_VERSION }   from "./schemas/document.schema.js";
import { bus }              from "./events/bus.js";

/** Normalize the caller's format string to what the exporters register. */
const FORMAT_ALIASES = { ppt: "pptx", pptx: "pptx", pdf: "pdf", markdown: "markdown", md: "markdown" };

/**
 * @param {{ topic: string, theme?: string, format?: string, style?: string, jobId?: string }} opts
 * @returns {Promise<{ buffer: Buffer, doc: object, meta: { pages: number|string, format: string, title: string, sections: number } }>}
 */
export async function generateDocument(opts) {
  const {
    topic,
    theme  = "professional",
    style  = "Professional",
    jobId  = `doc-${Date.now()}`,
  } = opts;

  const format = FORMAT_ALIASES[opts.format ?? "pdf"] ?? "pdf";
  // Planning and word budgets differ between a page and a slide.
  const medium = format === "pptx" ? "pptx" : "pdf";

  // ── 1. Plan (layout-first) ──────────────────────────────────────────────
  const outline = await plan(topic, { jobId, format: medium, style });

  // ── 2. Write into those layouts ─────────────────────────────────────────
  const blocks = await writeAllSections(
    outline.sections,
    { topic, style, format: medium },
    jobId,
  );

  // ── 3. Assemble ─────────────────────────────────────────────────────────
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
    // Soft-fail: keep the blocks that pass, drop the ones that don't.
    console.warn(`[pipeline] Validation failed: ${validation.error}`);
    const { Block } = await import("./schemas/document.schema.js");
    const safeBlocks = rawDoc.blocks.filter((b) => Block.safeParse(b).success);

    if (safeBlocks.length < 3) {
      throw new Error(`Document validation failed with too few valid blocks: ${validation.error}`);
    }

    const revalidation = validate({ ...rawDoc, blocks: safeBlocks }, jobId);
    if (!revalidation.doc) throw new Error(`Document recovery failed: ${revalidation.error}`);
    doc = revalidation.doc;
    console.log(`[pipeline] Recovered ${safeBlocks.length}/${rawDoc.blocks.length} blocks`);
  }

  // ── 5. Normalize ────────────────────────────────────────────────────────
  doc = normalize(doc, jobId).doc;

  // ── 6. Intelligence ─────────────────────────────────────────────────────
  const enhanced = enhance(doc, jobId);
  doc = enhanced.doc;

  // ── 7. Compose into laid-out sections ───────────────────────────────────
  doc = compose(doc, outline.sections, { jobId, format: medium }).doc;

  // ── 8. Render (HTML formats only) ───────────────────────────────────────
  let html;
  if (!HTML_FREE_FORMATS.has(format)) {
    bus.emit("render.started", { jobId });
    html = renderDocument(doc);
    bus.emit("render.finished", { jobId, htmlSize: html.length });
  }

  // ── 9. Export ───────────────────────────────────────────────────────────
  const buffer = await exportDocument({ type: format, html, document: doc, jobId });

  return {
    buffer,
    doc,
    meta: {
      // The exporters attach a real count; the estimate is only a fallback.
      pages: buffer.pageCount
        ?? enhanced.suggestions.find((s) => s.startsWith("Estimated"))?.match(/\d+/)?.[0]
        ?? "?",
      format,
      title: doc.meta.title,
      sections: doc.sections?.length ?? 0,
    },
  };
}
