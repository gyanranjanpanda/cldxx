/**
 * Validator — runs Zod schema validation on raw document JSON.
 * Part of the pipeline: Writer → Validator → Normalizer → Layout → Renderer
 */

import { validateDocument } from "../schemas/document.schema.js";
import { bus }              from "../events/bus.js";

/**
 * @param {unknown} raw — raw JSON from writer
 * @param {string}  jobId
 * @returns {{ doc: object } | { error: string, issues: string[] }}
 */
export function validate(raw, jobId = "") {
  const result = validateDocument(raw);

  if (result.doc) {
    bus.emit("validator.finished", { jobId, valid: true, issues: [] });
    return { doc: result.doc };
  }

  const issues = result.error.split("; ");
  bus.emit("validator.finished", { jobId, valid: false, issues });
  return { error: result.error, issues };
}
