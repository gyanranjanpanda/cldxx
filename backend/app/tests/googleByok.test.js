import assert from "node:assert/strict";
import test from "node:test";
import UserKey from "../modules/keys/models/userKey.model.js";
import { saveKey } from "../modules/keys/controllers/keys.controller.js";
import { decryptSecret } from "../modules/mcp/utils/secretBox.js";

const fakeAuthKey = "AQ." + "a".repeat(84);
const fakeStandardKey = "AIza" + "b".repeat(35);

async function saveGoogleKey(key) {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await saveKey({ headers: { "x-user-id": "test-user" }, params: { provider: "google" }, body: { key } }, res);
  return res;
}

test("Gemini authorization and standard keys are verified by header and stored encrypted", async (t) => {
  for (const key of [fakeAuthKey, fakeStandardKey]) {
    const fetch = t.mock.method(globalThis, "fetch", async (url, options) => {
      assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models");
      assert.deepEqual(options.headers, { "x-goog-api-key": key });
      return new Response(null, { status: 200 });
    });
    const save = t.mock.method(UserKey, "findOneAndUpdate", async (_filter, doc) => {
      assert.notEqual(doc.key, key);
      assert.equal(decryptSecret(doc.key), key);
      return doc;
    });
    const res = await saveGoogleKey(" " + key + "\n");
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.verified, true);
    assert.equal(res.body.key.last4, key.slice(-4));
    assert.ok(!Object.hasOwn(res.body.key, "key"));
    assert.equal(fetch.mock.callCount(), 1);
    assert.equal(save.mock.callCount(), 1);
    t.mock.restoreAll();
  }
});

test("Google rejection leaves the previously saved key in place", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 401 }));
  const save = t.mock.method(UserKey, "findOneAndUpdate", async () => assert.fail("rejected key was saved"));
  const res = await saveGoogleKey(fakeAuthKey);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Google rejected this key/i);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(save.mock.callCount(), 0);
});
