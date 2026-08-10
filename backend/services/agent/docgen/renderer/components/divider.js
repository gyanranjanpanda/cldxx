/**
 * Divider — subtle horizontal separator between blocks.
 */
export function renderDivider(block, t) {
  return `<hr class="block-divider" />`;
}

export function dividerCss(t) {
  return `
.block-divider { border: none; height: 1px; background: ${t.accentBorder}; margin: 28px 0; }
`;
}
