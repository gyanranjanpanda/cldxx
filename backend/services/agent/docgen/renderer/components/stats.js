/**
 * Stats grid — dark background with big value cards.
 * This renders as a FULL PAGE (own page break) since it has a unique bg.
 */
export function renderStats(block, t) {
  const cards = block.items.map((s) => `
<div class="stat-card">
  <span class="stat-value">${s.value}</span>
  <span class="stat-label">${s.label}</span>
</div>`).join("");

  // An exact column count, not auto-fit: four metrics must read as one row of
  // four, never as three-plus-one orphan.
  const cols = Math.min(block.items.length, block.items.length === 4 ? 2 : 3);

  return `
<div class="page stats-page">
  <div class="stats-header">
    <h2>${block.title || "Key Metrics"}</h2>
    <div class="stats-header-divider"></div>
  </div>
  <div class="stats-grid" style="grid-template-columns: repeat(${cols}, 1fr);">${cards}</div>
</div>`;
}

export function statsCss(t) {
  return `
/* Centred, not top-aligned: a metrics page carries four numbers and nothing
   else, so anchoring them to the top leaves two-thirds of the page dead. */
.stats-page { background: ${t.statBg}; padding: 52px 64px; display: flex; flex-direction: column; justify-content: center; }
.stats-header h2 { font-family: '${t.headingFont}', sans-serif; font-size: 24px; font-weight: 700; color: ${t.coverText}; margin-bottom: 8px; }
.stats-header-divider { width: 56px; height: 3px; background: ${t.accent}; border-radius: 2px; margin-bottom: 36px; }
.stats-grid { display: grid; gap: 20px; }
.stat-card { background: ${t.statCard}; border: 1px solid ${t.accent}; border-radius: 12px; padding: 34px 20px 30px; display: flex; flex-direction: column; align-items: center; gap: 12px; box-shadow: ${t.cardShadow}; }
.stat-value { font-family: '${t.headingFont}', sans-serif; font-size: 46px; font-weight: 800; color: ${t.statValue}; line-height: 1; }
.stat-label { font-size: 12px; color: ${t.coverMuted}; text-align: center; text-transform: uppercase; letter-spacing: .06em; font-weight: 600; }
`;
}
