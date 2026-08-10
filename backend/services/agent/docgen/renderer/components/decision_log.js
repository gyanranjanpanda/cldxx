/**
 * Architecture Decision Record (ADR) log — card-based layout.
 */

const STATUS_COLORS = {
  accepted:   { bg: "#DCFCE7", text: "#166534" },
  rejected:   { bg: "#FEE2E2", text: "#991B1B" },
  pending:    { bg: "#FEF9C3", text: "#854D0E" },
  superseded: { bg: "#F1F5F9", text: "#64748B" },
};

export function renderDecisionLog(block, t) {
  const cards = block.decisions.map((d) => {
    const sc = STATUS_COLORS[d.status] ?? STATUS_COLORS.pending;
    return `
<div class="decision-card">
  <div class="decision-header">
    <span class="decision-id">${d.id}</span>
    <span class="decision-status-badge" style="background:${sc.bg};color:${sc.text};">${d.status.toUpperCase()}</span>
    ${d.date ? `<span class="decision-date">${d.date}</span>` : ""}
  </div>
  <div class="decision-text">${d.decision}</div>
  <div class="decision-rationale">${d.rationale}</div>
  ${d.owner ? `<div class="decision-owner">Owner: ${d.owner}</div>` : ""}
</div>`;
  }).join("");

  return `
<div class="decision-block">
  ${block.title ? `<h3 class="block-title">${block.title}</h3>` : ""}
  ${cards}
</div>`;
}

export function decisionLogCss(t) {
  return `
.decision-block { margin-bottom: 24px; }
.decision-card { border: 1px solid ${t.accentBorder}; border-radius: ${t.borderRadius}; padding: 16px 20px; margin-bottom: 12px; background: ${t.cardBg}; }
.decision-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.decision-id { font-family: '${t.monoFont}', monospace; font-size: 11px; font-weight: 700; color: ${t.accent}; background: ${t.accentLight}; border: 1px solid ${t.accentBorder}; padding: 2px 8px; border-radius: 4px; }
.decision-status-badge { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 10px; text-transform: uppercase; letter-spacing: .05em; }
.decision-date { font-size: 11px; color: ${t.mutedText}; margin-left: auto; }
.decision-text { font-size: 13.5px; font-weight: 600; color: ${t.bodyText}; margin-bottom: 6px; }
.decision-rationale { font-size: 12.5px; color: ${t.mutedText}; line-height: 1.6; }
.decision-owner { font-size: 11px; color: ${t.accent}; margin-top: 8px; font-weight: 600; }
`;
}
