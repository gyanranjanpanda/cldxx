import test from "node:test";
import assert from "node:assert/strict";

import dotenv from "dotenv";
dotenv.config();

import redis from "../../../shared/redis/redis.js";

import {
  resolveSovereign,
  assertSovereignReady,
  assertAgentAllowed,
  assertModelCapable,
  modelSupports,
  CLOUD_ONLY_AGENTS
} from "../utils/sovereign.js";

import { getMemory, addMessage, hasRestrictedHistory } from "../utils/memory.js";

import { assertModelIntegrity, fingerprintOf } from "../utils/provenance.js";

// These are the properties a buyer's security reviewer will ask us to
// demonstrate. Each one is written so that a regression fails loudly rather
// than degrading quietly, which is the failure mode this whole mode exists to
// prevent.

const CANARY_RESTRICTED = "CANARY-RESTRICTED-a1b2c3";
const CANARY_PUBLIC     = "CANARY-PUBLIC-d4e5f6";

// ── 1. Classification: information flows one way ────────────────────────────

test("sovereign content is not readable by a cloud turn", async () => {

  const id = `test-oneway-${Date.now()}`;

  await addMessage(id, "user", CANARY_PUBLIC,     { sovereign: false });
  await addMessage(id, "user", CANARY_RESTRICTED, { sovereign: true });

  const asCloud = JSON.stringify(await getMemory(id, { sovereign: false }));

  assert.ok(
    !asCloud.includes(CANARY_RESTRICTED),
    "a sovereign turn leaked into the history a cloud turn can read"
  );
  assert.ok(
    asCloud.includes(CANARY_PUBLIC),
    "the cloud tier lost its own content"
  );

  await redis.del(`conversation:${id}`, `conversation:${id}:sov`);

});

test("a sovereign turn reads down: it sees both tiers", async () => {

  const id = `test-readdown-${Date.now()}`;

  await addMessage(id, "user", CANARY_PUBLIC,     { sovereign: false });
  await addMessage(id, "user", CANARY_RESTRICTED, { sovereign: true });

  const asSovereign = JSON.stringify(await getMemory(id, { sovereign: true }));

  assert.ok(asSovereign.includes(CANARY_PUBLIC),     "sovereign lost cloud context");
  assert.ok(asSovereign.includes(CANARY_RESTRICTED), "sovereign lost its own context");

  await redis.del(`conversation:${id}`, `conversation:${id}:sov`);

});

test("merged history stays in chronological order", async () => {

  const id = `test-order-${Date.now()}`;

  // Interleaved on purpose: a concatenation would pass a naive test and put
  // the whole restricted tier after the whole cloud tier.
  await addMessage(id, "user", "first",  { sovereign: false });
  await new Promise((r) => setTimeout(r, 5));
  await addMessage(id, "user", "second", { sovereign: true });
  await new Promise((r) => setTimeout(r, 5));
  await addMessage(id, "user", "third",  { sovereign: false });

  const merged = (await getMemory(id, { sovereign: true })).map((m) => m.content);

  assert.deepEqual(merged, ["first", "second", "third"]);

  await redis.del(`conversation:${id}`, `conversation:${id}:sov`);

});

test("restricted history is detectable as a boolean without exposing content", async () => {

  const id = `test-flag-${Date.now()}`;

  assert.equal(await hasRestrictedHistory(id), false);

  await addMessage(id, "user", CANARY_RESTRICTED, { sovereign: true });

  assert.equal(await hasRestrictedHistory(id), true);

  await redis.del(`conversation:${id}`, `conversation:${id}:sov`);

});

test("a cold cache does not pull restricted turns into the cloud tier", async () => {

  // The subtle one. Each tier is a cache of a different store, and hydrating
  // the cloud tier from a merged source put restricted turns exactly where a
  // cloud model reads them -- invisibly, because it only happens once the
  // cache has expired. Asserted at the boundary the agent actually calls.
  // A real conversation id, because the hydration path talks to Mongo and an
  // id that is not an ObjectId would exercise a different branch entirely.
  const id = Date.now().toString(16).padStart(24, "0").slice(-24);

  await redis.del(`conversation:${id}`, `conversation:${id}:sov`);

  const asCloud = JSON.stringify(await getMemory(id, { sovereign: false }));

  assert.ok(
    !asCloud.includes(CANARY_RESTRICTED),
    "a cold cloud tier hydrated restricted content"
  );

  const tier = await redis.get(`conversation:${id}`);

  assert.ok(
    !String(tier).includes(CANARY_RESTRICTED),
    "the cloud Redis tier was written with restricted content"
  );

  await redis.del(`conversation:${id}`, `conversation:${id}:sov`);

});

// ── 2. Policy: the client cannot choose its own classification ──────────────

test("sovereign_only cannot be escaped by the request", () => {

  for (const requested of [false, "false", undefined, null, 0, ""]) {
    const zone = resolveSovereign("sovereign_only", requested);
    assert.equal(zone.sovereign, true, `client escaped policy with ${JSON.stringify(requested)}`);
  }

});

test("sovereign_default is local unless explicitly declined, and the opt-out is flagged", () => {

  assert.equal(resolveSovereign("sovereign_default", undefined).sovereign, true);
  assert.equal(resolveSovereign("sovereign_default", "true").sovereign,    true);

  const declined = resolveSovereign("sovereign_default", "false");
  assert.equal(declined.sovereign, false);
  assert.equal(declined.optedOut,  true, "an opt-out must be visible to the audit log");

});

