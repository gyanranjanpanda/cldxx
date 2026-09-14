/**
 * Document renderer — composes theme + layouts + block registry into self-contained HTML.
 *
 * Two structural changes from the original:
 *
 *  1. It renders SECTIONS, not a flat block list. Each section is handed to its
 *     layout, so a comparison section is laid out as a comparison rather than as
 *     whatever the blocks happened to be. Sections without a composed layout fall
 *     back to the old flat behaviour, so uncomposed documents still render.
 *
 *  2. It does not decide page breaks. Flowing content is emitted into
 *     `.flow-group` containers and the paginator repacks them into real pages in
 *     the browser, where element heights are actually known. See `paginate.js`.
 *
 * Everything it needs — fonts, syntax colors — is inlined. Nothing loads over
 * the network at render time.
 */

import { getTheme }                from "./themes/index.js";
import { renderBlock, collectCss } from "./registry.js";
import { getLayout }               from "../design/layouts.js";
import { fontCss, prismCss }       from "./assets.js";

/** Layouts whose component already emits its own full-bleed `.page`. */
const SELF_PAGED = new Set(["cover", "toc", "metrics", "conclusion", "section_break"]);

/**
 * @param {import("../schemas/document.schema.js").Document} doc
 * @returns {string} Self-contained HTML
 */
export function renderDocument(doc) {
  const theme = getTheme(doc.meta.theme);
  const ctx   = { allBlocks: doc.blocks, sections: doc.sections };

  const sections = doc.sections?.length ? doc.sections : fallbackSections(doc);

  const needsMermaid = doc.blocks.some((b) => b.type === "mermaid");
  const needsPrism   = doc.blocks.some((b) => b.type === "code");

  const body = renderBody(sections, theme, ctx);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${doc.meta.title}</title>
  <style>
${fontCss()}
${globalCss(theme)}
${collectCss(theme)}
${needsPrism ? scopedPrismCss() : ""}
  </style>
</head>
<body data-needs-mermaid="${needsMermaid}" data-needs-prism="${needsPrism}"
      data-accent="${theme.accent}" data-ink="${theme.bodyText}" data-muted="${theme.mutedText}"
      data-surface="${theme.cardBg}">
<div class="doc">
${body}
</div>
</body>
</html>`;
}

// ─── Section rendering ────────────────────────────────────────────────────────

/** Blocks that only delimit a section and carry nothing a full-bleed page needs. */
const STRUCTURAL_ONLY = new Set(["heading", "divider"]);

/**
 * Build the document body.
 *
 * Consecutive flowing sections share ONE flow-group so the paginator can pack
 * them continuously. Giving every section its own group would force a page break
 * per section, and since a chart or diagram section is only a third of a page
 * tall, that produced a document that was mostly whitespace. Sections still open
 * cleanly — the paginator applies orphan control so a heading never strands at
 * the foot of a page — but a page now fills before the next one starts.
 */
function renderBody(sections, theme, ctx) {
  const out = [];
  let flowing = [];

  const flushFlow = () => {
    if (!flowing.length) return;
    out.push(`<section class="flow-group">\n${flowing.join("\n")}\n</section>`);
    flowing = [];
  };

  for (const section of sections) {
    const layout = getLayout(section.layout);

    if (SELF_PAGED.has(layout.id) || layout.id === "quote") {
      flushFlow();
      const page = renderFullBleed(section, layout, theme, ctx);
      if (page) out.push(page);
    } else {
      flowing.push(renderFlowSection(section, layout, theme, ctx));
    }
  }
  flushFlow();

  return out.join("\n");
}

/**
 * A full-bleed page is drawn by exactly one block. Every section carries a
 * leading heading so the composer can find its boundaries, but on these layouts
 * the component draws its own title — so the heading is consumed as that title
 * rather than emitted, which would leave it stranded outside the page box.
 */
function renderFullBleed(section, layout, theme, ctx) {
  if (layout.id === "quote") {
    const quote = section.blocks.find((b) => b.type === "quote");
    if (!quote) return "";
    return `
<div class="page quote-page" data-section-id="${section.id}">
  <div class="quote-page-inner">${renderBlock(quote, theme, ctx)}</div>
</div>`;
  }

  const owner = section.blocks.find((b) => !STRUCTURAL_ONLY.has(b.type));
  if (!owner) return "";

  const titled = layout.id !== "toc" && !owner.title && section.title
    ? { ...owner, title: section.title }
    : owner;

  return renderBlock(titled, theme, ctx)
    .replace(/^\s*<div class="page/, `<div data-section-id="${section.id}" class="page`);
}

