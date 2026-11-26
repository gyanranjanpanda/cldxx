import assert from "node:assert/strict";
import test from "node:test";
import { invokePdfModel } from "../utils/model.js";
import { fetchUserKeys } from "../utils/userKeys.js";
import { internalApi } from "../utils/internalApi.js";
import { sanitizeText } from "../utils/diagnostics/traceSanitizer.js";

const userKey = "AQ." + "u".repeat(84);

test("PDF requests and their Gemini fallback use the saved authorization key", async (t) => {
  const vars = {
    DEEPSEEK_API_KEY: "platform-deepseek",
    GOOGLE_API_KEY: "platform-google",
    GOOGLE_PDF_MODEL: "gemini-test-primary",
    GOOGLE_PDF_FALLBACK_MODEL: "gemini-test-fallback",
  };
  const previous = Object.fromEntries(Object.keys(vars).map((name) => [name, process.env[name]]));
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  Object.assign(process.env, vars);
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const headers = new Headers(options.headers);
    assert.equal(headers.get("x-goog-api-key"), userKey);
    assert.equal(headers.get("authorization"), null);
    requests.push(new URL(url).pathname);
    if (requests.length === 1) {
      return new Response(JSON.stringify({error: {message: "Daily quota exceeded"}}), { status: 429 });
    }
    return new Response(JSON.stringify({
      candidates: [{ index: 0, content: { role: "model", parts: [{ text: "PDF content" }] }, finishReason: "STOP" }],
    }), { status: 200 });
  });
  const response = await invokePdfModel({ keys: { google: userKey } }, [{ role: "user", content: "Write the PDF." }]);
  assert.equal(response.text, "PDF content");
  assert.deepEqual(requests, [
    "/v1beta/models/gemini-test-primary:generateContent",
    "/v1beta/models/gemini-test-fallback:generateContent",
  ]);
  assert.equal(sanitizeText(userKey), "[REDACTED_SECRET]");
});

test("each request reads current keys and an unavailable lookup raises a clear error", async (t) => {
  const get = t.mock.method(internalApi, "get", async () => ({ data: {success: true, keys: { google: userKey }} }));
  assert.deepEqual(await fetchUserKeys("test-user"), { google: userKey });
  get.mock.mockImplementationOnce(async () => ({ data: {success: true, keys: {} }}));
  assert.deepEqual(await fetchUserKeys("test-user"), {});
  get.mock.mockImplementationOnce(async () => { throw new Error("internal request failed"); });
  await assert.rejects(fetchUserKeys("test-user"), { status: 503 });
});
