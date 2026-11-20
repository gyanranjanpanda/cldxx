import crypto from "node:crypto";
import { diagnosticLogger } from "./diagnosticLogger.js";
import { summarizePayload, sanitizeText } from "./traceSanitizer.js";

/**
 * Creates an execution trace correlation context for a single user turn.
 */
export const createTrace = ({
  conversationId,
  userId = "anonymous",
  prompt = "",
  agent = "chat",
  isIncognito = false,
  zone = "CLOUD",
}) => {
  const randomSuffix = crypto.randomBytes(3).toString("hex");
  const traceId = `turn-${Date.now()}-${randomSuffix}`;
  const startedAt = Date.now();

  const traceContext = {
    traceId,
    conversationId: conversationId || `unknown-${randomSuffix}`,
    userId,
    agent,
    isIncognito: Boolean(isIncognito),
    zone,
    startedAt,
    activeSpans: new Map(),
  };

  diagnosticLogger.writeRecord({
    timestamp: new Date().toISOString(),
    traceId,
    conversationId: traceContext.conversationId,
    stage: "INGRESS",
    status: "OK",
    durationMs: 0,
    message: `Received request for agent '${agent}' [${zone}, incognito=${isIncognito}]`,
    details: {
      agent,
      zone,
      isIncognito,
      promptPreview: sanitizeText(prompt, 300),
      promptLengthChars: prompt ? String(prompt).length : 0,
    },
  });

  return traceContext;
};

/**
 * Measures the execution duration of an asynchronous pipeline operation.
 * If the operation throws, records a BREAKPOINT with the exact failing stage.
 */
export const traceSpan = async (trace, stageName, asyncOperation, metadata = {}) => {
  const spanStartTime = Date.now();
  try {
    const outcome = await asyncOperation();
    const durationMs = Date.now() - spanStartTime;

    const record = {
      timestamp: new Date().toISOString(),
      traceId: trace.traceId,
      conversationId: trace.conversationId,
      stage: stageName,
      status: "OK",
      durationMs,
      elapsedSinceIngressMs: Date.now() - trace.startedAt,
      message: `Completed ${stageName}`,
      details: summarizePayload(metadata, 300),
    };

    // Flag high latency warnings
    if (durationMs > 5000) {
      record.status = "WARN";
      record.message = `High latency detected in ${stageName} (+${durationMs}ms)`;
    }

    diagnosticLogger.writeRecord(record);
    return outcome;
  } catch (caughtError) {
    const durationMs = Date.now() - spanStartTime;
    const elapsedSinceIngressMs = Date.now() - trace.startedAt;

    recordBreakpoint(trace, stageName, caughtError, {
      ...metadata,
      durationMs,
      elapsedSinceIngressMs,
    });

    throw caughtError;
  }
};

/**
 * Records a failure breakpoint with error details, status code, and stack trace.
 */
export const recordBreakpoint = (trace, stageName, error, metadata = {}) => {
  const elapsedSinceIngressMs = Date.now() - trace.startedAt;

  diagnosticLogger.writeRecord({
    timestamp: new Date().toISOString(),
    traceId: trace.traceId,
    conversationId: trace.conversationId,
    stage: stageName,
    status: "BREAKPOINT",
    durationMs: metadata.durationMs !== undefined ? metadata.durationMs : 0,
    elapsedSinceIngressMs,
    message: `Pipeline broke at ${stageName}: ${error?.message || "Unknown error"}`,
    details: summarizePayload(metadata, 300),
    error: {
      name: error?.name || "Error",
      message: error?.message || String(error),
      code: error?.code || null,
      status: error?.status || error?.response?.status || null,
      stack: error?.stack ? sanitizeText(error.stack, 800) : null,
    },
  });
};

/**
 * Records an informational or warning milestone during request processing.
 */
export const recordEvent = (
  trace,
  stageName,
  message,
  metadata = {},
  status = "OK"
) => {
  diagnosticLogger.writeRecord({
    timestamp: new Date().toISOString(),
    traceId: trace.traceId,
    conversationId: trace.conversationId,
    stage: stageName,
    status,
    elapsedSinceIngressMs: Date.now() - trace.startedAt,
    message,
    details: summarizePayload(metadata, 300),
  });
};

/**
 * Closes the trace and logs the final output egress summary.
 */
export const endTrace = (trace, responsePayload = {}) => {
  const totalDurationMs = Date.now() - trace.startedAt;

  diagnosticLogger.writeRecord({
    timestamp: new Date().toISOString(),
    traceId: trace.traceId,
    conversationId: trace.conversationId,
    stage: "EGRESS",
    status: "OK",
    durationMs: totalDurationMs,
    message: `Request finished successfully in ${totalDurationMs}ms`,
    details: {
      totalDurationMs,
      answerLength: responsePayload.answer ? String(responsePayload.answer).length : 0,
      imageCount: Array.isArray(responsePayload.images) ? responsePayload.images.length : 0,
      artifactCount: Array.isArray(responsePayload.artifacts) ? responsePayload.artifacts.length : 0,
      answerPreview: responsePayload.answer ? sanitizeText(responsePayload.answer, 200) : "",
    },
  });
};
