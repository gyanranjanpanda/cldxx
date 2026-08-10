import { z } from "zod";

// ─── String helpers ────────────────────────────────────────────────────────────

const MAX_ITEMS       = 20;
const MAX_TEXT_LENGTH = 4000;
const MAX_TITLE_LENGTH = 200;

const sanitizedString = (maxLen = MAX_TEXT_LENGTH) =>
  z.string().max(maxLen).transform((val) =>
    val
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;")
      .trim()
  );

// Raw string — not HTML-escaped. Used for code and Mermaid source.
const rawString = (maxLen) => z.string().max(maxLen).transform((v) => v.trim());

const shortString = sanitizedString(MAX_TITLE_LENGTH);

// ─── Block Variants ────────────────────────────────────────────────────────────

const TextBlock = z.object({
  type: z.literal("text"),
  title: shortString.optional(),
  paragraphs: z.array(sanitizedString()).min(1).max(MAX_ITEMS),
});

const BulletsBlock = z.object({
  type: z.literal("bullets"),
  title: shortString,
  items: z.array(sanitizedString(500)).min(1).max(MAX_ITEMS),
});

const StatsBlock = z.object({
  type: z.literal("stats"),
  title: shortString.optional(),
  items: z
    .array(z.object({ label: sanitizedString(100), value: sanitizedString(200) }))
    .min(1)
    .max(6),
});

const TableBlock = z.object({
  type: z.literal("table"),
  title: shortString.optional(),
  columns: z.array(sanitizedString(100)).min(1).max(10),
  rows: z.array(z.array(sanitizedString(500)).min(1).max(10)).min(1).max(50),
});

const DiagramBlock = z.object({
  type: z.literal("diagram"),
  title: shortString.optional(),
  // diagram_type helps the renderer pick the right Mermaid header
  diagram_type: z
    .enum(["flowchart", "sequence", "er", "gantt", "class", "state", "mindmap", "generic"])
    .default("generic"),
  syntax: z.enum(["mermaid"]),
  source: rawString(8000),
});

const QuoteBlock = z.object({
  type: z.literal("quote"),
  text: sanitizedString(600),
  source: sanitizedString(200).optional(),
});

const ConclusionBlock = z.object({
  type: z.literal("conclusion"),
  title: shortString,
  points: z.array(sanitizedString(500)).min(1).max(10),
});

// ─── Technical Blocks ─────────────────────────────────────────────────────────

/** Syntax-highlighted code block — language drives Prism.js class */
const CodeBlock = z.object({
  type: z.literal("code"),
  title: shortString.optional(),
  language: z.string().max(30).default("text"),
  // Code is raw (not HTML escaped) — it will be HTML-escaped in the renderer
  code: rawString(10000),
  description: sanitizedString(300).optional(),
});

/** REST API endpoint reference table */
const ApiBlock = z.object({
  type: z.literal("api"),
  title: shortString.optional(),
  endpoints: z
    .array(
      z.object({
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        path: sanitizedString(200),
        description: sanitizedString(300),
        auth: z.boolean().default(true),
        status: z.enum(["stable", "beta", "deprecated"]).default("stable"),
      })
    )
    .min(1)
    .max(20),
});

/** Database / data schema table — one or more tables */
const SchemaBlock = z.object({
  type: z.literal("schema"),
  title: shortString.optional(),
  tables: z
    .array(
      z.object({
        name: sanitizedString(100),
        columns: z
          .array(
            z.object({
              name: sanitizedString(100),
              type: sanitizedString(80),
              constraints: sanitizedString(200).optional(),
              description: sanitizedString(200).optional(),
            })
          )
          .min(1)
          .max(25),
      })
    )
    .min(1)
    .max(5),
});

/** Risk matrix — likelihood × impact heat-map */
const RiskMatrixBlock = z.object({
  type: z.literal("risk_matrix"),
  title: shortString.optional(),
  risks: z
    .array(
      z.object({
        name: sanitizedString(200),
        likelihood: z.enum(["low", "medium", "high"]),
        impact: z.enum(["low", "medium", "high"]),
        mitigation: sanitizedString(300).optional(),
        owner: sanitizedString(100).optional(),
      })
    )
    .min(1)
    .max(15),
});

/** Architecture Decision Record log */
const DecisionLogBlock = z.object({
  type: z.literal("decision_log"),
  title: shortString.optional(),
  decisions: z
    .array(
      z.object({
        id: sanitizedString(20),
        decision: sanitizedString(300),
        rationale: sanitizedString(400),
        status: z.enum(["accepted", "rejected", "pending", "superseded"]),
        date: sanitizedString(50).optional(),
        owner: sanitizedString(100).optional(),
      })
    )
    .min(1)
    .max(20),
});

/** MoSCoW PRD requirements table */
const PrdBlock = z.object({
  type: z.literal("prd"),
  title: shortString.optional(),
  requirements: z
    .array(
      z.object({
        id: sanitizedString(20),
        requirement: sanitizedString(300),
        priority: z.enum(["must", "should", "could", "wont"]),
        status: z.enum(["open", "in-progress", "done", "cancelled"]).default("open"),
        notes: sanitizedString(200).optional(),
      })
    )
    .min(1)
    .max(30),
});

// ─── Discriminated union ───────────────────────────────────────────────────────

export const SectionBlock = z.discriminatedUnion("type", [
  TextBlock,
  BulletsBlock,
  StatsBlock,
  TableBlock,
  DiagramBlock,
  QuoteBlock,
  ConclusionBlock,
  CodeBlock,
  ApiBlock,
  SchemaBlock,
  RiskMatrixBlock,
  DecisionLogBlock,
  PrdBlock,
]);

// ─── Top-level document ────────────────────────────────────────────────────────

export const DocumentSchema = z.object({
  type: z.literal("document"),
  title: shortString,
  subtitle: sanitizedString(300).optional(),
  theme: z.enum(["professional", "minimal", "dark"]).default("professional"),
  sections: z.array(SectionBlock).min(1).max(30),
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse and validate raw LLM JSON.
 * @param {unknown} rawJson
 * @returns {{ doc: import("zod").infer<typeof DocumentSchema> } | { error: string }}
 */
export function validateDocument(rawJson) {
  const result = DocumentSchema.safeParse(rawJson);
  if (result.success) return { doc: result.data };

  const summary = result.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");

  return { error: summary };
}

/**
 * Extract first JSON object from a raw LLM string (strips markdown fences).
 * @param {string} raw
 * @returns {unknown | null}
 */
export function extractJson(raw) {
  const stripped = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  const start = stripped.indexOf("{");
  const end   = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  try {
    return JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }
}
