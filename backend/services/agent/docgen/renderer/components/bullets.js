/**
 * Bullets — ordered or unordered list with accent dots.
 */
export function renderBullets(block, t) {
  const cards = block.items.map((item) => `
<div class="bullet-card">
  <div class="bullet-dot"></div>
  <span class="bullet-text">${item}</span>
</div>`).join("");

  return `
<div class="bullets-block">
  ${block.title ? `<h3 class="block-title">${block.title}</h3>` : ""}
  <div class="bullet-list">${cards}</div>
</div>`;
}

export function bulletsCss(t) {
  return `
.block-title { font-family: '${t.headingFont}', sans-serif; font-size: 16px; font-weight: 700; color: ${t.bodyText}; margin-bottom: 14px; }
.bullet-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
.bullet-card { display: flex; align-items: flex-start; gap: 14px; padding: 14px 18px; border-radius: ${t.borderRadius}; border: 1px solid ${t.accentBorder}; }
.bullet-card:nth-child(odd) { background: ${t.cardAlt}; }
.bullet-card:nth-child(even) { background: ${t.cardBg}; border-color: ${t.accentBorder}; }
.bullet-dot { width: 10px; height: 10px; border-radius: 50%; background: ${t.accent}; flex-shrink: 0; margin-top: 4px; }
.bullet-text { font-size: 13.5px; color: ${t.bodyText}; line-height: 1.6; }
`;
}
