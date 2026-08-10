/**
 * Paragraph block — single text block with proper line-height.
 */
export function renderParagraph(block, t) {
  return `<div class="paragraph-block"><p>${block.text}</p></div>`;
}

export function paragraphCss(t) {
  return `
.paragraph-block p { font-size: 14px; line-height: 1.85; color: ${t.bodyText}; margin-bottom: 16px; }
`;
}
