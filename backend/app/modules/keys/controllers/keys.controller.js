import UserKey, { PROVIDERS, isProvider } from "../models/userKey.model.js";

// Shared with the MCP module rather than duplicated: two implementations of
// secret storage is two chances to get the crypto wrong, and a key encrypted by
// one and decrypted by the other has to agree byte for byte anyway.
import { encryptSecret, decryptSecret } from "../../mcp/utils/secretBox.js";

const badRequest = (res, message) =>
  res.status(400).json({ success: false, message });

// What the browser is allowed to see. The key itself never appears here -- the
// last four characters are enough for a user to recognise which key is stored,
// and are not enough to use it.
const toClient = (doc) => ({
  provider:   doc.provider,
  label:      PROVIDERS[doc.provider]?.label || doc.provider,
  last4:      doc.last4,
  enabled:    doc.enabled,
  status:     doc.status,
  updatedAt:  doc.updatedAt
});

/**
 * Asks the provider whether the key works, before it is ever used in a
 * conversation. A key that 401s is worth catching here -- the alternative is a
 * user pasting a key, sending a message, and getting a failure they cannot
 * attribute to the key rather than to us.
 */
const verifyKey = async (provider, key) => {

  const timeout = AbortSignal.timeout(8000);

  try {

    if (provider === "groq") {
      const res = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
        signal: timeout
      });
      return res.ok ? { ok: true } : { ok: false, error: `Groq rejected the key (HTTP ${res.status})` };
    }

    if (provider === "deepseek") {
      const res = await fetch("https://api.deepseek.com/models", {
        headers: { Authorization: `Bearer ${key}` },
        signal: timeout
      });
      return res.ok ? { ok: true } : { ok: false, error: `DeepSeek rejected the key (HTTP ${res.status})` };
    }

    if (provider === "google") {
      // The key rides in a query parameter for this API, so it is never put in
      // a header here on purpose.
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
        { signal: timeout }
      );
      return res.ok ? { ok: true } : { ok: false, error: `Google rejected the key (HTTP ${res.status})` };
    }

    if (provider === "tavily") {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: key, query: "ping", max_results: 1 }),
        signal: timeout
      });
      return res.ok ? { ok: true } : { ok: false, error: `Tavily rejected the key (HTTP ${res.status})` };
    }

    return { ok: false, error: "No check is implemented for this provider" };

  } catch (error) {

    // A network failure is not the same as a bad key, and saying so stops a
    // user from deleting a perfectly good key because our egress was down.
    return {
      ok: false,
      error: error.name === "TimeoutError"
        ? "The provider did not answer in time — the key was saved but not verified"
        : `Could not reach the provider — the key was saved but not verified (${error.message})`
    };

  }

};

/** The providers a user may bring a key for, and what each one looks like. */
export const listProviders = async (_req, res) => {

  res.json({
    success: true,
    providers: Object.entries(PROVIDERS).map(([id, spec]) => ({
      id,
      label: spec.label,
      hint:  spec.hint
    }))
  });

};

export const listKeys = async (req, res) => {

  try {

    const userId = req.headers["x-user-id"];

    const keys = await UserKey.find({ userId }).sort({ provider: 1 });

    res.json({ success: true, keys: keys.map(toClient) });

  } catch (error) {

    res.status(500).json({ success: false, message: error.message });

  }

};

/**
 * Saves (or replaces) the user's key for one provider.
 *
 * Upsert rather than create: a user pasting a rotated key expects it to take
 * effect, not to be told a key already exists.
 */
export const saveKey = async (req, res) => {

  try {

    const userId   = req.headers["x-user-id"];
    // The path names the provider; the body is accepted too so the route can
    // be called either way without a silent mismatch.
    const provider = String(req.params.provider || req.body.provider || "").trim();
    // Pasted keys routinely arrive with a trailing newline from a terminal or
    // a stray space from a double-click selection.
    const key      = String(req.body.key || "").trim();

    if (!isProvider(provider)) return badRequest(res, "Unknown provider");
    if (!key)                  return badRequest(res, "Paste a key first");

    const spec = PROVIDERS[provider];

    if (!spec.pattern.test(key)) {
      return badRequest(res, `That does not look like a ${spec.label} key. ${spec.hint}`);
    }

    const check = await verifyKey(provider, key);

    const doc = await UserKey.findOneAndUpdate(
      { userId, provider },
      {
        userId,
        provider,
        key:     encryptSecret(key),
        last4:   key.slice(-4),
        enabled: true,
        status: {
          state:     check.ok ? "ok" : "error",
          checkedAt: new Date(),
          error:     check.ok ? "" : check.error
        }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // A key that failed its check is still stored -- the check can fail for
    // reasons that are not the key's fault -- but the UI is told so it can say
    // as much instead of implying everything is fine.
    res.json({ success: true, key: toClient(doc), verified: check.ok });

  } catch (error) {

    res.status(500).json({ success: false, message: error.message });

  }

};

export const toggleKey = async (req, res) => {

  try {

    const userId = req.headers["x-user-id"];

    const doc = await UserKey.findOneAndUpdate(
      { userId, provider: req.params.provider },
      { enabled: req.body.enabled !== false },
      { new: true }
    );

    if (!doc) return res.status(404).json({ success: false, message: "No key stored for that provider" });

    res.json({ success: true, key: toClient(doc) });

  } catch (error) {

    res.status(500).json({ success: false, message: error.message });

  }

};

export const deleteKey = async (req, res) => {

  try {

    const userId = req.headers["x-user-id"];

    await UserKey.deleteOne({ userId, provider: req.params.provider });

    res.json({ success: true });

  } catch (error) {

    res.status(500).json({ success: false, message: error.message });

  }

};

// ── Internal surface ────────────────────────────────────────────────────────
//
// The agent process needs the key in plaintext to construct a client, which is
// the whole reason this route is key-gated and sessionless. It is never reached
// from the browser.

export const getKeysForAgent = async (req, res) => {

  try {

    const keys = await UserKey.find({
      userId:  req.params.userId,
      enabled: true
    });

    const byProvider = {};

    keys.forEach((doc) => {

      const secret = decryptSecret(doc.key);

      // A failed decrypt returns "" rather than throwing (the key material was
      // rotated, say). Handing that to a provider would look like an auth
      // failure the user cannot explain, so it is treated as absent instead.
      if (secret) byProvider[doc.provider] = secret;

    });

    res.json({ success: true, keys: byProvider });

  } catch (error) {

    res.status(500).json({ success: false, message: error.message });

  }

};
