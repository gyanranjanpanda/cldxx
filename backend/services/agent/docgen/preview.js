/**
 * Preview harness — renders a fixture document through the real pipeline stages
 * with NO LLM calls, so layouts can be checked by eye after every change.
 *
 *   node docgen/preview.js [outDir]
 *
 * Writes preview.pdf, preview.pptx and preview.html. The fixture deliberately
 * exercises every layout, including the awkward ones: an overlong table, a
 * diagram, a chart with four series, and a section whose declared layout does not
 * match the blocks it got.
 */

import fs   from "node:fs/promises";
import path from "node:path";

import { validate }       from "./pipeline/validator.js";
import { normalize }      from "./pipeline/normalizer.js";
import { compose }        from "./pipeline/composer.js";
import { enhance }        from "./pipeline/intelligence.js";
import { renderDocument } from "./renderer/render.js";
import { exportDocument } from "./exporters/index.js";
import { SCHEMA_VERSION } from "./schemas/document.schema.js";

// ─── Fixture ──────────────────────────────────────────────────────────────────

const OUTLINE = [
  { id: "s1",  name: "Why This Matters",       layout: "prose",      notes: "Set up the problem before any numbers land." },
  { id: "s2",  name: "Adoption at a Glance",   layout: "metrics",    notes: "Three numbers, nothing else." },
  { id: "s3",  name: "How Requests Flow",      layout: "diagram",    notes: "Walk the path of a single request." },
  { id: "s4",  name: "Throughput by Quarter",  layout: "chart",      notes: "Growth is the point; the dip in Q3 was the migration." },
  { id: "s5",  name: "Managed vs Self-Hosted", layout: "comparison", notes: "Do not editorialise — let the columns argue." },
  { id: "s6",  name: "Rollout Sequence",       layout: "steps",      notes: "Four steps, each one gated." },
  { id: "s7",  name: "Delivery Timeline",      layout: "timeline",   notes: "Q3 is where we are now." },
  { id: "s8",  name: "Cost Split",             layout: "chart",      notes: "Compute dominates; everything else is noise." },
  { id: "s9",  name: "Public Endpoints",       layout: "table",      notes: "Skim it, don't read it." },
  { id: "s10", name: "Client Setup",           layout: "code",       notes: "The whole integration is nine lines." },
  { id: "s11", name: "Two Ways to Scale",      layout: "two_col",    notes: "Horizontal is usually right." },
  { id: "s12", name: "What Operators Say",     layout: "quote",      notes: "Pause here." },
];

