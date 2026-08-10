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

  return `
<div class="page stats-page">
  <div class="stats-header">
    <h2>${block.title || "Key Metrics"}</h2>
    <div class="stats-header-divider"></div>
  </div>
  <div class="stats-grid">${cards}</div>
</div>`;
}

export function statsCss(t) {
  return `
.stats-page { background: ${t.statBg}; padding: 52px 64px; min-height: 297mm; display: flex; flex-direction: column; }
.stats-header h2 { font-family: '${t.headingFont}', sans-serif; font-size: 24px; font-weight: 700; color: ${t.coverText}; margin-bottom: 8px; }
.stats-header-divider { width: 56px; height: 3px; background: ${t.accent}; border-radius: 2px; margin-bottom: 36px; }
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; }
.stat-card { background: ${t.statCard}; border: 1px solid ${t.accent}; border-radius: 12px; padding: 28px 20px 24px; display: flex; flex-direction: column; align-items: center; gap: 12px; box-shadow: ${t.cardShadow}; }
.stat-value { font-family: '${t.headingFont}', sans-serif; font-size: 42px; font-weight: 800; color: ${t.statValue}; line-height: 1; }
.stat-label { font-size: 12px; color: ${t.coverMuted}; text-align: center; text-transform: uppercase; letter-spacing: .06em; font-weight: 600; }
`;
}
