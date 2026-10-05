// Recovering a tool call from a model that writes it into the reply text.
//
// The false-positive direction matters more than the false-negative one here.
// A missed call means the model answers without a tool, which is the behaviour
// that already existed. A spurious call means a *coding* agent -- whose replies
// are mostly JSON and code -- starts executing its own output.

import assert from "node:assert/strict";
import test from "node:test";

import { parseTextToolCalls, textToolContract } from "../utils/mcp/textCalls.js";

const specs = [
  { name: "manim_render", description: "Render a Manim scene." },
  { name: "read_file", description: "Read a file." }
];

test("the shape a local model actually emits is recovered", () => {

  // Measured from Ollama + qwen2.5-coder:7b: `name`, not `tool`.
  const calls = parseTextToolCalls(
    '{"name": "manim_render", "arguments": {"scene": "Plot"}}',
    specs
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "manim_render");
  assert.deepEqual(calls[0].args, { scene: "Plot" });

});

test("the documented shape is recovered", () => {
  const calls = parseTextToolCalls('{"tool":"read_file","arguments":{"path":"a.js"}}', specs);
  assert.equal(calls[0].name, "read_file");
});

test("a fenced call is recovered", () => {
  const calls = parseTextToolCalls(
    '```json\n{"tool":"read_file","arguments":{"path":"a.js"}}\n```',
    specs
  );
  assert.equal(calls.length, 1);
});

test("a call wrapped in a courtesy sentence is recovered", () => {
  const calls = parseTextToolCalls(
    'Sure, I will render that: {"tool":"manim_render","arguments":{"scene":"P"}}',
    specs
  );
  assert.equal(calls.length, 1);
});

test("stringified arguments are parsed", () => {
  const calls = parseTextToolCalls(
    '{"tool":"read_file","arguments":"{\\"path\\":\\"a.js\\"}"}',
    specs
  );
  assert.deepEqual(calls[0].args, { path: "a.js" });
});

test("braces inside a string argument do not truncate the object", () => {
  const calls = parseTextToolCalls(
    '{"tool":"read_file","arguments":{"path":"a } b.js"}}',
    specs
  );
  assert.equal(calls[0].args.path, "a } b.js");
});

// ── the direction that matters ─────────────────────────────────────────────

test("a tool name that was not offered is not a call", () => {
  assert.deepEqual(parseTextToolCalls('{"tool":"rm_rf","arguments":{}}', specs), []);
});

test("a JSON code sample is not executed as a call", () => {
  // The exact hazard of wiring this into a coding agent.
  const reply = 'Here is your config:\n```json\n{"name": "my-app", "version": "1.0.0"}\n```';
  assert.deepEqual(parseTextToolCalls(reply, specs), []);
});

test("a package.json whose name collides with a tool is not a call", () => {

  // The tool-name allowlist alone does not catch this, and a coding agent
  // emits package.json constantly. The object must also look like a call.
  const reply = '{"name": "read_file", "version": "1.0.0", "scripts": {}}';

  assert.deepEqual(parseTextToolCalls(reply, specs), []);

});

test("an argument-less call is still recovered", () => {

  // Legitimate but rare, so it is accepted only when the object contains
  // nothing that is not part of a call.
  const calls = parseTextToolCalls('{"tool":"read_file"}', specs);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, {});

});

test("prose is not a call", () => {
  assert.deepEqual(parseTextToolCalls("I plotted the parabola for you.", specs), []);
});

test("malformed JSON is not a call", () => {
  assert.deepEqual(parseTextToolCalls('{"tool":"read_file","arguments":{', specs), []);
});

test("an empty or missing reply is not a call", () => {
  assert.deepEqual(parseTextToolCalls("", specs), []);
  assert.deepEqual(parseTextToolCalls(null, specs), []);
  assert.deepEqual(parseTextToolCalls(undefined, specs), []);
});

test("array-shaped content from a provider is handled", () => {
  const content = [{ text: '{"tool":"read_file","arguments":{"path":"a.js"}}' }];
  assert.equal(parseTextToolCalls(content, specs).length, 1);
});

test("no tools offered means nothing can be recovered", () => {
  assert.deepEqual(parseTextToolCalls('{"tool":"read_file","arguments":{}}', []), []);
});

test("the contract names every offered tool", () => {
  const contract = textToolContract(specs);
  assert.match(contract, /manim_render/);
  assert.match(contract, /read_file/);
});
