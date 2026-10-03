// Branch B -- find the local model runtime.
//
// vLLM, SGLang, Ollama and llama.cpp all speak the OpenAI HTTP shape, so the
// runtime is a base URL rather than a vendor. Discovery exists so the developer
// does not have to know that: `cldx code` with no configuration finds whichever
// of them is already running.

import path from "node:path";
import { policyDenialWithin } from "./egress.js";
import { assertLoopback, localRuntimeUnreachable, PolicyDenied } from "./policy.js";
import { cldxDir, readJson, writeJson } from "./workspace.js";

// Probed in this order. Loopback only, and never a range scan: a sovereign
// product that sweeps the customer's network is the first thing a security
// review finds, and it would be right to.
const KNOWN_RUNTIMES = [
  { name: "Ollama",    baseUrl: "http://127.0.0.1:11434/v1" },
  { name: "vLLM",      baseUrl: "http://127.0.0.1:8000/v1" },
  { name: "SGLang",    baseUrl: "http://127.0.0.1:30000/v1" },
  { name: "llama.cpp", baseUrl: "http://127.0.0.1:8080/v1" }
];

const PROBE_TIMEOUT_MS = 1500;

// Embedding models answer /v1/models alongside chat models and are useless
// here, but picking one produces a baffling failure rather than an obvious
// one -- the request succeeds and returns vectors. Excluded by name.
const EMBEDDING_MARKERS = ["embed", "bge-", "gte-", "e5-", "minilm"];

// Preferred when the user has not named a model. A coding agent defaulting to
// a general chat model is a worse first impression than the install deserves.
const CODING_MARKERS = ["coder", "code", "starcoder", "codestral", "devstral"];

const isEmbedding = (id) =>
  EMBEDDING_MARKERS.some((marker) => id.toLowerCase().includes(marker));

const isCoding = (id) =>
  CODING_MARKERS.some((marker) => id.toLowerCase().includes(marker));

/**
 * One GET /models against a candidate. Returns null for "nothing is listening
 * here", which is an ordinary outcome during discovery and not an error.
 */
export const probe = async (baseUrl) => {

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {

    const response = await fetch(`${baseUrl}/models`, {
      signal: controller.signal,
      headers: { authorization: "Bearer not-needed" }
    });

    if (!response.ok) return null;

    const body = await response.json();

    const models = (body?.data || [])
      .map((entry) => entry?.id)
      .filter((id) => typeof id === "string");

    return { baseUrl, models };

  } catch (error) {

    // "Nothing is listening here" is an ordinary discovery outcome and returns
    // null. A policy refusal is not an outcome -- swallowing it would turn a
    // blocked connection into a silent "no runtime found", and the guard would
    // be invisible exactly when it had just done its job.
    const denial = policyDenialWithin(error);

    if (denial) throw denial;

    return null;

  } finally {
    clearTimeout(timer);
  }

};

export const pickModel = (models, preferred) => {

  if (preferred) return preferred;

  const usable = models.filter((id) => !isEmbedding(id));

  if (usable.length === 0) return null;

  return usable.find(isCoding) || usable[0];

};

const cachePath = (root) => path.join(cldxDir(root), "runtime.json");

/**
 * Branch B end to end, with the probe cached so the command is slow exactly
 * once per machine.
 *
 * An explicitly configured base URL is used as given and still has to clear
 * CODE-001 -- configuring a remote endpoint is the most direct way to defeat
 * Sovereign Mode, so it is checked harder than the discovered ones, not less.
 */
export const discoverRuntime = async (root, config, { sovereign, reprobe = false }) => {

  if (config.baseUrl) {

    await assertLoopback(config.baseUrl, { sovereign });

    const found = await probe(config.baseUrl);

    if (!found) throw localRuntimeUnreachable(config.baseUrl, "no response to GET /models");

    return {
      ...found,
      runtime: "configured",
      model: requireModel(pickModel(found.models, config.model), found.baseUrl),
      cached: false
    };

  }

  if (!reprobe) {

    const cached = await readJson(cachePath(root));

    // Re-probed rather than trusted: a cached endpoint whose server has since
    // stopped would otherwise produce a confusing mid-session failure instead
    // of a clear one at startup.
    if (cached?.baseUrl && await probe(cached.baseUrl)) {
      return { ...cached, model: config.model || cached.model, cached: true };
    }

  }

  for (const candidate of KNOWN_RUNTIMES) {

    const found = await probe(candidate.baseUrl);

    if (!found) continue;

    const resolved = {
      baseUrl: found.baseUrl,
      runtime: candidate.name,
      models: found.models,
      model: requireModel(pickModel(found.models, config.model), found.baseUrl)
    };

    await writeJson(cachePath(root), resolved);

    return { ...resolved, cached: false };

  }

  throw new PolicyDenied(
    [
      "No local model runtime is listening on this machine, and Sovereign Mode will not fall back to a cloud model.",
      "",
      "Start one, for example:",
      "  ollama serve && ollama pull qwen2.5-coder:7b",
      "",
      "Or point cldx at an existing one:",
      "  SOVEREIGN_BASE_URL=http://127.0.0.1:8000/v1 cldx code"
    ].join("\n"),
    "SOV-001"
  );

};

const requireModel = (model, baseUrl) => {

  if (model) return model;

  throw new PolicyDenied(
    `The runtime at ${baseUrl} is running but serves no usable chat model (only embedding models were found). Pull one, for example: ollama pull qwen2.5-coder:7b`,
    "SOV-001"
  );

};

export const runtimeCandidates = () => KNOWN_RUNTIMES.map((entry) => entry.baseUrl);
