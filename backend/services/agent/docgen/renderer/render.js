/**
 * Document renderer — composes theme + block registry → self-contained HTML.
 *
 * Handles:
 *   - Google Fonts import
 *   - Global CSS reset + page layout
 *   - Per-block CSS collection from registry
 *   - Mermaid.js and Prism.js CDN injection (only when needed)
 *   - Content pages with automatic page breaks
 *   - Full-page blocks (cover, stats, conclusion) vs inline blocks
 */

import { getTheme }                     from "./themes/index.js";
import { renderBlock, collectCss }      from "./registry.js";
import { pageFooter }                   from "./utils.js";

// Blocks that render as their own full page (have internal .page wrapper)
const FULL_PAGE_BLOCKS = new Set(["cover", "stats", "conclusion"]);

/**
 * @param {import("../schemas/document.schema.js").Document} doc
 * @returns {string} Self-contained HTML
 */
export function renderDocument(doc) {
  const theme = getTheme(doc.meta.theme);
  const ctx   = { allBlocks: doc.blocks };

  // Detect which CDN scripts are needed
  const needsMermaid = doc.blocks.some((b) => b.type === "mermaid");
  const needsPrism   = doc.blocks.some((b) => b.type === "code");

  // ── Group inline blocks into content pages ──────────────────────────────
  // Full-page blocks (cover, stats, conclusion) are standalone pages.
  // All other blocks are grouped into content pages with a shared footer.
  const pages = [];
  let currentPageBlocks = [];

  function flushContentPage() {
    if (currentPageBlocks.length === 0) return;
    const innerHtml = currentPageBlocks
      .map((b) => renderBlock(b, theme, ctx))
      .join("\n");
    const pageIndex = pages.length;
    pages.push(`
<div class="page content-page">
  ${innerHtml}
  ${pageFooter(`Page ${pageIndex + 1}`)}
</div>`);
    currentPageBlocks = [];
  }

  for (const block of doc.blocks) {
    if (block.type === "toc") {
      // TOC is always a full page
      flushContentPage();
      pages.push(renderBlock(block, theme, ctx));
    } else if (FULL_PAGE_BLOCKS.has(block.type)) {
      flushContentPage();
      pages.push(renderBlock(block, theme, ctx));
    } else {
      currentPageBlocks.push(block);
      // Start a new page after heading blocks to keep sections visually separate
      if (block.type === "heading" && block.level === 1 && currentPageBlocks.length > 1) {
        // Only break if there's preceding content — don't break on the first heading
        const precedingContent = currentPageBlocks.slice(0, -1);
        const headingBlock = currentPageBlocks[currentPageBlocks.length - 1];
        currentPageBlocks = precedingContent;
        flushContentPage();
        currentPageBlocks = [headingBlock];
      }
    }
  }
  flushContentPage();

  // ── Assemble HTML ───────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${doc.meta.title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=${theme.googleFonts}&display=swap" rel="stylesheet" />
  <style>
${globalCss(theme)}
${collectCss(theme)}
  </style>
  ${needsPrism ? prismScripts() : ""}
  ${needsMermaid ? mermaidScript(theme) : ""}
</head>
<body>
${pages.join("\n")}
</body>
</html>`;
}

// ─── Global CSS ───────────────────────────────────────────────────────────────

function globalCss(t) {
  return `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
@page { size: A4; margin: 0; }

html, body {
  font-family: '${t.bodyFont}', -apple-system, sans-serif;
  font-size: 14px;
  color: ${t.bodyText};
  background: ${t.bg};
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.page {
  width: 210mm;
  min-height: 297mm;
  position: relative;
  overflow: hidden;
  page-break-after: always;
}
.page:last-child { page-break-after: avoid; }

.content-page { padding: 52px 64px 80px; min-height: 297mm; display: flex; flex-direction: column; }

.page-footer {
  position: absolute; bottom: 24px; left: 64px; right: 64px;
  display: flex; align-items: center; justify-content: space-between;
  font-size: 10px; color: ${t.mutedText};
  border-top: 1px solid ${t.cardAlt}; padding-top: 10px;
}
.stats-page .page-footer, .conclusion-page .page-footer { color: rgba(255,255,255,.3); border-top-color: rgba(255,255,255,.1); }
.footer-brand { font-weight: 600; letter-spacing: .04em; }
`;
}

// ─── CDN scripts ──────────────────────────────────────────────────────────────

function prismScripts() {
  const base = "https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0";
  const langs = ["javascript", "typescript", "python", "sql", "bash", "json", "yaml", "java", "go", "rust"];
  return `
  <link rel="stylesheet" href="${base}/themes/prism-tomorrow.min.css" />
  <script src="${base}/prism.min.js"></script>
  ${langs.map((l) => `<script src="${base}/components/prism-${l}.min.js"></script>`).join("\n  ")}`;
}

function mermaidScript(theme) {
  return `
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
    mermaid.initialize({ startOnLoad: true, theme: 'base', themeVariables: { primaryColor: '${theme.accent}', primaryTextColor: '${theme.bodyText}', lineColor: '${theme.mutedText}' } });
  </script>`;
}
