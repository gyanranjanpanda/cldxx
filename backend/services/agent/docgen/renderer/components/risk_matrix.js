/**
 * Risk matrix — color-coded severity table.
 */

const RISK_SCORE = { low: 1, medium: 2, high: 3 };

function riskColor(likelihood, impact) {
  const score = RISK_SCORE[likelihood] * RISK_SCORE[impact];
  const palette = {
    1: { bg: "#DCFCE7", text: "#166534" },
    2: { bg: "#FEF9C3", text: "#854D0E" },
    3: { bg: "#FFEDD5", text: "#9A3412" },
    4: { bg: "#FEE2E2", text: "#991B1B" },
    6: { bg: "#991B1B", text: "#FFFFFF" },
    9: { bg: "#7F1D1D", text: "#FFFFFF" },
  };
  return palette[score] ?? { bg: "#F1F5F9", text: "#1E293B" };
}

function severityLabel(likelihood, impact) {
  if (likelihood === "high" && impact === "high") return "CRITICAL";
  if (likelihood === "high" || impact === "high") return "HIGH";
  if (likelihood === "medium" || impact === "medium") return "MEDIUM";
  return "LOW";
}

export function renderRiskMatrix(block, t) {
  const rows = block.risks.map((r) => {
    const overall = riskColor(r.likelihood, r.impact);
    return `
<tr>
  <td>
    <div class="risk-name">${r.name}</div>
    ${r.mitigation ? `<div class="risk-mitigation">↳ ${r.mitigation}</div>` : ""}
  </td>
  <td><span class="risk-badge" style="background:${riskColor(r.likelihood, "low").bg};color:${riskColor(r.likelihood, "low").text};">${r.likelihood}</span></td>
  <td><span class="risk-badge" style="background:${riskColor("low", r.impact).bg};color:${riskColor("low", r.impact).text};">${r.impact}</span></td>
  <td><span class="risk-badge" style="background:${overall.bg};color:${overall.text};">${severityLabel(r.likelihood, r.impact)}</span></td>
  <td style="font-size:12px;color:${t.mutedText};">${r.owner || "—"}</td>
</tr>`;
  }).join("");

  return `
<div class="risk-block">
  ${block.title ? `<h3 class="block-title">${block.title}</h3>` : ""}
  <table class="risk-table">
    <thead><tr><th>Risk</th><th>Likelihood</th><th>Impact</th><th>Severity</th><th>Owner</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

export function riskMatrixCss(t) {
  return `
.risk-block { margin-bottom: 24px; }
.risk-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.risk-table th { background: #0F172A; color: #94A3B8; font-weight: 600; padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
.risk-table th:first-child { border-radius: ${t.borderRadius} 0 0 0; }
.risk-table th:last-child  { border-radius: 0 ${t.borderRadius} 0 0; }
.risk-table td { padding: 11px 12px; border-bottom: 1px solid ${t.cardAlt}; vertical-align: middle; }
.risk-table tr:last-child td { border-bottom: none; }
.risk-badge { display: inline-block; font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 4px; text-transform: uppercase; letter-spacing: .05em; }
.risk-name { font-size: 13px; font-weight: 500; color: ${t.bodyText}; }
.risk-mitigation { font-size: 11.5px; color: ${t.mutedText}; margin-top: 4px; }
`;
}
