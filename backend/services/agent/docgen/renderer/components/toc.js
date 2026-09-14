/**
 * TOC — built from composed sections, with real page numbers.
 *
 * The page numbers can't be known at render time, so each row carries a
 * `data-toc-target` and the paginator fills the number in once pages actually
 * exist. A table of contents whose numbers are guesses is worse than none.
 */
export function renderToc(_block, t, ctx) {
  // Prefer composed sections; fall back to raw headings for uncomposed documents.
  const rows = ctx.sections?.length
    ? ctx.sections
        .filter((s) => s.title && !["cover", "toc", "section_break"].includes(s.layout))
        .map((s) => ({ id: s.id, title: s.title, layout: s.layout }))
    : (ctx.allBlocks || [])
        .filter((b) => b.type === "heading" && (b.level || 1) === 1)
        .map((h, i) => ({ id: h.id ?? `h${i}`, title: h.text, layout: null }));

  if (rows.length === 0) return "";

  const items = rows.map((r, i) => `
<li class="toc-item">
  <span class="toc-index">${String(i + 1).padStart(2, "0")}</span>
  <span class="toc-title">${r.title}</span>
  <span class="toc-dots"></span>
  <span class="toc-page-num" data-toc-target="${r.id}"></span>
</li>`).join("");

  return `
<div class="page toc-page">
  <h2>Contents</h2>
  <div class="toc-divider"></div>
  <ul class="toc-list">${items}</ul>
  <div class="page-footer"><span class="footer-brand">cldxAI</span><span>Contents</span></div>
</div>`;
}

export function tocCss(t) {
  return `
.toc-page { padding: 64px; height: 297mm; display: flex; flex-direction: column; }
.toc-page h2 { font-family: '${t.headingFont}', sans-serif; font-size: 28px; font-weight: 700; color: ${t.bodyText}; margin-bottom: 8px; }
.toc-divider { width: 56px; height: 4px; background: ${t.accent}; border-radius: 2px; margin-bottom: 36px; }
.toc-list { list-style: none; display: flex; flex-direction: column; }
.toc-item { display: flex; align-items: baseline; padding: 11px 0; border-bottom: 1px solid ${t.cardAlt}; }
.toc-index { width: 32px; font-size: 11px; font-weight: 600; color: ${t.accent}; flex-shrink: 0; }
.toc-title { font-size: 14px; color: ${t.bodyText}; }
.toc-dots { flex: 1; border-bottom: 2px dotted ${t.accentBorder}; margin: 0 12px; position: relative; top: -4px; }
.toc-page-num { font-size: 12px; font-weight: 600; color: ${t.mutedText};
  min-width: 20px; text-align: right; font-variant-numeric: tabular-nums; }
`;
}
