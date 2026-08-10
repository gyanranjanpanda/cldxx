/**
 * Section heading — H1, H2, or H3 with accent bar.
 */
export function renderHeading(block, t) {
  const level = block.level || 1;
  const tag = `h${level}`;
  const id = block.id || block.text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `
<div class="section-header section-header-${level}" id="${id}">
  <div class="section-accent"></div>
  <${tag}>${block.text}</${tag}>
</div>`;
}

export function headingCss(t) {
  return `
.section-header { display: flex; align-items: center; gap: 16px; margin-bottom: 28px; margin-top: 8px; }
.section-accent { width: 6px; height: 38px; background: ${t.accent}; border-radius: 3px; flex-shrink: 0; }
.section-header h1 { font-family: '${t.headingFont}', sans-serif; font-size: 26px; font-weight: 700; color: ${t.bodyText}; }
.section-header h2 { font-family: '${t.headingFont}', sans-serif; font-size: 22px; font-weight: 700; color: ${t.bodyText}; }
.section-header h3 { font-family: '${t.headingFont}', sans-serif; font-size: 18px; font-weight: 600; color: ${t.bodyText}; }
.section-header-2 .section-accent { height: 30px; }
.section-header-3 .section-accent { height: 24px; width: 4px; }
`;
}
