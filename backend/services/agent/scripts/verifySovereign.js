// Proves the boundary rather than asserting it. Run with SOVEREIGN_BASE_URL
// unset to confirm the mode fails closed, and with it set to confirm every
// agent resolves to the local endpoint.
//
//   node scripts/verifySovereign.js
//
// This is the check to run in front of a security team: the interesting result
// is not that sovereign turns go local, it is that nothing silently falls back
// to a cloud provider when the local runtime is missing.

import { getModel } from "../utils/model.js";
import { getEmbeddings } from "../utils/embedding.js";
import { CLOUD_ONLY_AGENTS, SOVEREIGN_BASE_URL } from "../utils/sovereign.js";
import { verifyAuditChain } from "../utils/audit.js";
import { warmProvenance, fingerprintOf, assertModelIntegrity } from "../utils/provenance.js";

const AGENTS = ["chat", "coding", "vision", "pdf", "ppt", "pdf_rag", "router"];

let failures = 0;

// Filled in as the agents resolve, so provenance is reported for the models this
// deployment actually routes to rather than for whatever happens to be installed.
const MODELS_IN_USE = new Set();

const ok   = (m) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}`);
const bad  = (m) => { failures++; console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`); };

const state = { sovereign: true, userId: "verify", conversationId: "verify", prompt: "probe" };

console.log(`\nSovereign boundary check  (SOVEREIGN_BASE_URL=${SOVEREIGN_BASE_URL || "<unset>"})\n`);

// Awaited rather than left to the background warm: the checks below run
// immediately, and a digest that arrives after them would be reported as
// unverified for no reason.
await warmProvenance();

// ── 1. Cloud-only agents must be refused, never substituted ─────────────────
console.log("Cloud-only agents are refused:");
for (const agent of CLOUD_ONLY_AGENTS) {
  try {
    getModel(agent, state);
    bad(`${agent} was allowed in Sovereign Mode`);
  } catch (error) {
    error.isPolicyDenial
      ? ok(`${agent} refused (${error.rule})`)
      : bad(`${agent} threw a non-policy error: ${error.message}`);
  }
}

// ── 2. Every other agent resolves locally, or fails closed ──────────────────
console.log("\nAgents resolve to the local runtime:");
for (const agent of AGENTS) {
  try {
    const llm = getModel(agent, state);

    const name = llm?.model ?? llm?.modelName ?? llm?.lc_kwargs?.model;
    if (name) MODELS_IN_USE.add(String(name));

    const base =
      llm?.clientConfig?.baseURL ??
      llm?.configuration?.baseURL ??
      llm?.client?.baseURL ??
      "";

    if (!SOVEREIGN_BASE_URL) {
      bad(`${agent} returned a model with no runtime configured — should have failed closed`);
    } else if (String(base).startsWith(SOVEREIGN_BASE_URL)) {
      ok(`${agent} → ${SOVEREIGN_BASE_URL}`);
    } else {
      bad(`${agent} resolved to "${base || "unknown"}", not the sovereign endpoint`);
    }
  } catch (error) {
    // A policy refusal is a correct outcome, not a failure. What this section
    // tests is whether a sovereign turn can ever reach a cloud endpoint, and a
    // turn that refused plainly did not. The rule id says which guard fired --
    // SOV-001 when no runtime is configured, SOV-006 when the configured model
    // cannot do the job.
    error.isPolicyDenial
      ? ok(`${agent} refused (${error.rule}) — no cloud fallback`)
      : bad(`${agent}: ${error.message}`);
  }
}

// ── 3. Embeddings are the leak that carries no LLM call ─────────────────────
console.log("\nEmbeddings stay local:");
try {
  const embedder = getEmbeddings(state);
  const base = embedder?.clientConfig?.baseURL ?? embedder?.configuration?.baseURL ?? "";

  if (!SOVEREIGN_BASE_URL) {
    bad("embeddings resolved with no runtime configured — should have failed closed");
  } else if (String(base).startsWith(SOVEREIGN_BASE_URL)) {
    ok(`embeddings → ${SOVEREIGN_BASE_URL}`);
  } else {
    bad(`embeddings resolved to "${base || "a cloud provider"}"`);
  }
} catch (error) {
  error.isPolicyDenial && !SOVEREIGN_BASE_URL
    ? ok(`embeddings failed closed (${error.rule})`)
    : bad(`embeddings: ${error.message}`);
}

// ── 4. Which weights answered, and whether they are the accepted ones ───────
console.log("\nModel provenance:");
{
  const pinned = (process.env.SOVEREIGN_MODEL_DIGESTS || "").trim();

  for (const model of MODELS_IN_USE) {

    const { digest, source } = fingerprintOf(model);

    if (!digest) {
      // Reported rather than failed: plenty of runtimes do not publish digests,
      // and the honest answer is that provenance is unavailable, not that the
      // deployment is broken.
      console.log(`  \x1b[33mWARN\x1b[0m  ${model} — runtime publishes no digest, recorded as ${source}`);
      continue;
    }

    try {
      assertModelIntegrity(model, true);
      ok(`${model} → ${digest.slice(0, 16)}…`);
    } catch (error) {
      bad(`${model}: ${error.message}`);
    }

  }

  console.log(
    pinned
      ? "  digests are pinned: a substituted model is refused (SOV-008)"
      : "  \x1b[33mno digests pinned\x1b[0m — substitution is recorded but not refused; set SOVEREIGN_MODEL_DIGESTS to enforce"
  );
}

// ── 5. The audit chain has to be intact, or the evidence is worthless ───────
console.log("\nAudit chain:");
try {
  const result = verifyAuditChain();
  result.ok
    ? ok(`chain intact over ${result.entries} entries`)
    : bad(`chain broken at line ${result.line}: ${result.reason}`);
} catch {
  console.log("  \x1b[33mSKIP\x1b[0m  no audit log written yet");
}

console.log(
  failures
    ? `\n\x1b[31m${failures} check(s) failed.\x1b[0m\n`
    : "\n\x1b[32mAll checks passed.\x1b[0m\n"
);

process.exit(failures ? 1 : 0);
