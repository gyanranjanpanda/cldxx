import test from "node:test";
import assert from "node:assert/strict";
import { hashLocalPassword, verifyLocalPassword } from "../modules/auth/localPassword.js";
import { cloudRunIdentityToken } from "../utils/cloudRunIdentity.js";

test("local password hash verifies the right password and rejects malformed hashes", () => {
  const encoded = hashLocalPassword("eight123");
  assert.equal(verifyLocalPassword("eight123", encoded), true);
  assert.equal(verifyLocalPassword("wrong-password", encoded), false);
  assert.equal(verifyLocalPassword("anything", "broken"), false);
  assert.throws(() => hashLocalPassword("seven77"));
});

test("Cloud Run token uses the service URL as audience and caches a valid token", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const audience = "https://agent.example.run.app";
  const payload = Buffer.from(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  const token = `header.${payload}.signature`;
  globalThis.fetch = async (url, options) => {
    calls += 1;
    assert.match(url, /audience=https%3A%2F%2Fagent\.example\.run\.app/);
    assert.equal(options.headers["Metadata-Flavor"], "Google");
    return { ok: true, text: async () => token };
  };
  try {
    assert.equal(await cloudRunIdentityToken(audience), token);
    assert.equal(await cloudRunIdentityToken(audience), token);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
