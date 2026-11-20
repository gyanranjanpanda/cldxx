import { Buffer } from "node:buffer";

const SENSITIVE_KEY_PATTERNS = [
  /bearer\s+[a-zA-Z0-9_\-\.]+/gi,
  /(?:api[_-]?key|secret|password|token)["']?\s*[:=]\s*["']?([a-zA-Z0-9_\-\.]{8,})/gi,
  /gsk_[a-zA-Z0-9]{20,}/g, // Groq
  /sk-[a-zA-Z0-9]{20,}/g,  // OpenAI/DeepSeek
];

const DEFAULT_PREVIEW_LIMIT = 500;

/**
 * Strips known token shapes and API key patterns from loggable text.
 */
export const sanitizeText = (rawContent, previewLimit = DEFAULT_PREVIEW_LIMIT) => {
  if (rawContent === null || rawContent === undefined) {
    return "";
  }

  let sanitized = String(rawContent);
  for (const pattern of SENSITIVE_KEY_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED_SECRET]");
  }

  if (sanitized.length > previewLimit) {
    return `${sanitized.slice(0, previewLimit)}... [truncated, total ${sanitized.length} chars]`;
  }

  return sanitized;
};

/**
 * Creates a clean summary of an incoming or outgoing payload without mutating input.
 */
export const summarizePayload = (payload, previewLimit = DEFAULT_PREVIEW_LIMIT) => {
  if (payload === null || payload === undefined) {
    return null;
  }

  if (typeof payload === "string") {
    return sanitizeText(payload, previewLimit);
  }

  if (Buffer.isBuffer(payload)) {
    return `[Binary Buffer: ${payload.length} bytes]`;
  }

  if (typeof payload !== "object") {
    return payload;
  }

  if (Array.isArray(payload)) {
    return {
      type: "array",
      itemCount: payload.length,
      sample: payload.slice(0, 3).map((element) => summarizePayload(element, 200)),
    };
  }

  const safeObject = {};
  for (const [key, value] of Object.entries(payload)) {
    if (/key|secret|token|password|auth|credential/i.test(key)) {
      safeObject[key] = "[REDACTED]";
    } else if (typeof value === "string") {
      safeObject[key] = sanitizeText(value, 300);
    } else if (typeof value === "object" && value !== null) {
      safeObject[key] = summarizePayload(value, 200);
    } else {
      safeObject[key] = value;
    }
  }

  return safeObject;
};
