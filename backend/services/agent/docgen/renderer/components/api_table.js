/**
 * REST API endpoint reference table.
 */

const METHOD_COLORS = {
  GET:    { bg: "#DCFCE7", text: "#166534", border: "#BBF7D0" },
  POST:   { bg: "#DBEAFE", text: "#1E40AF", border: "#BFDBFE" },
  PUT:    { bg: "#FEF9C3", text: "#854D0E", border: "#FDE68A" },
  PATCH:  { bg: "#FFEDD5", text: "#9A3412", border: "#FED7AA" },
  DELETE: { bg: "#FEE2E2", text: "#991B1B", border: "#FECACA" },
};

export function renderApiTable(block, t) {
  const rows = block.endpoints.map((ep) => {
    const mc = METHOD_COLORS[ep.method] ?? METHOD_COLORS.GET;
    return `
<tr>
  <td><span class="method-badge" style="background:${mc.bg};color:${mc.text};border-color:${mc.border};">${ep.method}</span></td>
  <td><span class="api-path">${ep.path}</span></td>
  <td>${ep.description}</td>
  <td class="auth-icon">${ep.auth ? "🔒" : "🌐"}</td>
  <td><span class="api-status-badge status-${ep.status}">${ep.status}</span></td>
</tr>`;
  }).join("");

  return `
<div class="api-block">
  ${block.title ? `<h3 class="block-title">${block.title}</h3>` : ""}
  <table class="api-table">
    <thead><tr><th>Method</th><th>Endpoint</th><th>Description</th><th>Auth</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

export function apiTableCss(t) {
  return `
.api-block { margin-bottom: 24px; }
.api-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.api-table th { background: #0F172A; color: #94A3B8; font-weight: 600; padding: 10px 14px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
.api-table th:first-child { border-radius: ${t.borderRadius} 0 0 0; }
.api-table th:last-child  { border-radius: 0 ${t.borderRadius} 0 0; }
.api-table td { padding: 12px 14px; color: ${t.bodyText}; border-bottom: 1px solid ${t.cardAlt}; vertical-align: middle; }
.api-table tr:last-child td { border-bottom: none; }
.api-table tr:nth-child(even) td { background: ${t.cardBg}; }
.method-badge { display: inline-block; font-family: '${t.monoFont}', monospace; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 4px; border: 1px solid; letter-spacing: .04em; }
.api-path { font-family: '${t.monoFont}', monospace; font-size: 12px; color: ${t.bodyText}; }
.api-status-badge { display: inline-block; font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 10px; }
.status-stable     { background: #DCFCE7; color: #166534; }
.status-beta       { background: #FEF9C3; color: #854D0E; }
.status-deprecated { background: #FEE2E2; color: #991B1B; }
.auth-icon { font-size: 13px; }
`;
}
