/**
 * Composer — groups the writer's flat block stream into laid-out sections.
 *
 * This is the stage that was missing. The writer emits blocks; without a composer
 * the renderer pours them into one column top-to-bottom, which is what made the
 * output read as a text dump regardless of how good the individual blocks were.
 *
 * The composer walks the stream, cuts a new section at every level-1 heading,
 * matches each one back to the plan that asked for it, and tags it with the
 * layout that plan committed to. It also injects the rhythm blocks — section
 * breaks between major parts — that no writer would think to ask for.
 */

import { getLayout, VISUAL_LAYOUTS } from "../design/layouts.js";
import { bus } from "../events/bus.js";

/** Blocks that are their own page/slide and never fold into a section body. */
const STANDALONE = new Set(["cover", "toc"]);

/**
 * @param {object} doc — validated, normalized document
 * @param {{ id: string, name: string, layout: string }[]} outline — planner sections
 * @param {{ jobId?: string, format?: "pdf"|"pptx" }} [opts]
 * @returns {{ doc: object, changes: string[] }}
 */
export function compose(doc, outline = [], opts = {}) {
  const { jobId = "", format = "pdf" } = opts;
  const changes = [];

  // Plans are matched by heading text, so index them by a loose key.
  const planByKey = new Map();
  for (const s of outline) {
    if (s?.name) planByKey.set(normalizeKey(s.name), s);
  }

  const sections = [];
  const leading  = [];          // cover / toc, before any section starts
  let current    = null;

  const push = () => {
    if (current && current.blocks.length) sections.push(current);
    current = null;
  };

  for (const block of doc.blocks) {
    if (STANDALONE.has(block.type)) {
      push();
      leading.push(block);
      continue;
    }

    // The conclusion always closes the document as its own section.
    if (block.type === "conclusion") {
      push();
      sections.push({
        id: "conclusion", title: block.title, layout: "conclusion", blocks: [block],
      });
      continue;
    }

    // A level-1 heading opens a new section.
    if (block.type === "heading" && (block.level ?? 1) === 1) {
      push();
      const plan = planByKey.get(normalizeKey(block.text));
      current = {
        id:     plan?.id ?? `s${sections.length + 1}`,
        title:  block.text,
        layout: plan?.layout ?? "bullets",
        blocks: [block],
        notes:  plan?.notes,
      };
      continue;
    }

    // Content before the first heading — open an untitled section rather than drop it.
    if (!current) {
      current = { id: `s${sections.length + 1}`, title: undefined, layout: "prose", blocks: [] };
    }
    current.blocks.push(block);
  }
  push();

  // ── Reconcile layout against what the writer actually produced ──────────────
  // A plan can ask for a chart and get bullets back if the model had no numbers.
  // Rendering a chart layout with no chart block yields an empty page, so the
  // layout follows the content, not the other way round.
  for (const section of sections) {
    const declared = getLayout(section.layout);
    const present  = new Set(section.blocks.map((b) => b.type));
    const satisfied = declared.blocks.some((t) => t !== "heading" && present.has(t));

    if (!satisfied) {
      const fallback = inferLayout(present);
      if (fallback !== section.layout) {
        changes.push(`Section "${section.title ?? section.id}": ${section.layout} → ${fallback} (declared layout had no matching block)`);
        section.layout = fallback;
      }
    }
  }

  // ── Inject section breaks between major parts ──────────────────────────────
  // Only for PDF, and only when the document is long enough to need the pause.
  // Slides get their rhythm from the deck structure instead.
  const withBreaks = [];
  if (format === "pdf" && sections.length >= 6) {
    const every = Math.ceil(sections.length / 3);
    let part = 0;
    sections.forEach((section, i) => {
      if (i > 0 && i % every === 0 && section.layout !== "conclusion") {
        part++;
        withBreaks.push({
          id: `break-${part}`,
          layout: "section_break",
          blocks: [{
            type: "section_break",
            title: section.title ?? `Part ${part + 1}`,
            number: String(part + 1).padStart(2, "0"),
          }],
        });
        changes.push(`Inserted section break before "${section.title}"`);
      }
      withBreaks.push(section);
    });
  } else {
    withBreaks.push(...sections);
  }

  const composed = {
    ...doc,
    sections: [
      ...leading.map((b, i) => ({
        id: `lead-${i}`, layout: b.type === "cover" ? "cover" : "toc", blocks: [b],
      })),
      ...withBreaks,
    ],
  };

  const visuals = withBreaks.filter((s) => VISUAL_LAYOUTS.has(s.layout)).length;
  bus.emit("composer.finished", {
    jobId,
    sections: composed.sections.length,
    visualSections: visuals,
    changes,
  });

  return { doc: composed, changes };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeKey(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Pick the layout that best fits the blocks a section actually contains. */
function inferLayout(present) {
  if (present.has("chart"))        return "chart";
  if (present.has("stats"))        return "metrics";
  if (present.has("mermaid"))      return "diagram";
  if (present.has("comparison"))   return "comparison";
  if (present.has("two_col"))      return "two_col";
  if (present.has("steps"))        return "steps";
  if (present.has("timeline"))     return "timeline";
  if (present.has("code"))         return "code";
  if (present.has("quote"))        return "quote";
  if (present.has("table") || present.has("api_table") || present.has("schema") ||
      present.has("prd") || present.has("risk_matrix") || present.has("decision_log")) return "table";
  if (present.has("bullets"))      return "bullets";
  return "prose";
}
