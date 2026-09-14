/**
 * Comparison — two options weighed side by side, with a spine between them.
 * The columns are equal-width on purpose: neither side is visually favoured.
 */
export function renderComparison(block, t) {
  const side = (col, which) => `
  <div class="cmp-col cmp-${which}">
    <div class="cmp-col-head">
      <span class="cmp-marker"></span>
      <h4>${col.title}</h4>
    </div>
    <ul>${col.items.map((i) => `<li>${i}</li>`).join("")}</ul>
  </div>`;

  return `
<div class="comparison-block">
  ${block.title ? `<h3 class="block-title">${block.title}</h3>` : ""}
  <div class="cmp-grid">
    ${side(block.left, "left")}
    <div class="cmp-spine"><span>vs</span></div>
    ${side(block.right, "right")}
  </div>
</div>`;
}

export function comparisonCss(t) {
  return `
.comparison-block { margin-bottom: 22px; break-inside: avoid; }
/* Two self-contained cards with the spine as real negative space between them.
   Butting them together and hiding the inner borders made the pair read as one
   panel with a stray pill floating in it. */
.cmp-grid { display: grid; grid-template-columns: 1fr 44px 1fr; align-items: stretch; position: relative; }
.cmp-col { padding: 20px 22px; background: ${t.cardBg};
  border: 1px solid ${t.accentBorder}; border-radius: ${t.borderRadius}; }
.cmp-right { background: ${t.accentLight}; }
.cmp-col-head { display: flex; align-items: center; gap: 9px; margin-bottom: 13px; }
.cmp-col-head h4 { font-family: '${t.headingFont}', sans-serif; font-size: 14px; font-weight: 700; color: ${t.bodyText}; }
.cmp-marker { width: 8px; height: 8px; border-radius: 2px; background: ${t.accent}; flex-shrink: 0; }
.cmp-right .cmp-marker { background: ${t.mutedText}; }
.cmp-col ul { list-style: none; display: flex; flex-direction: column; gap: 9px; }
.cmp-col li { font-size: 12.5px; line-height: 1.6; color: ${t.bodyText}; padding-left: 15px; position: relative; }
.cmp-col li::before { content: ""; position: absolute; left: 0; top: 7px; width: 5px; height: 5px;
  border-radius: 50%; background: ${t.accent}; opacity: .55; }
.cmp-spine { display: flex; align-items: center; justify-content: center; }
.cmp-spine span { font-size: 9.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
  color: ${t.mutedText}; background: ${t.bg}; border: 1px solid ${t.accentBorder};
  border-radius: 999px; width: 30px; height: 30px;
  display: flex; align-items: center; justify-content: center; }
`;
}
