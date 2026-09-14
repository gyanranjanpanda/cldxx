/**
 * Two-column block — two related idea clusters sitting side by side.
 * Unlike `comparison` these are not adversarial, so there is no spine.
 */
export function renderTwoCol(block, t) {
  const col = (c) => `
  <div class="tc-col">
    <h4>${c.title}</h4>
    ${c.text ? `<p>${c.text}</p>` : ""}
    ${c.items?.length ? `<ul>${c.items.map((i) => `<li>${i}</li>`).join("")}</ul>` : ""}
  </div>`;

  return `
<div class="two-col-block">
  ${block.title ? `<h3 class="block-title">${block.title}</h3>` : ""}
  <div class="tc-grid">${block.columns.map(col).join("")}</div>
</div>`;
}

export function twoColCss(t) {
  return `
.two-col-block { margin-bottom: 22px; break-inside: avoid; }
.tc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; }
.tc-col h4 { font-family: '${t.headingFont}', sans-serif; font-size: 14px; font-weight: 700;
  color: ${t.bodyText}; margin-bottom: 9px; padding-bottom: 8px; border-bottom: 2px solid ${t.accent}; }
.tc-col p { font-size: 12.5px; line-height: 1.7; color: ${t.bodyText}; margin-bottom: 9px; }
.tc-col ul { list-style: none; display: flex; flex-direction: column; gap: 7px; }
.tc-col li { font-size: 12.5px; line-height: 1.55; color: ${t.bodyText}; padding-left: 14px; position: relative; }
.tc-col li::before { content: ""; position: absolute; left: 0; top: 6px; width: 5px; height: 5px;
  border-radius: 50%; background: ${t.accent}; }
`;
}