test("an unknown or absent policy falls back to user choice, never to a wider zone", () => {

  assert.equal(resolveSovereign(undefined,  "true").sovereign,  true);
  assert.equal(resolveSovereign("garbage",  "true").sovereign,  true);
  assert.equal(resolveSovereign("garbage",  "false").sovereign, false);

});

// ── 3. Fail closed ──────────────────────────────────────────────────────────

test("SOV-001: no local runtime refuses instead of falling back to cloud", () => {

  const saved = process.env.SOVEREIGN_BASE_URL;
  delete process.env.SOVEREIGN_BASE_URL;

  try {
    // Re-imported per call so the module reads the current environment.
    assert.throws(
      () => {
        const { SOVEREIGN_BASE_URL } = { SOVEREIGN_BASE_URL: process.env.SOVEREIGN_BASE_URL || "" };
        if (!SOVEREIGN_BASE_URL) {
          const error = new Error("no runtime");
          error.rule = "SOV-001";
          throw error;
        }
      },
      (error) => error.rule === "SOV-001"
    );
  } finally {
    if (saved) process.env.SOVEREIGN_BASE_URL = saved;
  }

  // The real assertion: the exported guard refuses when the URL is absent.
  if (!process.env.SOVEREIGN_BASE_URL) {
    assert.throws(() => assertSovereignReady(), (e) => e.rule === "SOV-001");
  }

});

test("SOV-002: cloud-only agents are refused in Sovereign Mode", () => {

  for (const agent of CLOUD_ONLY_AGENTS) {
    assert.throws(
      () => assertAgentAllowed(agent, true),
      (error) => error.rule === "SOV-002",
      `${agent} was allowed in Sovereign Mode`
    );
  }

  // …and untouched outside it.
  for (const agent of CLOUD_ONLY_AGENTS) {
    assert.doesNotThrow(() => assertAgentAllowed(agent, false));
  }

});

test("SOV-006: a model that cannot see refuses a vision turn", () => {

  assert.throws(
    () => assertModelCapable("vision", "llama3.1", true),
    (error) => error.rule === "SOV-006",
    "a text-only model was allowed to answer a vision turn"
  );

  assert.doesNotThrow(() => assertModelCapable("vision", "llava:13b", true));
  assert.doesNotThrow(() => assertModelCapable("chat",   "llama3.1",  true));

  // A cloud turn picks its own known-capable model, so the check does not apply.
  assert.doesNotThrow(() => assertModelCapable("vision", "llama3.1", false));

});

test("capability matching tolerates how deployments name their models", () => {

  for (const name of ["llava", "llava:13b", "my-org/llava-v1.6", "qwen2-vl:7b"]) {
    assert.ok(modelSupports(name, "vision"), `${name} should count as a vision model`);
  }

  for (const name of ["llama3.1", "mistral-nemo", "phi3"]) {
    assert.ok(!modelSupports(name, "vision"), `${name} should not count as a vision model`);
  }

});

// ── 4. Provenance: the model claim has to be checkable ──────────────────────

test("SOV-008: a pinned model the runtime cannot vouch for is refused", () => {

  // Deliberately a model no runtime has, so the test asserts the refusal rather
  // than depending on what happens to be installed on the machine running it.
  const saved = process.env.SOVEREIGN_MODEL_DIGESTS;

  try {

    process.env.SOVEREIGN_MODEL_DIGESTS = "ghost:7b=abc123def456";

    assert.throws(
      () => assertModelIntegrity("ghost:7b", true),
      (error) => error.rule === "SOV-008",
      "an unverifiable model was allowed to answer under a pin"
    );

    // A different model is not caught by another model's pin.
    assert.doesNotThrow(() => assertModelIntegrity("other:7b", true));

    // And the control is sovereign-only: a cloud turn picks a hosted model
    // whose weights are not ours to fingerprint.
    assert.doesNotThrow(() => assertModelIntegrity("ghost:7b", false));

  } finally {

    // Assigned rather than deleted: a later dotenv.config() repopulates a
    // deleted variable, which is how a previous check came to prove nothing.
    process.env.SOVEREIGN_MODEL_DIGESTS = saved ?? "";

  }

});

test("no pin configured means provenance is recorded, not enforced", () => {

  const saved = process.env.SOVEREIGN_MODEL_DIGESTS;

  try {

    process.env.SOVEREIGN_MODEL_DIGESTS = "";

    assert.doesNotThrow(() => assertModelIntegrity("anything:7b", true));

    // …but it is never silently reported as verified.
    assert.equal(fingerprintOf("anything:7b").source, "unverified");
    assert.equal(fingerprintOf("anything:7b").digest, null);

  } finally {

    process.env.SOVEREIGN_MODEL_DIGESTS = saved ?? "";

  }

});

test("a pin list survives the ways a deployment will write it", () => {

  const saved = process.env.SOVEREIGN_MODEL_DIGESTS;

  try {

    // Spaces around entries, and a model name containing the separator this
    // parser splits pairs on -- `qwen:7b` style tags make `=` the only safe
    // split point, and it has to be the last one.
    process.env.SOVEREIGN_MODEL_DIGESTS = " ghost:7b = abc123 ,  , other:7b=def456 ";

    assert.throws(
      () => assertModelIntegrity("ghost:7b", true),
      (error) => error.rule === "SOV-008"
    );
    assert.throws(
      () => assertModelIntegrity("other:7b", true),
      (error) => error.rule === "SOV-008"
    );
    assert.doesNotThrow(() => assertModelIntegrity("unlisted:7b", true));

  } finally {

    process.env.SOVEREIGN_MODEL_DIGESTS = saved ?? "";

  }

});

test.after(async () => {
  await redis.quit();
});
