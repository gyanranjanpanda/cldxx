// ─── HTML renderer — converts validated DocumentSchema to a self-contained HTML ─
// All text values are already HTML-escaped by the Zod schema (except code/diagram
// which use rawString and are escaped here). TOC is built from actual section order.

const THEMES = {
  professional: {
    accent:       "#2563EB",
    accentDark:   "#1D4ED8",
    accentLight:  "#EFF6FF",
    accentBorder: "#BFDBFE",
    bg:           "#FFFFFF",
    coverBg:      "#0F172A",
    coverText:    "#FFFFFF",
    coverMuted:   "#94A3B8",
    bodyText:     "#1E293B",
    mutedText:    "#64748B",
    cardBg:       "#F8FAFC",
    cardAlt:      "#EFF6FF",
    statBg:       "#0F172A",
    statCard:     "#1E3A5F",
    statBorder:   "#2563EB",
    statValue:    "#60A5FA",
    conclusionBg: "#2563EB",
    codeBg:       "#0F172A",
    codeText:     "#E2E8F0",
    font:         "Inter",
    headingFont:  "Sora",
  },
};

// ─── Safe HTML escape for raw strings (code blocks) ──────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ─── Labels ───────────────────────────────────────────────────────────────────

const SECTION_LABELS = {
  text:         "Overview",
  bullets:      "Section",
  stats:        "Metrics",
  table:        "Table",
  diagram:      "Diagram",
  quote:        "Quote",
  conclusion:   "Conclusion",
  code:         "Code",
  api:          "API Reference",
  schema:       "Schema",
  risk_matrix:  "Risk Matrix",
  decision_log: "Decision Log",
  prd:          "Requirements",
};

const METHOD_COLORS = {
  GET:    { bg: "#DCFCE7", text: "#166534", border: "#BBF7D0" },
  POST:   { bg: "#DBEAFE", text: "#1E40AF", border: "#BFDBFE" },
  PUT:    { bg: "#FEF9C3", text: "#854D0E", border: "#FDE68A" },
  PATCH:  { bg: "#FFEDD5", text: "#9A3412", border: "#FED7AA" },
  DELETE: { bg: "#FEE2E2", text: "#991B1B", border: "#FECACA" },
};

const PRIORITY_COLORS = {
  must:   { bg: "#FEE2E2", text: "#991B1B", label: "MUST" },
  should: { bg: "#FEF9C3", text: "#854D0E", label: "SHOULD" },
  could:  { bg: "#DBEAFE", text: "#1E40AF", label: "COULD" },
  wont:   { bg: "#F1F5F9", text: "#64748B", label: "WON'T" },
};

const STATUS_COLORS = {
  open:        { bg: "#DBEAFE", text: "#1E40AF" },
  "in-progress": { bg: "#FEF9C3", text: "#854D0E" },
  done:        { bg: "#DCFCE7", text: "#166534" },
  cancelled:   { bg: "#F1F5F9", text: "#64748B" },
};

const DECISION_STATUS_COLORS = {
  accepted:   { bg: "#DCFCE7", text: "#166534" },
  rejected:   { bg: "#FEE2E2", text: "#991B1B" },
  pending:    { bg: "#FEF9C3", text: "#854D0E" },
  superseded: { bg: "#F1F5F9", text: "#64748B" },
};

const RISK_SCORE = { low: 1, medium: 2, high: 3 };
const RISK_CELL_COLORS = {
  1: { bg: "#DCFCE7", text: "#166534" },
  2: { bg: "#FEF9C3", text: "#854D0E" },
  3: { bg: "#FFEDD5", text: "#9A3412" },
  4: { bg: "#FEE2E2", text: "#991B1B" },
  6: { bg: "#991B1B", text: "#FFFFFF" },
  9: { bg: "#7F1D1D", text: "#FFFFFF" },
};

