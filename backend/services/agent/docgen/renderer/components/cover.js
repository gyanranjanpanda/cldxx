/**
 * Cover page — full-page dark cover with title, subtitle, decorative circles.
 * @param {object} block
 * @param {import("../themes/index.js").Theme} t
 * @returns {string}
 */
export function renderCover(block, t) {
  const date = block.date || new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const author = block.author || "cldxAI";
  return `
<div class="page cover">
  <div class="cover-circle-1"></div>
  <div class="cover-circle-2"></div>
  <div class="cover-accent-bar"></div>
  <h1>${block.title}</h1>
  ${block.subtitle ? `<p class="cover-subtitle">${block.subtitle}</p>` : ""}
  <p class="cover-meta">${author} &nbsp;·&nbsp; ${date}</p>
</div>`;
}

export function coverCss(t) {
  return `
.cover {
  background: ${t.coverBg}; display: flex; flex-direction: column;
  justify-content: center; align-items: flex-start;
  padding: 60px 64px; height: 297mm; position: relative; overflow: hidden;
}
.cover-accent-bar { width: 64px; height: 6px; background: ${t.accent}; border-radius: 3px; margin-bottom: 32px; }
.cover h1 {
  font-family: '${t.headingFont}', sans-serif; font-size: 44px; font-weight: 800;
  color: ${t.coverText}; line-height: 1.15; margin-bottom: 20px; max-width: 520px;
}
.cover-subtitle { font-size: 18px; color: ${t.coverMuted}; max-width: 480px; line-height: 1.6; margin-bottom: 60px; }
.cover-meta { font-size: 12px; color: #475569; letter-spacing: .05em; text-transform: uppercase; }
.cover-circle-1 { position: absolute; width: 320px; height: 320px; border-radius: 50%; background: ${t.accent}; opacity: .07; top: -80px; right: -80px; }
.cover-circle-2 { position: absolute; width: 180px; height: 180px; border-radius: 50%; background: ${t.accent}; opacity: .05; bottom: 60px; right: 80px; }
`;
}
