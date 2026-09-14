/**
 * Export Manager — unified interface for all export formats.
 *
 * Usage:
 *   const buffer = await exportManager.export({ type: "pdf", document: doc, html });
 */

import { exportPdf }      from "./pdf.js";
import { exportPptx }     from "./pptx.js";
import { exportMarkdown }  from "./markdown.js";

const exporters = {
  pdf:      async ({ html, jobId })       => exportPdf(html, jobId),
  pptx:     async ({ document, jobId })   => exportPptx({ document, jobId }),
  markdown: ({ document, jobId })         => exportMarkdown(document, jobId),
};

/** Formats that render from the document tree and need no HTML pass. */
export const HTML_FREE_FORMATS = new Set(["pptx", "markdown"]);

/**
 * @param {{ type: string, document?: object, html?: string, jobId?: string }} opts
 * @returns {Promise<Buffer>}
 */
export async function exportDocument(opts) {
  const { type = "pdf", ...rest } = opts;
  const handler = exporters[type];
  if (!handler) throw new Error(`Unknown export type: ${type}. Available: ${Object.keys(exporters).join(", ")}`);
  return handler(rest);
}

/** List of supported export formats */
export const SUPPORTED_FORMATS = Object.keys(exporters);
