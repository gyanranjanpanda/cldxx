/**
 * TOC — auto-generated from heading blocks in the document.
 * The renderer passes the full block list; this component extracts headings.
 * @param {object} _block   — the { type:"toc" } block (no content fields)
 * @param {import("../themes/index.js").Theme} t
 * @param {{ allBlocks: object[] }} ctx — injected context
 * @returns {string}
 */
export function renderToc(_block, t, ctx) {
  const headings = (ctx.allBlocks || []).filter((b) => b.type === "heading");
  if (headings.length === 0) return "";

  const items = headings.map((h, i) => `
<li class="toc-item">
  <span class="toc-index">${String(i + 1).padStart(2, "0")}</span>
  <span class="toc-title">${h.text}</span>
  <span class="toc-dots"></span>
  <span class="toc-badge">H${h.level || 1}</span>
</li>`).join("");

  return `
<div class="page toc-page">
  <h2>Contents</h2>
  <div class="toc-divider"></div>
  <ul class="toc-list">${items}</ul>
  <div class="page-footer"><span class="footer-brand">cldxAI</span><span>Table of Contents</span></div>
</div>`;
}

export function tocCss(t) {
  return `
.toc-page { padding: 64px; height: 297mm; display: flex; flex-direction: column; }
.toc-page h2 { font-family: '${t.headingFont}', sans-serif; font-size: 28px; font-weight: 700; color: ${t.bodyText}; margin-bottom: 8px; }
.toc-divider { width: 56px; height: 4px; background: ${t.accent}; border-radius: 2px; margin-bottom: 36px; }
.toc-list { list-style: none; display: flex; flex-direction: column; }
.toc-item { display: flex; align-items: baseline; padding: 10px 0; border-bottom: 1px solid ${t.cardAlt}; }
.toc-index { width: 32px; font-size: 11px; font-weight: 600; color: ${t.accent}; flex-shrink: 0; }
.toc-title { font-size: 14px; color: ${t.bodyText}; }
.toc-dots { flex: 1; border-bottom: 2px dotted ${t.accentBorder}; margin: 0 12px; position: relative; top: -4px; }
.toc-badge { font-size: 11px; font-weight: 600; color: ${t.mutedText}; background: ${t.cardBg}; border: 1px solid ${t.accentBorder}; padding: 2px 10px; border-radius: 12px; }
`;
}
