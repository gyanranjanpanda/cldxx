/**
 * PRD / MoSCoW requirements table.
 */

const PRIORITY_COLORS = {
  must:   { bg: "#FEE2E2", text: "#991B1B", label: "MUST" },
  should: { bg: "#FEF9C3", text: "#854D0E", label: "SHOULD" },
  could:  { bg: "#DBEAFE", text: "#1E40AF", label: "COULD" },
  wont:   { bg: "#F1F5F9", text: "#64748B", label: "WON'T" },
};

const STATUS_COLORS = {
  open:          { bg: "#DBEAFE", text: "#1E40AF" },
  "in-progress": { bg: "#FEF9C3", text: "#854D0E" },
  done:          { bg: "#DCFCE7", text: "#166534" },
  cancelled:     { bg: "#F1F5F9", text: "#64748B" },
};

export function renderPrd(block, t) {
  const rows = block.requirements.map((r) => {
    const pc = PRIORITY_COLORS[r.priority] ?? PRIORITY_COLORS.could;
    const sc = STATUS_COLORS[r.status] ?? STATUS_COLORS.open;
    return `
<tr>
  <td><span class="prd-id">${r.id}</span></td>
  <td>
    <div>${r.requirement}</div>
    ${r.notes ? `<div class="prd-notes">${r.notes}</div>` : ""}
  </td>
  <td><span class="prd-priority" style="background:${pc.bg};color:${pc.text};">${pc.label}</span></td>
  <td><span class="prd-status" style="background:${sc.bg};color:${sc.text};">${r.status}</span></td>
</tr>`;
  }).join("");

  return `
<div class="prd-block">
  ${block.title ? `<h3 class="block-title">${block.title}</h3>` : ""}
  <table class="prd-table">
    <thead><tr><th>ID</th><th>Requirement</th><th>Priority</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

export function prdCss(t) {
  return `
.prd-block { margin-bottom: 24px; }
.prd-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.prd-table th { background: #0F172A; color: #94A3B8; font-weight: 600; padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
.prd-table th:first-child { border-radius: ${t.borderRadius} 0 0 0; }
.prd-table th:last-child  { border-radius: 0 ${t.borderRadius} 0 0; }
.prd-table td { padding: 11px 12px; border-bottom: 1px solid ${t.cardAlt}; vertical-align: top; }
.prd-table tr:last-child td { border-bottom: none; }
.prd-id { font-family: '${t.monoFont}', monospace; font-size: 11px; font-weight: 700; color: ${t.accent}; }
.prd-priority { display: inline-block; font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 4px; text-transform: uppercase; letter-spacing: .05em; }
.prd-status { display: inline-block; font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 10px; }
.prd-notes { font-size: 11px; color: ${t.mutedText}; margin-top: 4px; font-style: italic; }
`;
}