const BLOCKS = [
  { type: "cover", title: "Platform Architecture Review", subtitle: "Infrastructure direction and rollout plan for the coming year" },
  { type: "toc" },

  { type: "heading", text: "Why This Matters", level: 1 },
  { type: "paragraph", text: "The current deployment runs a single region behind one load balancer. That was the right call at ten thousand requests a day and is the wrong one at four million. Every incident in the last two quarters traces back to the same shared bottleneck." },
  { type: "callout", variant: "warning", title: "Single point of failure", text: "One region means one outage takes the whole product down." },

  { type: "heading", text: "Adoption at a Glance", level: 1 },
  { type: "stats", title: "Adoption at a Glance", items: [
    { label: "Monthly active teams", value: "12.4K" },
    { label: "Requests per day",     value: "4.1M" },
    { label: "P99 latency",          value: "180ms" },
    { label: "Uptime, trailing 90d", value: "99.2%" },
  ] },

  { type: "heading", text: "How Requests Flow", level: 1 },
  { type: "mermaid", title: "Request path", diagram_type: "flowchart", source: "graph LR\n  C[Client] --> G[Gateway]\n  G --> A[Auth]\n  G --> R[Router]\n  R --> S1[Agent Service]\n  R --> S2[Billing]\n  S1 --> Q[(Redis Queue)]\n  S1 --> D[(MongoDB)]" },
  { type: "paragraph", text: "Every request is authenticated at the edge, then routed by intent. Only the agent service touches the queue." },

  { type: "heading", text: "Throughput by Quarter", level: 1 },
  { type: "chart", chart_type: "column", title: "Requests served per quarter", unit: "M",
    categories: ["Q1", "Q2", "Q3", "Q4"],
    series: [
      { name: "Production", values: [1.2, 2.4, 2.1, 4.1] },
      { name: "Staging",    values: [0.4, 0.6, 0.9, 1.1] },
    ],
    takeaway: "The Q3 dip is the region migration, not lost demand. Q4 recovered and then some." },

  { type: "heading", text: "Managed vs Self-Hosted", level: 1 },
  { type: "comparison", title: "Deployment options",
    left:  { title: "Managed", items: ["No infrastructure to run", "Predictable per-seat cost", "Upgrades land automatically", "Data lives in our region"] },
    right: { title: "Self-hosted", items: ["Full data residency control", "Cost scales with hardware, not seats", "Upgrades are your schedule", "You own the on-call rota"] } },

  { type: "heading", text: "Rollout Sequence", level: 1 },
  { type: "steps", title: "Four gated phases", steps: [
    { title: "Shadow traffic", description: "Mirror production reads into the new region. No writes." },
    { title: "Read cutover",   description: "Serve reads from the nearest region behind a feature flag." },
    { title: "Write cutover",  description: "Promote the new primary during a low-traffic window." },
    { title: "Decommission",   description: "Retire the legacy load balancer once metrics hold for two weeks." },
  ] },

  { type: "heading", text: "Delivery Timeline", level: 1 },
  { type: "timeline", title: "Twelve-month plan", events: [
    { date: "Q1", title: "Foundations",  description: "Infra as code, staging parity", status: "done" },
    { date: "Q2", title: "Shadow mode",  description: "Mirrored reads in region two", status: "done" },
    { date: "Q3", title: "Read cutover", description: "Flagged rollout to 25% of teams", status: "active" },
    { date: "Q4", title: "Full failover", description: "Automatic regional failover", status: "upcoming" },
  ] },

  { type: "heading", text: "Cost Split", level: 1 },
  { type: "chart", chart_type: "donut", title: "Where the infrastructure budget goes", unit: "K",
    categories: ["Compute", "Storage", "Network", "Observability"],
    series: [{ name: "Monthly spend", values: [82, 24, 18, 11] }],
    takeaway: "Compute is two-thirds of spend, so that is the only line worth optimising first." },

  { type: "heading", text: "Public Endpoints", level: 1 },
  { type: "api_table", title: "Gateway surface", endpoints: [
    { method: "POST",   path: "/api/agent/chat",     description: "Submit a prompt and stream the response", auth: true,  status: "stable" },
    { method: "GET",    path: "/api/agent/history",  description: "Paginated conversation history",          auth: true,  status: "stable" },
    { method: "POST",   path: "/api/docs/generate",  description: "Generate a PDF or deck from a topic",     auth: true,  status: "beta" },
    { method: "GET",    path: "/api/billing/usage",  description: "Current period credit usage",             auth: true,  status: "stable" },
    { method: "DELETE", path: "/api/agent/session",  description: "Terminate an active session",             auth: true,  status: "deprecated" },
  ] },

  { type: "heading", text: "Client Setup", level: 1 },
  { type: "code", title: "Minimal client", language: "javascript",
    description: "The whole integration, with retries left to the SDK.",
    code: "import { Client } from \"@cldx/sdk\";\n\nconst client = new Client({\n  apiKey: process.env.CLDX_API_KEY,\n  region: \"eu-west-1\",\n});\n\nconst reply = await client.chat({\n  prompt: \"Summarise last week's incidents\",\n  stream: true,\n});" },

  { type: "heading", text: "Two Ways to Scale", level: 1 },
  { type: "two_col", title: "Scaling strategy", columns: [
    { title: "Vertical", text: "Bigger machines, same topology.", items: ["Simplest to reason about", "Hard ceiling per instance", "Downtime on every resize"] },
    { title: "Horizontal", text: "More machines, shared nothing.", items: ["No practical ceiling", "Needs stateless services", "Rolling restarts are free"] },
  ] },

  { type: "heading", text: "What Operators Say", level: 1 },
  { type: "quote", text: "We stopped paging for capacity six weeks after the read cutover. That is the entire return on this project.", source: "Platform lead, pilot customer" },

  { type: "conclusion", title: "Where This Lands", points: [
    "Multi-region is a reliability fix first and a latency fix second.",
    "Compute is two-thirds of spend — optimise there or nowhere.",
    "The rollout is gated at four points; any gate can hold without blocking the rest.",
    "Full regional failover is a Q4 commitment, not a stretch goal.",
  ] },
];

// ─── Harness ──────────────────────────────────────────────────────────────────

async function main() {
  const outDir = process.argv[2] ?? path.join(process.cwd(), "docgen", "temp");
  const theme  = process.env.PREVIEW_THEME ?? "professional";
  await fs.mkdir(outDir, { recursive: true });

  const raw = {
    version: SCHEMA_VERSION,
    meta: { title: "Platform Architecture Review", author: "cldxAI", theme,
            subject: "Infrastructure direction and rollout plan" },
    blocks: BLOCKS,
  };

  const validation = validate(raw, "preview");
  if (!validation.doc) {
    console.error("✖ Fixture failed validation:", validation.error);
    process.exit(1);
  }

  let doc = normalize(validation.doc, "preview").doc;
  doc = enhance(doc, "preview").doc;

  const composed = compose(doc, OUTLINE, { jobId: "preview", format: "pdf" });
  doc = composed.doc;

  console.log(`\nSections (${doc.sections.length}):`);
  for (const s of doc.sections) {
    console.log(`  ${String(s.layout).padEnd(14)} ${s.title ?? ""}`);
  }
  if (composed.changes.length) {
    console.log("\nComposer changes:");
    for (const c of composed.changes) console.log(`  · ${c}`);
  }

  // ── PDF ────────────────────────────────────────────────────────────────
  const html = renderDocument(doc);
  await fs.writeFile(path.join(outDir, "preview.html"), html);

  const pdf = await exportDocument({ type: "pdf", html, document: doc, jobId: "preview" });
  await fs.writeFile(path.join(outDir, "preview.pdf"), pdf);
  console.log(`\n✓ preview.pdf   ${(pdf.length / 1024).toFixed(0)} KB · ${pdf.pageCount} pages`);

  // ── PPTX ───────────────────────────────────────────────────────────────
  // Decks compose without the PDF-only section breaks.
  const deckDoc = compose(doc, OUTLINE, { jobId: "preview", format: "pptx" }).doc;
  const pptx = await exportDocument({ type: "pptx", document: deckDoc, jobId: "preview" });
  await fs.writeFile(path.join(outDir, "preview.pptx"), pptx);
  console.log(`✓ preview.pptx  ${(pptx.length / 1024).toFixed(0)} KB · ${pptx.pageCount} slides`);

  console.log(`\nOutput: ${outDir}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("\n✖ Preview failed:", err);
  process.exit(1);
});
