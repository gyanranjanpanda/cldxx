/**
 * Database schema block — renders tables with typed columns.
 */
export function renderSchema(block, t) {
  const tables = block.tables.map((tbl) => {
    const cols = tbl.columns.map((col) => `
<tr>
  <td><span class="col-name">${col.name}</span></td>
  <td><span class="col-type">${col.type}</span></td>
  <td><span class="col-constraint">${col.constraints || "—"}</span></td>
  <td style="font-size:12px;color:${t.mutedText};">${col.description || "—"}</td>
</tr>`).join("");
    return `
<div class="schema-table-wrap">
  <span class="schema-table-name">${tbl.name}</span>
  <table class="schema-table">
    <thead><tr><th>Column</th><th>Type</th><th>Constraints</th><th>Description</th></tr></thead>
    <tbody>${cols}</tbody>
  </table>
</div>`;
  }).join("");

  return `
<div class="schema-block">
  ${block.title ? `<h3 class="block-title">${block.title}</h3>` : ""}
  ${tables}
</div>`;
}

export function schemaCss(t) {
  return `
.schema-block { margin-bottom: 24px; }
.schema-table-wrap { margin-bottom: 28px; }
.schema-table-name { font-family: '${t.monoFont}', monospace; font-size: 14px; font-weight: 700; color: ${t.accent}; background: ${t.accentLight}; border: 1px solid ${t.accentBorder}; padding: 8px 14px; border-radius: ${t.borderRadius} ${t.borderRadius} 0 0; display: inline-block; margin-bottom: -1px; }
.schema-table { width: 100%; border-collapse: collapse; font-size: 12.5px; border: 1px solid ${t.accentBorder}; }
.schema-table th { background: ${t.cardBg}; color: ${t.mutedText}; font-weight: 600; padding: 9px 12px; text-align: left; border-bottom: 2px solid ${t.accentBorder}; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
.schema-table td { padding: 9px 12px; border-bottom: 1px solid ${t.cardAlt}; vertical-align: middle; }
.schema-table tr:last-child td { border-bottom: none; }
.col-name { font-family: '${t.monoFont}', monospace; font-size: 12px; font-weight: 600; color: ${t.bodyText}; }
.col-type { font-family: '${t.monoFont}', monospace; font-size: 11px; color: ${t.accent}; background: ${t.accentLight}; padding: 2px 6px; border-radius: 4px; }
.col-constraint { font-size: 10px; color: ${t.mutedText}; font-style: italic; }
`;
}
