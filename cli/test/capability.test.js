import assert from "node:assert/strict";
import test from "node:test";

import { canExecuteTools, MODES, probeToolCalling } from "../src/capability.js";
import { startFakeRuntime } from "./helpers/fakeRuntime.js";

const probeAgainst = async (t, message) => {

  const runtime = await startFakeRuntime(message);

  t.after(() => runtime.close());

  return probeToolCalling({
    baseUrl: runtime.baseUrl,
    apiKey: "not-needed",
    model: "test",
    timeoutMs: 4000
  });

};

test("native: a well-formed tool_calls entry", async (t) => {

  const result = await probeAgainst(t, {
    message: {
      tool_calls: [
        { id: "1", function: { name: "ping", arguments: '{"message":"hello"}' } }
      ]
    }
  });

  assert.equal(result.mode, MODES.NATIVE);
  assert.equal(canExecuteTools(result.mode), true);

});

test("not native: a tool_calls entry whose arguments are not JSON", async (t) => {

  // The same failure one layer in. Treating this as native would hand the
  // executor garbage on the first real call, which is a worse outcome than
  // never offering tools at all.
  const result = await probeAgainst(t, {
    message: {
      tool_calls: [{ id: "1", function: { name: "ping", arguments: "message=hello" } }]
    }
  });

  assert.notEqual(result.mode, MODES.NATIVE);

});

test("constrained: the call arrives as text", async (t) => {

  // What Ollama + qwen2.5-coder:7b actually does, which is why this row of the
  // branch exists at all.
  const result = await probeAgainst(t, {
    message: { content: '{"name": "ping", "arguments": {"message": "hello"}}' }
  });

  assert.equal(result.mode, MODES.CONSTRAINED);

  // Executable since step 6: the text protocol in textloop.js drives it. This
  // assertion read `false` while only the native path existed.
  assert.equal(canExecuteTools(result.mode), true);

});

test("constrained: the call arrives as fenced text", async (t) => {

  const result = await probeAgainst(t, {
    message: { content: '```json\n{"name":"ping","arguments":{"message":"hello"}}\n```' }
  });

  assert.equal(result.mode, MODES.CONSTRAINED);

});

test("react: the tool is named but no call is parseable", async (t) => {

  const result = await probeAgainst(t, {
    message: { content: "I would call ping with hello." }
  });

  assert.equal(result.mode, MODES.REACT);

});

test("read-only: the tool is ignored", async (t) => {

  const result = await probeAgainst(t, {
    message: { content: "Hello! How can I help you today?" }
  });

  assert.equal(result.mode, MODES.READ_ONLY);

  // The only mode with nothing left to drive -- there is no strategy for a
  // model that will not reach for a tool at all.
  assert.equal(canExecuteTools(result.mode), false);

});

test("read-only: the runtime rejects a request carrying tools", async (t) => {

  const result = await probeAgainst(t, { status: 400, body: "unexpected field: tools" });

  assert.equal(result.mode, MODES.READ_ONLY);
  assert.match(result.evidence, /refused/);

});

test("every mode carries evidence for why", async (t) => {

  const result = await probeAgainst(t, { message: { content: "hi" } });

  assert.ok(result.evidence.length > 0, "a mode with no evidence cannot be explained to a user");

});
