/**
 * Steps — an ordered process where the sequence is the point.
 * A connector runs behind the numbers so the eye follows the order.
 */
export function renderSteps(block, t) {
  const items = block.steps.map((s, i) => `
  <li class="step-item">
    <div class="step-num">${i + 1}</div>
    <div class="step-body">
      <h4>${s.title}</h4>
      ${s.description ? `<p>${s.description}</p>` : ""}
    </div>
  </li>`).join("");

  return `
<div class="steps-block">
  ${block.title ? `<h3 class="block-title">${block.title}</h3>` : ""}
  <ol class="step-list">${items}</ol>
</div>`;
}

export function stepsCss(t) {
  return `
.steps-block { margin-bottom: 22px; break-inside: avoid; }
.step-list { list-style: none; position: relative; display: flex; flex-direction: column; gap: 16px; }
.step-list::before { content: ""; position: absolute; left: 15px; top: 16px; bottom: 16px;
  width: 2px; background: ${t.accentBorder}; }
.step-item { display: flex; align-items: flex-start; gap: 16px; position: relative; }
.step-num { width: 32px; height: 32px; border-radius: 50%; background: ${t.accent}; color: #fff;
  font-family: '${t.headingFont}', sans-serif; font-size: 13px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  box-shadow: 0 0 0 4px ${t.bg}; position: relative; z-index: 1; }
.step-body { padding-top: 4px; }
.step-body h4 { font-family: '${t.headingFont}', sans-serif; font-size: 13.5px; font-weight: 700;
  color: ${t.bodyText}; margin-bottom: 4px; }
.step-body p { font-size: 12.5px; line-height: 1.65; color: ${t.mutedText}; }
`;
}
