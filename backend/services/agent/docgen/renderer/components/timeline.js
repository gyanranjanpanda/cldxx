/**
 * Timeline block — vertical timeline with status indicators.
 */

const STATUS_STYLES = {
  done:     { bg: "#DCFCE7", border: "#22C55E", dot: "#22C55E", text: "#166534" },
  active:   { bg: "#DBEAFE", border: "#2563EB", dot: "#2563EB", text: "#1E40AF" },
  upcoming: { bg: "#F1F5F9", border: "#CBD5E1", dot: "#94A3B8", text: "#64748B" },
};

export function renderTimeline(block, t) {
  const events = block.events.map((ev, i) => {
    const st = STATUS_STYLES[ev.status] ?? STATUS_STYLES.upcoming;
    const isLast = i === block.events.length - 1;
    return `
<div class="timeline-event">
  <div class="timeline-spine">
    <div class="timeline-dot" style="background:${st.dot};box-shadow:0 0 0 4px ${st.bg};"></div>
    ${!isLast ? `<div class="timeline-line"></div>` : ""}
  </div>
  <div class="timeline-content" style="border-color:${st.border};background:${st.bg};">
    <div class="timeline-date" style="color:${st.text};">${ev.date}</div>
    <div class="timeline-title">${ev.title}</div>
    ${ev.description ? `<div class="timeline-desc">${ev.description}</div>` : ""}
  </div>
</div>`;
  }).join("");

  return `
<div class="timeline-block">
  ${block.title ? `<h3 class="block-title">${block.title}</h3>` : ""}
  <div class="timeline-wrapper">${events}</div>
</div>`;
}

export function timelineCss(t) {
  return `
.timeline-block { margin-bottom: 24px; }
.timeline-wrapper { display: flex; flex-direction: column; padding-left: 16px; }
.timeline-event { display: flex; gap: 20px; min-height: 70px; }
.timeline-spine { display: flex; flex-direction: column; align-items: center; width: 20px; flex-shrink: 0; }
.timeline-dot { width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; z-index: 1; }
.timeline-line { width: 2px; flex: 1; background: ${t.accentBorder}; }
.timeline-content { flex: 1; border: 1px solid; border-radius: ${t.borderRadius}; padding: 14px 18px; margin-bottom: 12px; }
.timeline-date { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 4px; }
.timeline-title { font-size: 14px; font-weight: 600; color: ${t.bodyText}; margin-bottom: 4px; }
.timeline-desc { font-size: 12.5px; color: ${t.mutedText}; line-height: 1.5; }
`;
}
