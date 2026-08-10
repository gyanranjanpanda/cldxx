/**
 * Shared utilities for block renderers.
 */

/** HTML-escape raw strings (code, mermaid source) */
export function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Un-escape Zod-escaped strings back to raw (for Mermaid DSL) */
export function unescHtml(str) {
  return String(str)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

/** Generate page footer */
export function pageFooter(label = "") {
  return `<div class="page-footer"><span class="footer-brand">cldxAI</span><span>${label}</span></div>`;
}
