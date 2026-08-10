/**
 * Callout block — info/warning/tip/caution/success alerts.
 */

const CALLOUT_STYLES = {
  info:    { bg: "#DBEAFE", border: "#2563EB", icon: "ℹ️", accent: "#2563EB" },
  warning: { bg: "#FEF9C3", border: "#EAB308", icon: "⚠️", accent: "#854D0E" },
  tip:     { bg: "#DCFCE7", border: "#22C55E", icon: "💡", accent: "#166534" },
  caution: { bg: "#FEE2E2", border: "#EF4444", icon: "🔴", accent: "#991B1B" },
  success: { bg: "#DCFCE7", border: "#22C55E", icon: "✅", accent: "#166534" },
};

export function renderCallout(block, t) {
  const st = CALLOUT_STYLES[block.variant] ?? CALLOUT_STYLES.info;
  return `
<div class="callout-block" style="background:${st.bg};border-color:${st.border};">
  <div class="callout-icon">${st.icon}</div>
  <div class="callout-body">
    ${block.title ? `<div class="callout-title" style="color:${st.accent};">${block.title}</div>` : ""}
    <div class="callout-text">${block.text}</div>
  </div>
</div>`;
}

export function calloutCss(t) {
  return `
.callout-block { display: flex; gap: 14px; padding: 16px 20px; border-left: 4px solid; border-radius: 0 ${t.borderRadius} ${t.borderRadius} 0; margin-bottom: 20px; }
.callout-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
.callout-body { flex: 1; }
.callout-title { font-size: 13px; font-weight: 700; margin-bottom: 4px; text-transform: uppercase; letter-spacing: .04em; }
.callout-text { font-size: 13px; color: ${t.bodyText}; line-height: 1.6; }
`;
}
