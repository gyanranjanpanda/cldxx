import dotenv from "dotenv";
dotenv.config();

import { SOVEREIGN_BASE_URL, PolicyDenied } from "./sovereign.js";

// "We ran qwen2.5-coder:7b" is an assertion. A buyer who has to defend the
// deployment needs it to be a fact, and a model name is not one -- the weights
// behind a tag can be replaced without the tag changing.
//
// So the digest of the weights that actually answered is recorded alongside
// every sovereign decision, and can optionally be pinned: configure the digest
// you accept and the mode refuses to run anything else, which is the
// difference between noticing a substitution afterwards and preventing it.

// Ollama publishes digests on its native API, one level up from the
// OpenAI-compatible path the rest of the code uses. Runtimes that do not
// publish one are recorded as unverified rather than silently as fine.
const nativeBase = () =>
  SOVEREIGN_BASE_URL.replace(/\/v1\/?$/, "");

// model name -> { digest, source }
const fingerprints = new Map();

/**
 * Digests to accept, as `model=digest` pairs:
 *
 *   SOVEREIGN_MODEL_DIGESTS="qwen2.5-coder:7b=dae161e27b0e…,llava:7b=8dd30f6b0cb1…"
 *
 * A model with no pin runs and is recorded. A model with a pin that does not
 * match is refused.
 */
const pins = () => {

  const raw = process.env.SOVEREIGN_MODEL_DIGESTS || "";

  return raw
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .reduce((out, pair) => {
      const at = pair.lastIndexOf("=");
      if (at > 0) out[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
      return out;
    }, {});

};

// Memoised so every caller shares one read, and so nothing has to remember to
// warm it: the first import starts the fetch. A process that forgot would still
// work and would still be audited -- it would just record every model as
// unverified, which is provenance quietly degrading rather than failing, and
// that is the one way this control could be useless without anyone noticing.
let warming = null;

/**
 * Reads what the runtime is actually serving. Kicked off at import so the
 * lookup is not in the path of a turn -- getModel is synchronous, and a network
 * hop inside it would be a hop inside every request. Await it when you need the
 * answer immediately, as a short-lived script does.
 */
export const warmProvenance = () => (warming ??= read());

const read = async () => {

  if (!SOVEREIGN_BASE_URL) return;

  try {

    const response = await fetch(`${nativeBase()}/api/tags`, {
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const body = await response.json();

    (body.models || []).forEach((model) => {
      fingerprints.set(model.name, {
        digest: String(model.digest || "").slice(0, 32),
        source: "runtime"
      });
    });

    console.log(`[provenance] fingerprinted ${fingerprints.size} local model(s)`);

  } catch (error) {

    // A runtime that does not publish digests is a gap in the evidence, not a
    // reason to refuse service. It is recorded as unverified so the audit log
    // says which it was.
    console.warn(`[provenance] runtime published no digests (${error.message}); models will be recorded as unverified`);

  }

};

/** What answered, as far as we can prove it. Never throws. */
export const fingerprintOf = (model) =>
  fingerprints.get(model) || { digest: null, source: "unverified" };

/**
 * Refuses a model whose weights are not the ones this deployment accepts.
 *
 * Only applies in Sovereign Mode and only when a pin exists for that model --
 * an unpinned deployment still gets the digest in its audit trail, which is
 * what makes pinning possible later.
 */
export const assertModelIntegrity = (model, sovereign) => {

  if (!sovereign) return;

  const expected = pins()[model];

  if (!expected) return;

  const { digest } = fingerprintOf(model);

  if (!digest) {

    throw new PolicyDenied(
      `A digest is pinned for "${model}" but the runtime does not publish one, so the weights cannot be verified.`,
      "SOV-008"
    );

  }

  if (!digest.startsWith(expected) && !expected.startsWith(digest)) {

    throw new PolicyDenied(
      `The weights behind "${model}" are not the ones this deployment accepts (expected ${expected.slice(0, 12)}…, found ${digest.slice(0, 12)}…).`,
      "SOV-008"
    );

  }

};

// Started here rather than left to each entry point. The result is needed by a
// synchronous function, so it has to be in hand before the first turn; a server
// has milliseconds of startup in which this completes, and anything that needs
// certainty awaits warmProvenance() itself.
warmProvenance();
