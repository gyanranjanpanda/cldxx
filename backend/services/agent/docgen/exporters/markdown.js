/**
 * Markdown Exporter — plain text fallback.
 * Converts document JSON to a markdown string.
 */

import { bus } from "../events/bus.js";

/**
 * @param {import("../schemas/document.schema.js").Document} doc
 * @param {string} [jobId]
 * @returns {Buffer}
 */
export function exportMarkdown(doc, jobId = "") {
  bus.emit("export.started", { jobId, format: "markdown" });

  const lines = [];
  lines.push(`# ${doc.meta.title}\n`);
  if (doc.meta.author) lines.push(`*${doc.meta.author}*\n`);
  lines.push("---\n");

  for (const block of doc.blocks) {
    switch (block.type) {
      case "cover":
      case "toc":
      case "divider":
        break; // Skip structural blocks in markdown

      case "heading":
        lines.push(`${"#".repeat(block.level || 1)} ${block.text}\n`);
        break;

      case "paragraph":
        lines.push(`${block.text}\n`);
        break;

      case "bullets":
        if (block.title) lines.push(`### ${block.title}\n`);
        block.items.forEach((item) => lines.push(`- ${item}`));
        lines.push("");
        break;

      case "stats":
        if (block.title) lines.push(`### ${block.title}\n`);
        block.items.forEach((s) => lines.push(`- **${s.label}**: ${s.value}`));
        lines.push("");
        break;

      case "table":
        if (block.title) lines.push(`### ${block.title}\n`);
        lines.push(`| ${block.columns.join(" | ")} |`);
        lines.push(`| ${block.columns.map(() => "---").join(" | ")} |`);
        block.rows.forEach((r) => lines.push(`| ${r.join(" | ")} |`));
        lines.push("");
        break;

      case "code":
        if (block.title) lines.push(`### ${block.title}\n`);
        if (block.description) lines.push(`${block.description}\n`);
        lines.push(`\`\`\`${block.language || ""}\n${block.code}\n\`\`\`\n`);
        break;

      case "mermaid":
        if (block.title) lines.push(`### ${block.title}\n`);
        lines.push(`\`\`\`mermaid\n${block.source}\n\`\`\`\n`);
        break;

      case "quote":
        lines.push(`> ${block.text}`);
        if (block.source) lines.push(`> — *${block.source}*`);
        lines.push("");
        break;

      case "callout":
        lines.push(`> **${block.variant?.toUpperCase()}**: ${block.title || ""}`);
        lines.push(`> ${block.text}\n`);
        break;

      case "conclusion":
        lines.push(`## ${block.title}\n`);
        block.points.forEach((p) => lines.push(`- ${p}`));
        lines.push("");
        break;

      default:
        lines.push(`<!-- Unknown block: ${block.type} -->\n`);
    }
  }

  const md = lines.join("\n");
  const buffer = Buffer.from(md, "utf-8");
  bus.emit("export.finished", { jobId, format: "markdown", byteSize: buffer.length });
  return buffer;
}