function riskColor(likelihood, impact) {
  const score = RISK_SCORE[likelihood] * RISK_SCORE[impact];
  return RISK_CELL_COLORS[score] ?? { bg: "#F1F5F9", text: "#1E293B" };
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

function buildCss(t) {
  return `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sora:wght@600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

@page { size: A4; margin: 0; }

html, body {
  font-family: 'Inter', -apple-system, sans-serif;
  font-size: 14px;
  color: ${t.bodyText};
  background: ${t.bg};
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.page {
  width: 210mm;
  min-height: 297mm;
  position: relative;
  overflow: hidden;
  page-break-after: always;
}
.page:last-child { page-break-after: avoid; }

/* ── Cover ──────────────────────────────────────────────────── */
.cover {
  background: ${t.coverBg};
  display: flex; flex-direction: column;
  justify-content: center; align-items: flex-start;
  padding: 60px 64px; height: 297mm;
}
.cover-accent-bar { width: 64px; height: 6px; background: ${t.accent}; border-radius: 3px; margin-bottom: 32px; }
.cover h1 {
  font-family: 'Sora', sans-serif; font-size: 44px; font-weight: 800;
  color: ${t.coverText}; line-height: 1.15; margin-bottom: 20px; max-width: 520px;
}
.cover-subtitle { font-size: 18px; color: ${t.coverMuted}; max-width: 480px; line-height: 1.6; margin-bottom: 60px; }
.cover-meta { font-size: 12px; color: #475569; letter-spacing: .05em; text-transform: uppercase; }
.cover-circle-1 { position: absolute; width: 320px; height: 320px; border-radius: 50%; background: ${t.accent}; opacity: .07; top: -80px; right: -80px; }
.cover-circle-2 { position: absolute; width: 180px; height: 180px; border-radius: 50%; background: ${t.accent}; opacity: .05; bottom: 60px; right: 80px; }

/* ── TOC ────────────────────────────────────────────────────── */
.toc-page { padding: 64px; height: 297mm; display: flex; flex-direction: column; }
.toc-page h2 { font-family: 'Sora', sans-serif; font-size: 28px; font-weight: 700; color: ${t.bodyText}; margin-bottom: 8px; }
.toc-divider { width: 56px; height: 4px; background: ${t.accent}; border-radius: 2px; margin-bottom: 36px; }
.toc-list { list-style: none; display: flex; flex-direction: column; }
.toc-item { display: flex; align-items: baseline; padding: 10px 0; border-bottom: 1px solid #F1F5F9; }
.toc-index { width: 32px; font-size: 11px; font-weight: 600; color: ${t.accent}; flex-shrink: 0; }
.toc-title { flex: 1; font-size: 14px; color: ${t.bodyText}; }
.toc-dots { flex: 1; border-bottom: 2px dotted #CBD5E1; margin: 0 12px; position: relative; top: -4px; }
.toc-badge { font-size: 11px; font-weight: 600; color: ${t.mutedText}; background: ${t.cardBg}; border: 1px solid #E2E8F0; padding: 2px 10px; border-radius: 12px; }

/* ── Content page ───────────────────────────────────────────── */
.content-page { padding: 52px 64px 80px; min-height: 297mm; display: flex; flex-direction: column; }
.section-header { display: flex; align-items: center; gap: 16px; margin-bottom: 28px; }
.section-accent { width: 6px; height: 38px; background: ${t.accent}; border-radius: 3px; flex-shrink: 0; }
.section-header h2 { font-family: 'Sora', sans-serif; font-size: 24px; font-weight: 700; color: ${t.bodyText}; }

/* ── Text ───────────────────────────────────────────────────── */
.text-paragraphs p { font-size: 14px; line-height: 1.8; color: ${t.bodyText}; margin-bottom: 16px; }
.text-paragraphs p:last-child { margin-bottom: 0; }

/* ── Bullets ────────────────────────────────────────────────── */
.bullet-list { display: flex; flex-direction: column; gap: 8px; }
.bullet-card { display: flex; align-items: flex-start; gap: 14px; padding: 14px 18px; border-radius: 8px; border: 1px solid ${t.accentBorder}; }
.bullet-card:nth-child(odd)  { background: ${t.cardAlt}; }
.bullet-card:nth-child(even) { background: ${t.cardBg}; border-color: #E2E8F0; }
.bullet-dot { width: 10px; height: 10px; border-radius: 50%; background: ${t.accent}; flex-shrink: 0; margin-top: 4px; }
.bullet-text { font-size: 13.5px; color: ${t.bodyText}; line-height: 1.6; }

/* ── Stats ──────────────────────────────────────────────────── */
.stats-page { background: ${t.statBg}; padding: 52px 64px; min-height: 297mm; display: flex; flex-direction: column; }
.stats-header h2 { font-family: 'Sora', sans-serif; font-size: 24px; font-weight: 700; color: #fff; margin-bottom: 8px; }
.stats-header-divider { width: 56px; height: 3px; background: ${t.accent}; border-radius: 2px; margin-bottom: 36px; }
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; }
.stat-card { background: ${t.statCard}; border: 1px solid ${t.statBorder}; border-radius: 12px; padding: 28px 20px 24px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.stat-value { font-family: 'Sora', sans-serif; font-size: 42px; font-weight: 800; color: ${t.statValue}; line-height: 1; }
.stat-label { font-size: 12px; color: #94A3B8; text-align: center; text-transform: uppercase; letter-spacing: .06em; font-weight: 600; }

/* ── Table ──────────────────────────────────────────────────── */
.pdf-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.pdf-table th { background: ${t.accent}; color: #fff; font-weight: 600; padding: 12px 16px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }
.pdf-table th:first-child { border-radius: 8px 0 0 0; }
.pdf-table th:last-child  { border-radius: 0 8px 0 0; }
.pdf-table td { padding: 11px 16px; color: ${t.bodyText}; border-bottom: 1px solid #F1F5F9; line-height: 1.5; }
.pdf-table tr:nth-child(even) td { background: ${t.cardAlt}; }
.pdf-table tr:last-child td { border-bottom: none; }

/* ── Diagram ────────────────────────────────────────────────── */
.diagram-container { display: flex; justify-content: center; padding: 24px; background: ${t.cardBg}; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden; }
.diagram-container svg { max-width: 100%; height: auto; }

/* ── Quote ──────────────────────────────────────────────────── */
.quote-block { border-left: 5px solid ${t.accent}; padding: 20px 28px; background: ${t.accentLight}; border-radius: 0 8px 8px 0; }
.quote-text { font-size: 17px; font-style: italic; color: ${t.bodyText}; line-height: 1.8; margin-bottom: 12px; }
.quote-source { font-size: 12px; font-weight: 600; color: ${t.accent}; text-transform: uppercase; letter-spacing: .06em; }

/* ── Conclusion ─────────────────────────────────────────────── */
.conclusion-page { background: ${t.conclusionBg}; padding: 52px 64px; min-height: 297mm; display: flex; flex-direction: column; justify-content: center; position: relative; overflow: hidden; }
.conclusion-circle { position: absolute; width: 300px; height: 300px; border-radius: 50%; background: rgba(255,255,255,.05); bottom: -60px; right: -60px; }
.conclusion-page h2 { font-family: 'Sora', sans-serif; font-size: 34px; font-weight: 800; color: #fff; margin-bottom: 8px; }
.conclusion-subtitle { font-size: 13px; color: #BFDBFE; text-transform: uppercase; letter-spacing: .08em; font-weight: 600; margin-bottom: 36px; }
.conclusion-points { display: flex; flex-direction: column; gap: 16px; }
.conclusion-point { display: flex; align-items: flex-start; gap: 14px; }
.conclusion-dot { width: 10px; height: 10px; border-radius: 50%; background: #fff; flex-shrink: 0; margin-top: 5px; }
.conclusion-point-text { font-size: 15px; color: #fff; line-height: 1.6; }

/* ── Code block ─────────────────────────────────────────────── */
.code-description { font-size: 13px; color: ${t.mutedText}; margin-bottom: 16px; line-height: 1.6; }
.code-block-wrap { border-radius: 10px; overflow: hidden; border: 1px solid #1E293B; }
.code-header { background: #1E293B; padding: 10px 18px; display: flex; align-items: center; justify-content: space-between; }
.code-lang { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #64748B; text-transform: uppercase; letter-spacing: .06em; }
.code-dots { display: flex; gap: 6px; }
.code-dot { width: 10px; height: 10px; border-radius: 50%; }
.code-dot-r { background: #EF4444; }
.code-dot-y { background: #EAB308; }
.code-dot-g { background: #22C55E; }
pre.code-content {
  background: ${t.codeBg}; color: ${t.codeText}; margin: 0;
  padding: 20px 18px; font-family: 'JetBrains Mono', monospace;
  font-size: 12px; line-height: 1.7; overflow-x: auto; white-space: pre;
}

/* ── API reference ──────────────────────────────────────────── */
.api-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.api-table th { background: #0F172A; color: #94A3B8; font-weight: 600; padding: 10px 14px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
.api-table th:first-child { border-radius: 8px 0 0 0; }
.api-table th:last-child  { border-radius: 0 8px 0 0; }
.api-table td { padding: 12px 14px; color: ${t.bodyText}; border-bottom: 1px solid #F1F5F9; vertical-align: middle; }
.api-table tr:last-child td { border-bottom: none; }
.api-table tr:nth-child(even) td { background: ${t.cardBg}; }
.method-badge { display: inline-block; font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 4px; border: 1px solid; letter-spacing: .04em; }
.api-path { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #1E293B; }
.api-status-badge { display: inline-block; font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 10px; }
.status-stable     { background: #DCFCE7; color: #166534; }
.status-beta       { background: #FEF9C3; color: #854D0E; }
.status-deprecated { background: #FEE2E2; color: #991B1B; }
.auth-icon { font-size: 13px; }

/* ── DB Schema ──────────────────────────────────────────────── */
.schema-table-wrap { margin-bottom: 32px; }
.schema-table-name { font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 700; color: ${t.accent}; background: ${t.accentLight}; border: 1px solid ${t.accentBorder}; padding: 8px 14px; border-radius: 6px 6px 0 0; display: inline-block; margin-bottom: -1px; }
.schema-table { width: 100%; border-collapse: collapse; font-size: 12.5px; border: 1px solid #E2E8F0; }
.schema-table th { background: #F8FAFC; color: #475569; font-weight: 600; padding: 9px 12px; text-align: left; border-bottom: 2px solid #E2E8F0; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
.schema-table td { padding: 9px 12px; border-bottom: 1px solid #F1F5F9; vertical-align: middle; }
.schema-table tr:last-child td { border-bottom: none; }
.col-name { font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 600; color: #1E293B; }
.col-type { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: ${t.accent}; background: ${t.accentLight}; padding: 2px 6px; border-radius: 4px; }
.col-constraint { font-size: 10px; color: ${t.mutedText}; font-style: italic; }

/* ── Risk matrix ────────────────────────────────────────────── */
.risk-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.risk-table th { background: #0F172A; color: #94A3B8; font-weight: 600; padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
.risk-table th:first-child { border-radius: 8px 0 0 0; }
.risk-table th:last-child  { border-radius: 0 8px 0 0; }
.risk-table td { padding: 11px 12px; border-bottom: 1px solid #F1F5F9; vertical-align: middle; }
.risk-table tr:last-child td { border-bottom: none; }
.risk-badge { display: inline-block; font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 4px; text-transform: uppercase; letter-spacing: .05em; }
.risk-name { font-size: 13px; font-weight: 500; color: ${t.bodyText}; }
.risk-mitigation { font-size: 11.5px; color: ${t.mutedText}; margin-top: 4px; }

/* ── Decision log ───────────────────────────────────────────── */
.decision-card { border: 1px solid #E2E8F0; border-radius: 10px; padding: 16px 20px; margin-bottom: 12px; background: ${t.cardBg}; }
.decision-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.decision-id { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; color: ${t.accent}; background: ${t.accentLight}; border: 1px solid ${t.accentBorder}; padding: 2px 8px; border-radius: 4px; }
.decision-status-badge { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 10px; text-transform: uppercase; letter-spacing: .05em; }
.decision-date { font-size: 11px; color: ${t.mutedText}; margin-left: auto; }
.decision-text { font-size: 13.5px; font-weight: 600; color: ${t.bodyText}; margin-bottom: 6px; }
.decision-rationale { font-size: 12.5px; color: ${t.mutedText}; line-height: 1.6; }
.decision-owner { font-size: 11px; color: ${t.accent}; margin-top: 8px; font-weight: 600; }

/* ── PRD ────────────────────────────────────────────────────── */
.prd-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.prd-table th { background: #0F172A; color: #94A3B8; font-weight: 600; padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
.prd-table th:first-child { border-radius: 8px 0 0 0; }
.prd-table th:last-child  { border-radius: 0 8px 0 0; }
.prd-table td { padding: 11px 12px; border-bottom: 1px solid #F1F5F9; vertical-align: top; }
.prd-table tr:last-child td { border-bottom: none; }
.prd-id { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; color: ${t.accent}; }
.prd-priority { display: inline-block; font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 4px; text-transform: uppercase; letter-spacing: .05em; }
.prd-status { display: inline-block; font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 10px; }
.prd-notes { font-size: 11px; color: ${t.mutedText}; margin-top: 4px; font-style: italic; }

/* ── Footer ─────────────────────────────────────────────────── */
.page-footer { position: absolute; bottom: 24px; left: 64px; right: 64px; display: flex; align-items: center; justify-content: space-between; font-size: 10px; color: ${t.mutedText}; border-top: 1px solid #F1F5F9; padding-top: 10px; }
.stats-page .page-footer, .conclusion-page .page-footer { color: rgba(255,255,255,.3); border-top-color: rgba(255,255,255,.1); }
.footer-brand { font-weight: 600; letter-spacing: .04em; }
`;
}

// ─── Block renderers ──────────────────────────────────────────────────────────

function sectionHeader(title) {
  return `
<div class="section-header">
  <div class="section-accent"></div>
  <h2>${title}</h2>
</div>`;
}

function pageFooter(index) {
  return `<div class="page-footer"><span class="footer-brand">cldxAI</span><span>Section ${index + 1}</span></div>`;
}

// Cover
function renderCover(doc) {
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  return `
<div class="page cover">
  <div class="cover-circle-1"></div>
  <div class="cover-circle-2"></div>
  <div class="cover-accent-bar"></div>
  <h1>${doc.title}</h1>
  ${doc.subtitle ? `<p class="cover-subtitle">${doc.subtitle}</p>` : ""}
  <p class="cover-meta">cldxAI &nbsp;·&nbsp; ${date}</p>
</div>`;
}

// TOC — built from actual section order
function renderToc(sections) {
  const items = sections.map((sec, i) => {
    const label = sec.title || SECTION_LABELS[sec.type] || `Section ${i + 1}`;
    return `
<li class="toc-item">
  <span class="toc-index">${String(i + 1).padStart(2, "0")}</span>
  <span class="toc-title">${label}</span>
  <span class="toc-dots"></span>
  <span class="toc-badge">${SECTION_LABELS[sec.type]}</span>
</li>`;
  });
  return `
<div class="page toc-page">
  <h2>Contents</h2>
  <div class="toc-divider"></div>
  <ul class="toc-list">${items.join("")}</ul>
  <div class="page-footer"><span class="footer-brand">cldxAI</span><span>Table of Contents</span></div>
</div>`;
}

// Text
function renderTextBlock(block, i) {
  return `
<div class="page content-page">
  ${block.title ? sectionHeader(block.title) : ""}
  <div class="text-paragraphs">${block.paragraphs.map((p) => `<p>${p}</p>`).join("")}</div>
  ${pageFooter(i)}
</div>`;
}

// Bullets
function renderBulletsBlock(block, i) {
  const cards = block.items.map((item) => `
<div class="bullet-card">
  <div class="bullet-dot"></div>
  <span class="bullet-text">${item}</span>
</div>`).join("");
  return `
<div class="page content-page">
  ${sectionHeader(block.title)}
  <div class="bullet-list">${cards}</div>
  ${pageFooter(i)}
</div>`;
}

// Stats
function renderStatsBlock(block, i) {
  const cards = block.items.map((s) => `
<div class="stat-card">
  <span class="stat-value">${s.value}</span>
  <span class="stat-label">${s.label}</span>
</div>`).join("");
  return `
<div class="page stats-page">
  <div class="stats-header">
    <h2>${block.title || "Key Metrics"}</h2>
    <div class="stats-header-divider"></div>
  </div>
  <div class="stats-grid">${cards}</div>
  <div class="page-footer"><span class="footer-brand">cldxAI</span><span>Section ${i + 1}</span></div>
</div>`;
}

// Generic table
function renderTableBlock(block, i) {
  const headers = block.columns.map((c) => `<th>${c}</th>`).join("");
  const rows = block.rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
  return `
<div class="page content-page">
  ${block.title ? sectionHeader(block.title) : ""}
  <table class="pdf-table">
    <thead><tr>${headers}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${pageFooter(i)}
</div>`;
}

// Diagram (Mermaid)
function renderDiagramBlock(block, i) {
  // Undo Zod's HTML-escaping — Mermaid needs raw DSL
  const mermaidSrc = block.source
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'");
  return `
<div class="page content-page">
  ${block.title ? sectionHeader(block.title) : ""}
  <div class="diagram-container">
    <pre class="mermaid">${escHtml(mermaidSrc)}</pre>
  </div>
  ${pageFooter(i)}
</div>`;
}

// Quote
function renderQuoteBlock(block, i) {
  return `
<div class="page content-page" style="justify-content:center;">
  <div class="quote-block">
    <p class="quote-text">&ldquo;${block.text}&rdquo;</p>
    ${block.source ? `<p class="quote-source">— ${block.source}</p>` : ""}
  </div>
  ${pageFooter(i)}
</div>`;
}

// Conclusion
function renderConclusionBlock(block, i) {
  const points = block.points.map((p) => `
<div class="conclusion-point">
  <div class="conclusion-dot"></div>
  <span class="conclusion-point-text">${p}</span>
</div>`).join("");
  return `
<div class="page conclusion-page">
  <div class="conclusion-circle"></div>
  <h2>${block.title}</h2>
  <p class="conclusion-subtitle">Key Takeaways</p>
  <div class="conclusion-points">${points}</div>
  <div class="page-footer"><span class="footer-brand">cldxAI</span><span>Section ${i + 1}</span></div>
</div>`;
}

// Code block with Prism syntax highlighting
function renderCodeBlock(block, i) {
  const safeCode = escHtml(block.code);
  const lang = block.language || "text";
  return `
<div class="page content-page">
  ${block.title ? sectionHeader(block.title) : ""}
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
    <pre class="code-content language-${escHtml(lang)}"><code class="language-${escHtml(lang)}">${safeCode}</code></pre>
  </div>
  ${pageFooter(i)}
</div>`;
}

// API reference table
function renderApiBlock(block, i) {
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
<div class="page content-page">
  ${sectionHeader(block.title || "API Reference")}
  <table class="api-table">
    <thead><tr><th>Method</th><th>Endpoint</th><th>Description</th><th>Auth</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${pageFooter(i)}
</div>`;
}

// Database schema
function renderSchemaBlock(block, i) {
  const tables = block.tables.map((tbl) => {
    const cols = tbl.columns.map((col) => `
<tr>
  <td><span class="col-name">${col.name}</span></td>
  <td><span class="col-type">${col.type}</span></td>
  <td><span class="col-constraint">${col.constraints || "—"}</span></td>
  <td style="font-size:12px;color:#64748B;">${col.description || "—"}</td>
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
<div class="page content-page">
  ${sectionHeader(block.title || "Database Schema")}
  ${tables}
  ${pageFooter(i)}
</div>`;
}

// Risk matrix
function renderRiskMatrixBlock(block, i) {
  const rows = block.risks.map((r) => {
    const lc = riskColor(r.likelihood, "low");
    const ic = riskColor("low", r.impact);
    const overall = riskColor(r.likelihood, r.impact);
    return `
<tr>
  <td>
    <div class="risk-name">${r.name}</div>
    ${r.mitigation ? `<div class="risk-mitigation">↳ ${r.mitigation}</div>` : ""}
  </td>
  <td><span class="risk-badge" style="background:${lc.bg};color:${lc.text};">${r.likelihood}</span></td>
  <td><span class="risk-badge" style="background:${ic.bg};color:${ic.text};">${r.impact}</span></td>
  <td><span class="risk-badge" style="background:${overall.bg};color:${overall.text};">${r.likelihood === "high" && r.impact === "high" ? "CRITICAL" : r.likelihood === "high" || r.impact === "high" ? "HIGH" : r.likelihood === "medium" || r.impact === "medium" ? "MEDIUM" : "LOW"}</span></td>
  <td style="font-size:12px;color:#64748B;">${r.owner || "—"}</td>
</tr>`;
  }).join("");
  return `
<div class="page content-page">
  ${sectionHeader(block.title || "Risk Matrix")}
  <table class="risk-table">
    <thead><tr><th>Risk</th><th>Likelihood</th><th>Impact</th><th>Severity</th><th>Owner</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${pageFooter(i)}
</div>`;
}

// Decision log (ADR style)
function renderDecisionLogBlock(block, i) {
  const cards = block.decisions.map((d) => {
    const sc = DECISION_STATUS_COLORS[d.status] ?? { bg: "#F1F5F9", text: "#64748B" };
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
<div class="page content-page">
  ${sectionHeader(block.title || "Decision Log")}
  ${cards}
  ${pageFooter(i)}
</div>`;
}

// PRD / MoSCoW requirements
function renderPrdBlock(block, i) {
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
<div class="page content-page">
  ${sectionHeader(block.title || "Product Requirements")}
  <table class="prd-table">
    <thead><tr><th>ID</th><th>Requirement</th><th>Priority</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${pageFooter(i)}
</div>`;
}

// ─── Dispatch table ───────────────────────────────────────────────────────────

const RENDERERS = {
  text:         renderTextBlock,
  bullets:      renderBulletsBlock,
  stats:        renderStatsBlock,
  table:        renderTableBlock,
  diagram:      renderDiagramBlock,
  quote:        renderQuoteBlock,
  conclusion:   renderConclusionBlock,
  code:         renderCodeBlock,
  api:          renderApiBlock,
  schema:       renderSchemaBlock,
  risk_matrix:  renderRiskMatrixBlock,
  decision_log: renderDecisionLogBlock,
  prd:          renderPrdBlock,
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Convert a validated DocumentSchema object to a self-contained HTML string.
 * @param {import("../schemas/document.schema.js").DocumentSchema} doc
 * @returns {string}
 */
export function renderPdfHtml(doc) {
  const theme      = THEMES[doc.theme] ?? THEMES.professional;
  const hasDiagram = doc.sections.some((s) => s.type === "diagram");
  const hasCode    = doc.sections.some((s) => s.type === "code");

  const coverHtml   = renderCover(doc);
  const tocHtml     = renderToc(doc.sections);
  const contentHtml = doc.sections
    .map((section, i) => (RENDERERS[section.type] ?? (() => ""))(section, i))
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${doc.title}</title>
  <style>${buildCss(theme)}</style>
  ${hasCode ? `
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css" />
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-javascript.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-typescript.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-python.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-sql.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-bash.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-json.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-yaml.min.js"></script>
  ` : ""}
  ${hasDiagram ? `
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
    mermaid.initialize({ startOnLoad: true, theme: 'base', themeVariables: { primaryColor: '#2563EB', primaryTextColor: '#1E293B', lineColor: '#64748B' } });
  </script>` : ""}
</head>
<body>
  ${coverHtml}
  ${tocHtml}
  ${contentHtml}
</body>
</html>`;
}
