import assert from "node:assert/strict";
import test from "node:test";

import { PolicyDenied } from "../src/policy.js";
import { runTool, runToolLoop } from "../src/tools.js";
import { startFakeRuntime } from "./helpers/fakeRuntime.js";

const echo = {
  name: "echo",
  description: "Echo the input.",
  parameters: { type: "object", properties: { text: { type: "string" } } },
  run: async ({ text }) => `echoed:${text}`
};

const call = (name, args, id = "call-1") => ({
  id,
  function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) }
});

const context = (runtime) => ({
  baseUrl: runtime.baseUrl,
  apiKey: "not-needed",
  model: "test",
  timeoutMs: 4000
});

test("a tool runs and its result is stringified", async () => {
  assert.equal(await runTool([echo], call("echo", { text: "hi" })), "echoed:hi");
});

test("an unknown tool reports itself instead of throwing", async () => {
  assert.match(await runTool([echo], call("nope", {})), /no tool named/);
});

test("unparseable arguments come back as a correctable error", async () => {

  // The model can usually fix this on the next step. Throwing would make every
  // malformed call fatal, which on a small local model is most of them.
  const result = await runTool([echo], call("echo", "{not json"));

  assert.match(result, /not valid JSON/);

});

test("a throwing tool reports the error rather than ending the turn", async () => {

  const broken = { ...echo, name: "broken", run: async () => { throw new Error("disk on fire"); } };

  assert.match(await runTool([broken], call("broken", {})), /disk on fire/);

});

test("a policy refusal from a tool is not swallowed", async () => {

  // The one exception. CODE-00x is not something a model should get a chance to
  // work around by rephrasing its call.
  const guarded = {
    ...echo,
    name: "guarded",
    run: async () => { throw new PolicyDenied("nope", "CODE-001"); }
  };

  await assert.rejects(
    () => runTool([guarded], call("guarded", {})),
    (error) => error.rule === "CODE-001"
  );

});

test("the loop runs a tool, feeds the result back, and returns the answer", async (t) => {

  const runtime = await startFakeRuntime([
    { message: { tool_calls: [call("echo", { text: "hi" })] } },
    { message: { content: "The tool said hi." } }
  ]);

  t.after(() => runtime.close());

  const messages = [{ role: "user", content: "use echo" }];

  const outcome = await runToolLoop(context(runtime), messages, [echo]);

  assert.equal(outcome.content, "The tool said hi.");

  // The transcript must carry both the request and its result, or the next turn
  // cannot explain the answer it just gave.
  const roles = messages.map((entry) => entry.role);
  assert.deepEqual(roles, ["user", "assistant", "tool"]);
  assert.equal(messages[2].content, "echoed:hi");
  assert.equal(messages[2].tool_call_id, "call-1");

});

test("the second request carries the tool result back to the model", async (t) => {

  const runtime = await startFakeRuntime([
    { message: { tool_calls: [call("echo", { text: "hi" })] } },
    { message: { content: "done" } }
  ]);

  t.after(() => runtime.close());

  await runToolLoop(context(runtime), [{ role: "user", content: "go" }], [echo]);

  const second = runtime.requests[1].body.messages;

  assert.equal(second.at(-1).role, "tool");
  assert.equal(second.at(-1).content, "echoed:hi");

});

test("a model that only ever calls tools is stopped, not left to spin", async (t) => {

  const runtime = await startFakeRuntime({
    message: { tool_calls: [call("echo", { text: "again" })] }
  });

  t.after(() => runtime.close());

  const outcome = await runToolLoop(context(runtime), [{ role: "user", content: "go" }], [echo]);

  assert.equal(outcome.exhausted, true);
  assert.match(outcome.content, /Stopped after/);

});

test("tools are advertised to the runtime in OpenAI schema form", async (t) => {

  const runtime = await startFakeRuntime({ message: { content: "hi" } });

  t.after(() => runtime.close());

  await runToolLoop(context(runtime), [{ role: "user", content: "go" }], [echo]);

  const advertised = runtime.requests[0].body.tools[0];

  assert.equal(advertised.type, "function");
  assert.equal(advertised.function.name, "echo");
  assert.deepEqual(advertised.function.parameters, echo.parameters);

});
