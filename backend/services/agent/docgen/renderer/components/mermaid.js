import { escHtml } from "../utils.js";

/**
 * Mermaid diagram block — rendered client-side by Mermaid.js.
 */
export function renderMermaid(block, t) {
  // Mermaid needs raw DSL — unescape Zod-sanitized strings
  const rawSource = block.source;
  return `
<div class="mermaid-block">
  ${block.title ? `<h3 class="block-title">${block.title}</h3>` : ""}
  <div class="diagram-container">
    <pre class="mermaid">${escHtml(rawSource)}</pre>
  </div>
</div>`;
}

export function mermaidCss(t) {
  return `
.mermaid-block { margin-bottom: 24px; }
.diagram-container { display: flex; justify-content: center; padding: 24px; background: ${t.cardBg}; border: 1px solid ${t.accentBorder}; border-radius: ${t.borderRadius}; overflow: hidden; }
.diagram-container svg { max-width: 100%; height: auto; }
`;
}
