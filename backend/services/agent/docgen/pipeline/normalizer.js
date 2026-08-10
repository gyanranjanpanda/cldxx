/**
 * Normalizer — fixes structural issues before rendering.
 *
 * Responsibilities:
 *   - Assign unique IDs to heading blocks that lack them
 *   - Ensure first block is a cover (inject if missing)
 *   - Insert TOC after cover if missing
 *   - Remove empty arrays / null values
 *   - Deduplicate consecutive identical blocks
 *   - Ensure conclusion is the last block (move if needed)
 */

import { SCHEMA_VERSION } from "../schemas/document.schema.js";
import { bus }            from "../events/bus.js";

/**
 * @param {import("../schemas/document.schema.js").Document} doc — validated doc
 * @param {string} jobId
 * @returns {{ doc: object, changes: string[] }}
 */
export function normalize(doc, jobId = "") {
  const changes = [];
  let blocks = [...doc.blocks];

  // 1. Ensure version
  if (!doc.version) {
    doc.version = SCHEMA_VERSION;
    changes.push("Added schema version");
  }

  // 2. Ensure cover is first
  const coverIdx = blocks.findIndex((b) => b.type === "cover");
  if (coverIdx === -1) {
    blocks.unshift({
      type: "cover",
      title: doc.meta.title,
      subtitle: doc.meta.subject || "",
    });
    changes.push("Injected missing cover block");
  } else if (coverIdx !== 0) {
    const [cover] = blocks.splice(coverIdx, 1);
    blocks.unshift(cover);
    changes.push("Moved cover block to first position");
  }

  // 3. Ensure TOC after cover
  const hasToc = blocks.some((b) => b.type === "toc");
  if (!hasToc) {
    // Insert TOC after cover
    const insertAt = blocks[0]?.type === "cover" ? 1 : 0;
    blocks.splice(insertAt, 0, { type: "toc" });
    changes.push("Inserted auto-generated TOC");
  }

  // 4. Assign IDs to headings
  const seenIds = new Set();
  let headingCounter = 0;
  blocks = blocks.map((b) => {
    if (b.type !== "heading") return b;
    headingCounter++;
    if (!b.id) {
      const baseId = b.text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      let finalId = baseId || `section-${headingCounter}`;
      while (seenIds.has(finalId)) finalId = `${baseId}-${headingCounter}`;
      seenIds.add(finalId);
      changes.push(`Assigned ID '${finalId}' to heading '${b.text}'`);
      return { ...b, id: finalId };
    }
    seenIds.add(b.id);
    return b;
  });

  // 5. Deduplicate consecutive identical blocks
  const deduped = [blocks[0]];
  for (let i = 1; i < blocks.length; i++) {
    const prev = blocks[i - 1];
    const curr = blocks[i];
    if (curr.type === prev.type && curr.type === "paragraph" && curr.text === prev.text) {
      changes.push(`Removed duplicate paragraph: "${curr.text.slice(0, 40)}..."`);
      continue;
    }
    deduped.push(curr);
  }
  blocks = deduped;

  // 6. Ensure conclusion is last (if present)
  const conclusionIdx = blocks.findIndex((b) => b.type === "conclusion");
  if (conclusionIdx !== -1 && conclusionIdx !== blocks.length - 1) {
    const [conclusion] = blocks.splice(conclusionIdx, 1);
    blocks.push(conclusion);
    changes.push("Moved conclusion to last position");
  }

  bus.emit("normalizer.finished", { jobId, changes });

  return {
    doc: { ...doc, blocks },
    changes,
  };
}
