// The guard is tested by driving real fetch() calls through it, not by calling
// its internals. The bypass this suite exists to prevent -- Node handing
// Socket.prototype.connect a normalized *array* instead of an options object --
// is invisible to a unit test that constructs the arguments itself, because
// such a test constructs the documented shape rather than the real one.

import assert from "node:assert/strict";
import http from "node:http";
import test, { afterEach } from "node:test";

import {
  armEgressGuard,
  egressLog,
  isArmed,
  policyDenialWithin,
  releaseEgressGuard
} from "../src/egress.js";

afterEach(() => releaseEgressGuard());

const blockedBy = async (url) => {

  try {
    await fetch(url, { signal: AbortSignal.timeout(4000) });
    return null;
  } catch (error) {
    return policyDenialWithin(error);
  }

};

test("CODE-001: an outbound connection is blocked once armed", async () => {

  armEgressGuard({ sovereign: true, allow: [] });

  const denial = await blockedBy("https://api.openai.com/v1/models");

  assert.ok(denial, "the connection was not blocked");
  assert.equal(denial.rule, "CODE-001");

});

test("CODE-001: a plain http connection is blocked", async () => {

  armEgressGuard({ sovereign: true, allow: [] });

  const denial = await blockedBy("http://example.com/");

  // Deliberately http, not https. The two take different routes out of Node:
  // https is handed to tls.connect as an ordinary options object, while http
  // reaches Socket.prototype.connect as Node's normalized args array. Only the
  // second exercises the unwrapping in describeTarget, so an https-only suite
  // reports full coverage of CODE-001 while the entire cleartext path is
  // unguarded -- which was true of this file until it was checked.
  assert.ok(denial, "a cleartext connection escaped the guard");
  assert.equal(denial.rule, "CODE-001");

});

test("CODE-001: the log records the real host and port, not a default", async () => {

  armEgressGuard({ sovereign: true, allow: [] });

  await blockedBy("https://example.com:8443/x");

  const entry = egressLog().at(-1);

  // The regression guard. When Socket.prototype.connect receives Node's
  // normalized args array and it is not unwrapped, the host reads as undefined
  // and defaults to localhost -- so every connection is permitted while the
  // guard still reports itself armed. These two assertions are the difference
  // between a working control and a decorative one.
  assert.equal(entry.host, "example.com");
  assert.equal(String(entry.port), "8443");
  assert.equal(entry.allowed, false);

});

test("loopback traffic still works with the guard armed", async (t) => {

  const server = http.createServer((request, response) => response.end("ok"));

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  t.after(() => server.close());

  armEgressGuard({ sovereign: true, allow: [] });

  const response = await fetch(`http://127.0.0.1:${server.address().port}/`);

  assert.equal(await response.text(), "ok");

});

test("an administrator allowlist is honoured", async () => {

  armEgressGuard({ sovereign: true, allow: ["mirror.internal"] });

  await blockedBy("http://mirror.internal/x");

  const entry = egressLog().at(-1);

  assert.equal(entry.host, "mirror.internal");
  assert.equal(entry.allowed, true);

});

test("a cloud session is not subject to the guard", () => {

  assert.equal(armEgressGuard({ sovereign: false, allow: [] }), false);
  assert.equal(isArmed(), false);

});

test("policyDenialWithin digs the refusal out of fetch's wrapper", async () => {

  armEgressGuard({ sovereign: true, allow: [] });

  let raw;

  try {
    await fetch("https://api.anthropic.com/v1/messages");
  } catch (error) {
    raw = error;
  }

  // What the user would see without the unwrapping: a generic failure that
  // chat.js would then report as CODE-002, describing a blocked exfiltration
  // attempt as a local outage.
  assert.ok(raw);
  assert.equal(raw.isPolicyDenial, undefined);
  assert.equal(policyDenialWithin(raw)?.rule, "CODE-001");

});
