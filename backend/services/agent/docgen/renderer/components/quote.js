/**
 * Quote block — accent-bordered highlight card.
 */
export function renderQuote(block, t) {
  return `
<div class="quote-block">
  <p class="quote-text">&ldquo;${block.text}&rdquo;</p>
  ${block.source ? `<p class="quote-source">— ${block.source}</p>` : ""}
</div>`;
}

export function quoteCss(t) {
  return `
.quote-block { border-left: 5px solid ${t.accent}; padding: 20px 28px; background: ${t.accentLight}; border-radius: 0 ${t.borderRadius} ${t.borderRadius} 0; margin-bottom: 24px; }
.quote-text { font-size: 17px; font-style: italic; color: ${t.bodyText}; line-height: 1.8; margin-bottom: 12px; }
.quote-source { font-size: 12px; font-weight: 600; color: ${t.accent}; text-transform: uppercase; letter-spacing: .06em; }
`;
}
