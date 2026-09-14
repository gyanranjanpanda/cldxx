/**
 * Layout vocabulary — the single source of truth shared by the planner, the HTML
 * renderer and the PPTX exporter.
 *
 * This is the fix for "it just dumps text". Previously the planner chose block
 * types and the writer produced as much prose as it liked, which the renderer
 * poured top-to-bottom into a single column. Now the planner commits to a LAYOUT
 * per section first, and the layout dictates the word budget the writer must
 * write to. Composition comes before content, so content can't overflow it.
 *
 * Budgets differ sharply by medium: an A4 page absorbs a paragraph, a 16:9 slide
 * does not. Same document tree, two budgets.
 */

/**
 * @typedef {object} Layout
 * @property {string}   id
 * @property {string}   intent      — shown to the planner, so keep it decision-shaped
 * @property {string[]} blocks      — block types this layout knows how to place
 * @property {number}   pdfWords    — total prose budget on an A4 page
 * @property {number}   pptWords    — total prose budget on a 16:9 slide
 * @property {boolean} [fullBleed]  — owns its page/slide background edge to edge
 * @property {boolean} [structural] — cover/break/conclusion; not chosen for body sections
 */

/** @type {Record<string, Layout>} */
export const LAYOUTS = {
  cover: {
    id: "cover", structural: true, fullBleed: true,
    intent: "Document title page.",
    blocks: ["cover"], pdfWords: 25, pptWords: 20,
  },

  toc: {
    id: "toc", structural: true, fullBleed: true,
    intent: "Table of contents (PDF) / agenda (deck). Generated, never written.",
    blocks: ["toc"], pdfWords: 0, pptWords: 0,
  },

  section_break: {
    id: "section_break", structural: true, fullBleed: true,
    intent: "A full-bleed divider that announces the next part of the document.",
    blocks: ["section_break"], pdfWords: 20, pptWords: 15,
  },

  prose: {
    id: "prose",
    intent: "Narrative explanation that genuinely needs connected sentences. Use sparingly — never twice in a row.",
    blocks: ["heading", "paragraph", "callout"], pdfWords: 220, pptWords: 55,
  },

  bullets: {
    id: "bullets",
    intent: "Three to five scannable points that stand on their own.",
    blocks: ["heading", "bullets"], pdfWords: 130, pptWords: 55,
  },

  two_col: {
    id: "two_col",
    intent: "Two related clusters of ideas that gain from sitting side by side.",
    blocks: ["heading", "two_col"], pdfWords: 170, pptWords: 60,
  },

  comparison: {
    id: "comparison",
    intent: "A versus B — options, before/after, trade-offs, pros and cons.",
    blocks: ["heading", "comparison"], pdfWords: 160, pptWords: 60,
  },

  metrics: {
    id: "metrics", fullBleed: true,
    intent: "Two to four headline numbers that carry the argument by themselves.",
    blocks: ["stats"], pdfWords: 45, pptWords: 25,
  },

  chart: {
    id: "chart",
    intent: "A quantitative story — trend, magnitude comparison, or composition. Requires real numbers.",
    blocks: ["heading", "chart", "paragraph"], pdfWords: 90, pptWords: 35,
  },

  diagram: {
    id: "diagram",
    intent: "Architecture, flow, sequence or state that is clearer drawn than described.",
    blocks: ["heading", "mermaid", "paragraph"], pdfWords: 80, pptWords: 30,
  },

  table: {
    id: "table",
    intent: "Structured reference data with repeating fields.",
    blocks: ["heading", "table", "api_table", "schema", "prd", "risk_matrix", "decision_log"],
    pdfWords: 120, pptWords: 40,
  },

  code: {
    id: "code",
    intent: "A concrete implementation example. Technical documents only.",
    blocks: ["heading", "code"], pdfWords: 90, pptWords: 30,
  },

  timeline: {
    id: "timeline",
    intent: "Chronology, roadmap or phased plan.",
    blocks: ["heading", "timeline"], pdfWords: 120, pptWords: 45,
  },

  steps: {
    id: "steps",
    intent: "An ordered process where the sequence itself is the point.",
    blocks: ["heading", "steps"], pdfWords: 130, pptWords: 45,
  },

  quote: {
    id: "quote", fullBleed: true,
    intent: "A full-bleed pull quote used as a deliberate pause in the rhythm.",
    blocks: ["quote"], pdfWords: 45, pptWords: 35,
  },

  conclusion: {
    id: "conclusion", structural: true, fullBleed: true,
    intent: "Closing takeaways.",
    blocks: ["conclusion"], pdfWords: 80, pptWords: 45,
  },
};

/** Layouts the planner may choose for body sections. */
export const BODY_LAYOUTS = Object.values(LAYOUTS).filter((l) => !l.structural);

/** Layouts that carry a visual rather than prose — every document needs some. */
export const VISUAL_LAYOUTS = new Set(["metrics", "chart", "diagram", "timeline", "comparison", "steps", "table"]);

/** @param {string} id */
export function getLayout(id) {
  return LAYOUTS[id] ?? LAYOUTS.bullets;
}

/**
 * Word budget for a layout in a given medium.
 * @param {string} id
 * @param {"pdf"|"pptx"} format
 */
export function wordBudget(id, format) {
  const l = getLayout(id);
  return format === "pptx" ? l.pptWords : l.pdfWords;
}

/**
 * The catalogue as the planner sees it — one line per layout.
 * @param {"pdf"|"pptx"} format
 */
export function layoutCatalogue(format) {
  return BODY_LAYOUTS
    .map((l) => `  ${l.id.padEnd(14)} ${l.intent} (max ~${format === "pptx" ? l.pptWords : l.pdfWords} words)`)
    .join("\n");
}

/**
 * Enforce visual rhythm on a planned outline: no layout three times running, and
 * at least a third of body sections carrying a visual. The planner is told these
 * rules, but a model that ignores them still can't produce a wall of bullets —
 * this rewrites the outline rather than trusting the prompt.
 *
 * @param {{ layout: string }[]} sections
 * @returns {{ sections: object[], changes: string[] }}
 */
export function enforceRhythm(sections) {
  const changes = [];
  const out = sections.map((s) => ({ ...s }));

  // 1. Break up runs of three or more identical layouts.
  for (let i = 2; i < out.length; i++) {
    if (out[i].layout === out[i - 1].layout && out[i].layout === out[i - 2].layout) {
      const swap = out[i].layout === "bullets" ? "two_col" : "bullets";
      changes.push(`Section ${i + 1}: ${out[i].layout} → ${swap} (three in a row)`);
      out[i].layout = swap;
    }
  }

  // 2. Guarantee visual density — at least one visual per three body sections.
  const visualCount = out.filter((s) => VISUAL_LAYOUTS.has(s.layout)).length;
  const wanted = Math.max(2, Math.floor(out.length / 3));
  if (visualCount < wanted) {
    let need = wanted - visualCount;
    for (let i = out.length - 1; i >= 0 && need > 0; i--) {
      if (VISUAL_LAYOUTS.has(out[i].layout)) continue;
      // Prefer a metrics page early, a timeline late — cheap heuristic, but it
      // beats a document that is bullets the whole way down.
      const swap = i > out.length / 2 ? "timeline" : "metrics";
      changes.push(`Section ${i + 1}: ${out[i].layout} → ${swap} (visual density)`);
      out[i].layout = swap;
      need--;
    }
  }

  return { sections: out, changes };
}
