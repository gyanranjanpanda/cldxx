import { EventEmitter } from "events";

/**
 * Internal event bus — every pipeline stage emits events here.
 * Subscribers (analytics, cache, metrics, notifications) attach listeners
 * without coupling to pipeline internals.
 *
 * Events emitted:
 *   planner.started   { jobId, topic }
 *   planner.finished  { jobId, outline }
 *   writer.started    { jobId, sectionCount }
 *   writer.section    { jobId, sectionId, blockCount }
 *   writer.finished   { jobId, blockCount }
 *   validator.finished{ jobId, valid, issues }
 *   normalizer.finished { jobId, changes }
 *   intelligence.finished { jobId, suggestions }
 *   layout.finished   { jobId }
 *   render.started    { jobId }
 *   render.finished   { jobId, htmlSize }
 *   export.started    { jobId, format }
 *   export.finished   { jobId, format, byteSize }
 *   pipeline.error    { jobId, stage, error }
 */
class DocumentBus extends EventEmitter {
  /** @param {string} event @param {Record<string, unknown>} payload */
  emit(event, payload = {}) {
    // Always stamp with ISO timestamp for metrics
    super.emit(event, { ...payload, ts: new Date().toISOString() });
    // Also forward to wildcard listener for logging
    super.emit("*", { event, ...payload, ts: new Date().toISOString() });
    return true;
  }
}

export const bus = new DocumentBus();

// Default: log all events in dev
if (process.env.NODE_ENV !== "production") {
  bus.on("*", ({ event, ts, ...rest }) => {
    const summary = Object.entries(rest)
      .filter(([, v]) => typeof v !== "object")
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    console.log(`[docgen] ${event} ${summary}`);
  });
}
