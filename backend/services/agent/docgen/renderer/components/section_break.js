/**
 * Section break — a full-bleed page that announces the next part.
 *
 * This is pure rhythm: it carries almost no information, and that is the point.
 * A reader who has just come off four dense pages needs the pause, and it is what
 * makes the document read as designed rather than as a continuous dump.
 */
export function renderSectionBreak(block, t) {
  return `
<div class="page section-break">
  <div class="sb-glow"></div>
  ${block.number ? `<div class="sb-number">${block.number}</div>` : ""}
  <div class="sb-rule"></div>
  <h2>${block.title}</h2>
  ${block.subtitle ? `<p>${block.subtitle}</p>` : ""}
</div>`;
}

export function sectionBreakCss(t) {
  return `
.section-break { background: ${t.coverBg}; display: flex; flex-direction: column;
  justify-content: center; padding: 0 72px; height: 297mm; position: relative; overflow: hidden; }
.sb-glow { position: absolute; width: 460px; height: 460px; border-radius: 50%;
  background: ${t.accent}; opacity: .1; right: -160px; bottom: -160px; }
.sb-number { font-family: '${t.headingFont}', sans-serif; font-size: 96px; font-weight: 800;
  color: ${t.accent}; opacity: .28; line-height: 1; margin-bottom: 6px; }
.sb-rule { width: 52px; height: 4px; background: ${t.accent}; border-radius: 2px; margin-bottom: 22px; }
.section-break h2 { font-family: '${t.headingFont}', sans-serif; font-size: 38px; font-weight: 800;
  color: ${t.coverText}; line-height: 1.2; max-width: 480px; }
.section-break p { font-size: 15px; color: ${t.coverMuted}; margin-top: 14px; max-width: 420px; line-height: 1.6; }
`;
}
