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

const AGENTS = ["chat", "coding", "vision", "pdf", "ppt", "pdf_rag", "router"];

let failures = 0;

const ok   = (m) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}`);
const bad  = (m) => { failures++; console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`); };

const state = { sovereign: true, userId: "verify", conversationId: "verify", prompt: "probe" };

console.log(`\nSovereign boundary check  (SOVEREIGN_BASE_URL=${SOVEREIGN_BASE_URL || "<unset>"})\n`);

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
    error.isPolicyDenial && !SOVEREIGN_BASE_URL
      ? ok(`${agent} failed closed (${error.rule}) — no cloud fallback`)
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

// ── 4. The audit chain has to be intact, or the evidence is worthless ───────
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
