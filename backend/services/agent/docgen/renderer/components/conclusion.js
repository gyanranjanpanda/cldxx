/**
 * Conclusion — full-page takeaway section with accent bg.
 */
export function renderConclusion(block, t) {
  const points = block.points.map((p) => `
<div class="conclusion-point">
  <div class="conclusion-dot"></div>
  <span class="conclusion-point-text">${p}</span>
</div>`).join("");

  return `
<div class="page conclusion-page">
  <div class="conclusion-circle"></div>
  <h2>${block.title}</h2>
  <p class="conclusion-subtitle">Key Takeaways</p>
  <div class="conclusion-points">${points}</div>
</div>`;
}

export function conclusionCss(t) {
  return `
.conclusion-page { background: ${t.conclusionBg}; padding: 52px 64px; min-height: 297mm; display: flex; flex-direction: column; justify-content: center; position: relative; overflow: hidden; }
.conclusion-circle { position: absolute; width: 300px; height: 300px; border-radius: 50%; background: rgba(255,255,255,.05); bottom: -60px; right: -60px; }
.conclusion-page h2 { font-family: '${t.headingFont}', sans-serif; font-size: 34px; font-weight: 800; color: #fff; margin-bottom: 8px; }
.conclusion-subtitle { font-size: 13px; color: rgba(255,255,255,.6); text-transform: uppercase; letter-spacing: .08em; font-weight: 600; margin-bottom: 36px; }
.conclusion-points { display: flex; flex-direction: column; gap: 16px; }
.conclusion-point { display: flex; align-items: flex-start; gap: 14px; }
.conclusion-dot { width: 10px; height: 10px; border-radius: 50%; background: #fff; flex-shrink: 0; margin-top: 5px; }
.conclusion-point-text { font-size: 15px; color: #fff; line-height: 1.6; }
`;
}
