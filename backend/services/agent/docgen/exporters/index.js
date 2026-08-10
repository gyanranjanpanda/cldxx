/**
 * Export Manager — unified interface for all export formats.
 *
 * Usage:
 *   const buffer = await exportManager.export({ type: "pdf", document: doc, html });
 */

import { exportPdf }      from "./pdf.js";
import { exportMarkdown }  from "./markdown.js";

const exporters = {
  pdf:      async ({ html, jobId }) => exportPdf(html, jobId),
  markdown: ({ document, jobId })   => exportMarkdown(document, jobId),
};

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
