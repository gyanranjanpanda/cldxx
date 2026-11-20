import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sanitizeText, summarizePayload } from "../utils/diagnostics/traceSanitizer.js";
import { diagnosticLogger, PRIMARY_LOG_PATH } from "../utils/diagnostics/diagnosticLogger.js";
import { createTrace, traceSpan, recordBreakpoint, recordEvent, endTrace } from "../utils/diagnostics/tracer.js";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));

const runDiagnosticsTestSuite = async () => {
  console.log("▶ Running Diagnostics & Breakpoint Logger Test Suite...");

  // 1. Test Sanitization
  console.log("  1. Testing traceSanitizer secret redaction...");
  const rawSecretPrompt = "My Groq key is gsk_12345678901234567890abc and bearer eyJhbGciOiJIUzI1NiJ9";
  const sanitized = sanitizeText(rawSecretPrompt);
  assert.ok(!sanitized.includes("gsk_12345678901234567890abc"), "Groq API key must be redacted");
  assert.ok(!sanitized.includes("eyJhbGciOiJIUzI1NiJ9"), "Bearer token must be redacted");
  assert.ok(sanitized.includes("[REDACTED_SECRET]"), "Placeholder must be inserted");

  const summary = summarizePayload({
    userToken: "secret_value_12345",
    prompt: "Hello, how are you?",
    options: { temperature: 0.7 },
  });
  assert.equal(summary.userToken, "[REDACTED]", "Sensitive object keys must be redacted");
  assert.equal(summary.prompt, "Hello, how are you?");

  // 2. Test Tracer Lifecycle
  console.log("  2. Testing tracer span execution and logging...");
  const initialLogSize = fs.existsSync(PRIMARY_LOG_PATH) ? fs.statSync(PRIMARY_LOG_PATH).size : 0;

  const mockTrace = createTrace({
    conversationId: "test-conv-12345",
    userId: "test-user-diagnostics",
    prompt: "Test diagnostic logging prompt",
    agent: "chat",
    isIncognito: true,
    zone: "CLOUD",
  });

  assert.ok(mockTrace.traceId.startsWith("turn-"), "Trace ID should begin with 'turn-'");
  assert.equal(mockTrace.isIncognito, true, "Incognito flag preserved");

  // Run a successful span
  const operationOutput = await traceSpan(mockTrace, "TEST_STAGE_SUCCESS", async () => {
    return { status: "processed", score: 99 };
  }, { metadataKey: "metadataValue" });
  assert.equal(operationOutput.status, "processed");

  // Run a failing span to verify breakpoint capture
  console.log("  3. Testing breakpoint interception and diagnostics capture...");
  let caughtException = null;
  try {
    await traceSpan(mockTrace, "TEST_STAGE_BREAKPOINT", async () => {
      const simulatedFailure = new Error("Simulated upstream provider rate limit (429)");
      simulatedFailure.status = 429;
      simulatedFailure.code = "RATE_LIMITED";
      throw simulatedFailure;
    }, { attemptedUrl: "https://api.groq.com/v1/chat" });
  } catch (error) {
    caughtException = error;
  }
  assert.ok(caughtException !== null, "Exception must be re-thrown by traceSpan");
  assert.equal(caughtException.status, 429);

  // Close the trace
  endTrace(mockTrace, { answer: "Test response text completed", images: [] });

  // 3. Verify Log File Content
  console.log("  4. Verifying logs/execution.log output contents...");
  assert.ok(fs.existsSync(PRIMARY_LOG_PATH), "execution.log must exist on disk");
  const finalLogSize = fs.statSync(PRIMARY_LOG_PATH).size;
  assert.ok(finalLogSize > initialLogSize, "Log file size must have increased");

  const logLines = fs.readFileSync(PRIMARY_LOG_PATH, "utf8").trim().split("\n");
  const matchingLines = logLines
    .filter((line) => line.includes(mockTrace.traceId))
    .map((line) => JSON.parse(line));

  assert.ok(matchingLines.length >= 4, "Should have INGRESS, SUCCESS, BREAKPOINT, and EGRESS records");

  const ingressRecord = matchingLines.find((r) => r.stage === "INGRESS");
  assert.ok(ingressRecord, "Must contain INGRESS record");
  assert.equal(ingressRecord.details.isIncognito, true);

  const breakpointRecord = matchingLines.find((r) => r.stage === "TEST_STAGE_BREAKPOINT");
  assert.ok(breakpointRecord, "Must contain BREAKPOINT record");
  assert.equal(breakpointRecord.status, "BREAKPOINT");
  assert.equal(breakpointRecord.error.status, 429);
  assert.equal(breakpointRecord.error.code, "RATE_LIMITED");
  assert.ok(breakpointRecord.error.message.includes("Simulated upstream provider rate limit"));

  const egressRecord = matchingLines.find((r) => r.stage === "EGRESS");
  assert.ok(egressRecord, "Must contain EGRESS record");
  assert.ok(egressRecord.durationMs >= 0);

  console.log("✅ All diagnostic logger tests passed successfully!");
};

runDiagnosticsTestSuite().catch((suiteError) => {
  console.error("❌ Diagnostics test suite failed:", suiteError);
  process.exit(1);
});
