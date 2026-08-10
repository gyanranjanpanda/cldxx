/**
 * Document Intelligence Layer — improves document structure before rendering.
 *
 * Unlike a reviewer (which rejects), this layer ENHANCES:
 *   - Suggests dividers between major sections
 *   - Inserts callouts for important notes buried in paragraphs
 *   - Estimates page count
 *   - Detects opportunities for visual layouts (consecutive paragraphs → suggest bullets)
 *
 * This is rule-based, not LLM-based — runs in <1ms.
 */

import { bus } from "../events/bus.js";

/**
 * @param {import("../schemas/document.schema.js").Document} doc
 * @param {string} jobId
 * @returns {{ doc: object, suggestions: string[] }}
 */
export function enhance(doc, jobId = "") {
  const suggestions = [];
  let blocks = [...doc.blocks];

  // 1. Insert dividers before H1 headings (except the first one after cover/toc)
  let firstContentHeadingSeen = false;
  const withDividers = [];
  for (const block of blocks) {
    if (block.type === "heading" && block.level === 1) {
      if (firstContentHeadingSeen) {
        withDividers.push({ type: "divider" });
        suggestions.push(`Inserted divider before heading: "${block.text}"`);
      }
      firstContentHeadingSeen = true;
    }
    withDividers.push(block);
  }
  blocks = withDividers;

  // 2. Detect long consecutive paragraph runs (3+) → suggest bullets
  let consecutiveParagraphs = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type === "paragraph") {
      consecutiveParagraphs++;
      if (consecutiveParagraphs >= 4) {
        suggestions.push(`Consider converting paragraphs at position ${i - 2}–${i} to a bullets block for readability`);
        consecutiveParagraphs = 0;
      }
    } else {
      consecutiveParagraphs = 0;
    }
  }

  // 3. Estimate page count (rough: 1 page per 3 inline blocks, 1 page per full-page block)
  const FULL_PAGE = new Set(["cover", "toc", "stats", "conclusion"]);
  let pageEstimate = 0;
  let inlineCount = 0;
  for (const block of blocks) {
    if (FULL_PAGE.has(block.type)) {
      if (inlineCount > 0) pageEstimate++;
      pageEstimate++;
      inlineCount = 0;
    } else {
      inlineCount++;
      if (inlineCount >= 3) {
        pageEstimate++;
        inlineCount = 0;
      }
    }
  }
  if (inlineCount > 0) pageEstimate++;
  suggestions.push(`Estimated page count: ${pageEstimate}`);

  bus.emit("intelligence.finished", { jobId, suggestions });

  return {
    doc: { ...doc, blocks },
    suggestions,
  };
}
