// The refusals, tested as refusals. Each of these is a rule that only matters
// on the day something is misconfigured, which is the day nobody is watching --
// so they are asserted rather than assumed.

import assert from "node:assert/strict";
import test from "node:test";

import { assertLoopback, PolicyDenied } from "../src/policy.js";
import { resolveZone } from "../src/zone.js";
import { pickModel } from "../src/discovery.js";

test("CODE-001: a loopback endpoint is allowed", async () => {
  await assertLoopback("http://127.0.0.1:11434/v1", { sovereign: true });
  await assertLoopback("http://[::1]:8000/v1", { sovereign: true });
});

test("CODE-001: an off-box endpoint is refused in sovereign mode", async () => {
  await assert.rejects(
    () => assertLoopback("http://198.51.100.10:8000/v1", { sovereign: true }),
    (error) => error.rule === "CODE-001"
  );
});

test("CODE-001: a name that does not resolve is refused, not assumed local", async () => {
  await assert.rejects(
    () => assertLoopback("http://nx.invalid/v1", { sovereign: true }),
    (error) => error.rule === "CODE-001"
  );
});

test("CODE-001: cloud mode is not subject to the loopback rule", async () => {
  await assertLoopback("http://198.51.100.10:8000/v1", { sovereign: false });
});

test("CODE-006: a restricted repository refuses --cloud", () => {
  assert.throws(
    () => resolveZone({ classification: "restricted" }, { cloud: true }),
    (error) => error instanceof PolicyDenied && error.rule === "CODE-006"
  );
});

test("CODE-006: a restricted repository is sovereign even when configured cloud", () => {
  const zone = resolveZone({ classification: "secret", zone: "cloud" }, {});
  assert.equal(zone.sovereign, true);
});

test("an unclassified repository may still be opened in cloud mode", () => {
  const zone = resolveZone({ classification: "internal" }, { cloud: true });
  assert.equal(zone.sovereign, false);
});

test("the default zone is sovereign, not cloud", () => {
  assert.equal(resolveZone({}, {}).sovereign, true);
});

test("an embedding model is never picked as the chat model", () => {
  const picked = pickModel(["nomic-embed-text:latest", "llava:7b"], null);
  assert.equal(picked, "llava:7b");
});

test("a coding model is preferred over a general one", () => {
  const picked = pickModel(["llama3.1:8b", "qwen2.5-coder:7b"], null);
  assert.equal(picked, "qwen2.5-coder:7b");
});

test("an explicit model wins over the preference order", () => {
  assert.equal(pickModel(["qwen2.5-coder:7b", "llava:7b"], "llava:7b"), "llava:7b");
});

test("a runtime serving only embedders yields no model", () => {
  assert.equal(pickModel(["nomic-embed-text:latest"], null), null);
});
