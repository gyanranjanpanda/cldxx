/**
 * Block registry — one entry per block type.
 *
 * Adding a new block type requires ONLY:
 *   1. New component file in ./components/
 *   2. One line added to this registry
 *
 * No switch statement anywhere.
 */

import { renderCover,       coverCss }       from "./components/cover.js";
import { renderToc,         tocCss }         from "./components/toc.js";
import { renderHeading,     headingCss }     from "./components/heading.js";
import { renderParagraph,   paragraphCss }   from "./components/paragraph.js";
import { renderBullets,     bulletsCss }     from "./components/bullets.js";
import { renderStats,       statsCss }       from "./components/stats.js";
import { renderTable,       tableCss }       from "./components/table.js";
import { renderMermaid,     mermaidCss }     from "./components/mermaid.js";
import { renderCode,        codeCss }        from "./components/code.js";
import { renderApiTable,    apiTableCss }    from "./components/api_table.js";
import { renderSchema,      schemaCss }      from "./components/schema.js";
import { renderRiskMatrix,  riskMatrixCss }  from "./components/risk_matrix.js";
import { renderDecisionLog, decisionLogCss } from "./components/decision_log.js";
import { renderPrd,         prdCss }         from "./components/prd.js";
import { renderQuote,       quoteCss }       from "./components/quote.js";
import { renderTimeline,    timelineCss }    from "./components/timeline.js";
import { renderCallout,     calloutCss }     from "./components/callout.js";
import { renderDivider,     dividerCss }     from "./components/divider.js";
import { renderConclusion,  conclusionCss }  from "./components/conclusion.js";

/**
 * @typedef {{ render: Function, css: Function }} BlockEntry
 */

/** @type {Record<string, BlockEntry>} */
export const registry = {
  cover:        { render: renderCover,       css: coverCss },
  toc:          { render: renderToc,         css: tocCss },
  heading:      { render: renderHeading,     css: headingCss },
  paragraph:    { render: renderParagraph,   css: paragraphCss },
  bullets:      { render: renderBullets,     css: bulletsCss },
  stats:        { render: renderStats,       css: statsCss },
  table:        { render: renderTable,       css: tableCss },
  mermaid:      { render: renderMermaid,     css: mermaidCss },
  code:         { render: renderCode,        css: codeCss },
  api_table:    { render: renderApiTable,    css: apiTableCss },
  schema:       { render: renderSchema,      css: schemaCss },
  risk_matrix:  { render: renderRiskMatrix,  css: riskMatrixCss },
  decision_log: { render: renderDecisionLog, css: decisionLogCss },
  prd:          { render: renderPrd,         css: prdCss },
  quote:        { render: renderQuote,       css: quoteCss },
  timeline:     { render: renderTimeline,    css: timelineCss },
  callout:      { render: renderCallout,     css: calloutCss },
  divider:      { render: renderDivider,     css: dividerCss },
  conclusion:   { render: renderConclusion,  css: conclusionCss },
};

/**
 * Render a single block. Returns empty string for unknown types.
 * @param {object} block
 * @param {import("./themes/index.js").Theme} theme
 * @param {object} [ctx]  — injected context (allBlocks, etc.)
 * @returns {string}
 */
export function renderBlock(block, theme, ctx = {}) {
  const entry = registry[block.type];
  if (!entry) {
    console.warn(`[registry] Unknown block type: ${block.type}`);
    return "";
  }
  return entry.render(block, theme, ctx);
}

/**
 * Collect CSS from all registered block types.
 * @param {import("./themes/index.js").Theme} theme
 * @returns {string}
 */
export function collectCss(theme) {
  return Object.values(registry)
    .map((entry) => entry.css(theme))
    .join("\n");
}
