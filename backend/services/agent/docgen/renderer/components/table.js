/**
 * Generic data table with striped rows.
 */
export function renderTable(block, t) {
  const headers = block.columns.map((c) => `<th>${c}</th>`).join("");
  const rows = block.rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");

  return `
<div class="table-block">
  ${block.title ? `<h3 class="block-title">${block.title}</h3>` : ""}
  <table class="pdf-table">
    <thead><tr>${headers}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

export function tableCss(t) {
  return `
.table-block { margin-bottom: 24px; }
.pdf-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.pdf-table th { background: ${t.accent}; color: #fff; font-weight: 600; padding: 12px 16px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }
.pdf-table th:first-child { border-radius: ${t.borderRadius} 0 0 0; }
.pdf-table th:last-child  { border-radius: 0 ${t.borderRadius} 0 0; }
.pdf-table td { padding: 11px 16px; color: ${t.bodyText}; border-bottom: 1px solid ${t.cardAlt}; line-height: 1.5; }
.pdf-table tr:nth-child(even) td { background: ${t.cardBg}; }
.pdf-table tr:last-child td { border-bottom: none; }
`;
}