/**
 * A flowing section. Its first element is tagged so the paginator can record
 * which page the section landed on (for the TOC) and apply orphan control.
 */
function renderFlowSection(section, layout, theme, ctx) {
  const html = section.blocks
    .map((b) => renderBlock(b, theme, ctx))
    .filter(Boolean)
    .join("\n");

  return html.replace(
    /^\s*<(\w+)/,
    `<$1 data-section-start="${section.id}" data-layout="${layout.id}"`,
  );
}

/**
 * Build sections from a flat block list for documents that skipped composition.
 * Keeps the renderer usable standalone (tests, the preview harness, older callers).
 */
function fallbackSections(doc) {
  const sections = [];
  let current = null;

  for (const block of doc.blocks) {
    const solo = ["cover", "toc", "stats", "conclusion", "section_break"].includes(block.type);
    if (solo) {
      current = null;
      sections.push({
        id: `auto-${sections.length}`,
        layout: { cover: "cover", toc: "toc", stats: "metrics", conclusion: "conclusion", section_break: "section_break" }[block.type],
        blocks: [block],
      });
      continue;
    }
    if (block.type === "heading" && (block.level ?? 1) === 1) current = null;
    if (!current) {
      current = { id: `auto-${sections.length}`, layout: "prose", blocks: [] };
      sections.push(current);
    }
    current.blocks.push(block);
  }

  return sections.filter((s) => s.blocks.length);
}

// ─── Global CSS ───────────────────────────────────────────────────────────────

function globalCss(t) {
  return `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
@page { size: A4; margin: 0; }

html, body {
  font-family: '${t.bodyFont}', -apple-system, system-ui, sans-serif;
  font-size: 14px;
  color: ${t.bodyText};
  background: ${t.bg};
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  text-rendering: optimizeLegibility;
}

.page {
  width: 210mm;
  height: 297mm;
  position: relative;
  overflow: hidden;
  page-break-after: always;
  break-after: page;
  background: ${t.bg};
}
.page:last-child { page-break-after: avoid; break-after: auto; }

.content-page { padding: 52px 64px 78px; display: flex; flex-direction: column; }
/* The paginator measures against this, so it must be the only height authority. */
.page-body { flex: 1; min-height: 0; }

/* Measure runs at 66-72 characters — past that the eye loses the line. */
.paragraph-block p { max-width: 68ch; }

/* Blocks never split across a page; the paginator relies on this holding. */
.flow-group > * { break-inside: avoid; }

.page-footer {
  position: absolute; bottom: 26px; left: 64px; right: 64px;
  display: flex; align-items: center; justify-content: space-between;
  font-size: 10px; color: ${t.mutedText};
  border-top: 1px solid ${t.cardAlt}; padding-top: 10px;
}
.stats-page .page-footer, .conclusion-page .page-footer, .quote-page .page-footer {
  color: rgba(255,255,255,.35); border-top-color: rgba(255,255,255,.12);
}
.footer-brand { font-weight: 600; letter-spacing: .04em; }
.footer-page { font-variant-numeric: tabular-nums; }

/* Full-bleed pull quote — a deliberate pause in the rhythm. */
.quote-page { background: ${t.coverBg}; display: flex; align-items: center; padding: 0 84px; }
.quote-page-inner { width: 100%; }
.quote-page .quote-block { border: none; background: none; padding: 0; }
.quote-page .quote-text {
  font-family: '${t.headingFont}', sans-serif; font-size: 30px; font-style: normal;
  font-weight: 600; line-height: 1.4; color: ${t.coverText}; margin-bottom: 24px;
}
.quote-page .quote-source { color: ${t.accent}; font-size: 13px; }

/* Section openings: flush to the top margin when they start a page, with a
   clear band of air above them when they follow other content. The paginator
   stamps these classes because only it knows where the element actually landed. */
.section-at-top { margin-top: 0 !important; }
.section-mid-page { margin-top: 40px !important; padding-top: 28px;
  border-top: 1px solid ${t.cardAlt}; }
`;
}

/** Prism's theme, scoped so it can only ever touch code blocks. */
function scopedPrismCss() {
  return prismCss().replace(/(^|})\s*([^{}@]+)\s*{/g, (m, close, sel) => {
    if (sel.trim().startsWith("@")) return m;
    const scoped = sel.split(",").map((s) => `.code-block-wrap ${s.trim()}`).join(",");
    return `${close}${scoped}{`;
  });
}
