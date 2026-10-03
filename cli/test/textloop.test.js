import assert from "node:assert/strict";
import test from "node:test";

import { constraintFor, toolCallSchema } from "../src/constrain.js";
import {
  looksLikeAttemptedCall,
  parseTextToolCall,
  runTextToolLoop,
  toolInstructions
} from "../src/textloop.js";
import { startFakeRuntime } from "./helpers/fakeRuntime.js";

const echo = {
  name: "echo",
  description: "Echo the input.",
  parameters: { type: "object", properties: { text: { type: "string" } } },
  run: async ({ text }) => `echoed:${text}`
};

const tools = [echo];

const context = (runtime, name = "Ollama") => ({
  baseUrl: runtime.baseUrl,
  apiKey: "not-needed",
  model: "test",
  runtime: name,
  timeoutMs: 4000
});

const reply = (content) => ({ message: { content } });

// ── parsing ────────────────────────────────────────────────────────────────

test("a bare call is parsed", () => {
  const call = parseTextToolCall('{"tool":"echo","arguments":{"text":"hi"}}', tools);
  assert.equal(call.function.name, "echo");
  assert.deepEqual(JSON.parse(call.function.arguments), { text: "hi" });
});

test("the shape the local model actually emits is parsed", () => {
  // What qwen2.5-coder:7b produced when probed: `name`, not `tool`.
  const call = parseTextToolCall('{"name": "echo", "arguments": {"text": "hi"}}', tools);
  assert.equal(call.function.name, "echo");
});

test("a fenced call is parsed", () => {
  const call = parseTextToolCall('```json\n{"tool":"echo","arguments":{"text":"hi"}}\n```', tools);
  assert.equal(call.function.name, "echo");
});

test("a call wrapped in a courtesy sentence is parsed", () => {
  // Discarding this would waste a generation that was substantively correct.
  const call = parseTextToolCall('Sure! {"tool":"echo","arguments":{"text":"hi"}} Hope that helps.', tools);
  assert.equal(call.function.name, "echo");
});

test("braces inside a string argument do not end the object early", () => {
  const call = parseTextToolCall('{"tool":"echo","arguments":{"text":"a } b"}}', tools);
  assert.equal(JSON.parse(call.function.arguments).text, "a } b");
});

test("prose is not a call", () => {
  assert.equal(parseTextToolCall("The answer is 42.", tools), null);
});

test("a name no tool answers to is not a call", () => {
  // Otherwise a sentence that merely contains JSON earns the model an error.
  assert.equal(parseTextToolCall('{"tool":"rm_rf","arguments":{}}', tools), null);
});

test("malformed JSON is not a call", () => {
  assert.equal(parseTextToolCall('{"tool":"echo", "arguments":{', tools), null);
});

// ── when the constrained retry should fire ─────────────────────────────────

test("an attempted call is recognised as an attempt", () => {
  assert.equal(looksLikeAttemptedCall('{"tool":"echo", "arguments":{'), true);
  assert.equal(looksLikeAttemptedCall('I will use "tool": "echo"'), true);
});

test("a prose answer is not an attempted call", () => {
  // Retrying here would force a tool call the model did not want to make.
  assert.equal(looksLikeAttemptedCall("There are nine words in that sentence."), false);
});

// ── the runtime levers ─────────────────────────────────────────────────────

test("each runtime gets the lever it actually implements", () => {
  const schema = toolCallSchema(tools);
  assert.deepEqual(constraintFor("Ollama", schema), { format: schema });
  assert.deepEqual(constraintFor("vLLM", schema), { guided_json: schema });
  assert.equal(constraintFor("SGLang", schema).response_format.type, "json_schema");
  assert.deepEqual(constraintFor("llama.cpp", schema), { json_schema: schema });
});

test("an unknown runtime still gets valid JSON forced", () => {
  assert.deepEqual(
    constraintFor("something-else", toolCallSchema(tools)),
    { response_format: { type: "json_object" } }
  );
});

test("the schema only permits tools that exist", () => {
  assert.deepEqual(toolCallSchema(tools).properties.tool.enum, ["echo"]);
});

// ── the loop ───────────────────────────────────────────────────────────────

test("a text call is executed and its result answered from", async (t) => {

  const runtime = await startFakeRuntime([
    reply('{"tool":"echo","arguments":{"text":"hi"}}'),
    reply("The tool said hi.")
  ]);

  t.after(() => runtime.close());

  const messages = [{ role: "user", content: "use echo" }];

  const outcome = await runTextToolLoop(context(runtime), messages, tools);

  assert.equal(outcome.content, "The tool said hi.");
  assert.equal(outcome.retries, 0);

  // Fed back as a user turn: a model with no tool_calls generally has no tool
  // role in its chat template either, and some runtimes drop unknown roles
  // silently -- which looks exactly like the tool returning nothing.
  assert.equal(messages.at(-1).role, "user");
  assert.match(messages.at(-1).content, /echoed:hi/);

});

test("a malformed call triggers one constrained retry, with the runtime's lever", async (t) => {

  const runtime = await startFakeRuntime([
    reply('{"tool":"echo", "arguments":{'),
    reply('{"tool":"echo","arguments":{"text":"hi"}}'),
    reply("done")
  ]);

  t.after(() => runtime.close());

  const outcome = await runTextToolLoop(
    context(runtime, "Ollama"),
    [{ role: "user", content: "go" }],
    tools
  );

  assert.equal(outcome.retries, 1);
  assert.equal(outcome.content, "done");

  // The retry must actually carry the constraint, or it is just a second guess.
  assert.ok(runtime.requests[1].body.format, "the retry did not constrain the decoder");

});

test("a prose answer never triggers a retry", async (t) => {

  const runtime = await startFakeRuntime(reply("Nine words."));

  t.after(() => runtime.close());

  const outcome = await runTextToolLoop(context(runtime), [{ role: "user", content: "go" }], tools);

  assert.equal(outcome.retries, 0);
  assert.equal(outcome.content, "Nine words.");
  assert.equal(runtime.requests.length, 1);

});

test("a model that cannot be forced returns its original reply, not an invention", async (t) => {

  const runtime = await startFakeRuntime(reply('{"tool":"echo", "arguments":{'));

  t.after(() => runtime.close());

  const outcome = await runTextToolLoop(context(runtime), [{ role: "user", content: "go" }], tools);

  assert.equal(outcome.retries, 1);
  assert.match(outcome.content, /\{"tool":"echo"/);

});

test("a model that only ever calls tools is stopped", async (t) => {

  const runtime = await startFakeRuntime(reply('{"tool":"echo","arguments":{"text":"again"}}'));

  t.after(() => runtime.close());

  const outcome = await runTextToolLoop(context(runtime), [{ role: "user", content: "go" }], tools);

  assert.equal(outcome.exhausted, true);

});

test("the contract names every tool and its arguments", () => {
  const contract = toolInstructions(tools);
  assert.match(contract, /echo\(text\)/);
  assert.match(contract, /Echo the input\./);
});
