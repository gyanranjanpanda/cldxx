import { escHtml } from "../utils.js";

/**
 * Code block with syntax highlighting (Prism.js) and terminal-style header.
 */
export function renderCode(block, t) {
  const safeCode = escHtml(block.code);
  const lang = block.language || "text";

  return `
<div class="code-block-outer">
  ${block.title ? `<h3 class="block-title">${block.title}</h3>` : ""}
  ${block.description ? `<p class="code-description">${block.description}</p>` : ""}
  <div class="code-block-wrap">
    <div class="code-header">
      <div class="code-dots">
        <div class="code-dot code-dot-r"></div>
        <div class="code-dot code-dot-y"></div>
        <div class="code-dot code-dot-g"></div>
      </div>
      <span class="code-lang">${escHtml(lang)}</span>
    </div>
    <pre class="code-content"><code class="language-${escHtml(lang)}">${safeCode}</code></pre>
  </div>
</div>`;
}

export function codeCss(t) {
  return `
.code-block-outer { margin-bottom: 24px; }
.code-description { font-size: 13px; color: ${t.mutedText}; margin-bottom: 12px; line-height: 1.6; }
.code-block-wrap { border-radius: 10px; overflow: hidden; border: 1px solid #1E293B; }
.code-header { background: #1E293B; padding: 10px 18px; display: flex; align-items: center; justify-content: space-between; }
.code-lang { font-family: '${t.monoFont}', monospace; font-size: 11px; color: #64748B; text-transform: uppercase; letter-spacing: .06em; }
.code-dots { display: flex; gap: 6px; }
.code-dot { width: 10px; height: 10px; border-radius: 50%; }
.code-dot-r { background: #EF4444; }
.code-dot-y { background: #EAB308; }
.code-dot-g { background: #22C55E; }
pre.code-content {
  background: ${t.codeBg}; color: ${t.codeText}; margin: 0;
  padding: 20px 18px; font-family: '${t.monoFont}', monospace;
  font-size: 12px; line-height: 1.7; overflow-x: auto; white-space: pre;
}
`;
}
