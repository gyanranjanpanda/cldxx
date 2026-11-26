import dotenv from "dotenv";
dotenv.config();

// Sovereign Mode routes a turn to models the organisation runs itself, so no
// part of the prompt leaves their infrastructure. vLLM, SGLang, Ollama and
// llama.cpp all speak the OpenAI HTTP shape, so the runtime is a base URL
// rather than a vendor -- binding to one of them would make the product only
// as portable as whichever we picked.

// The zone rule is shared with the gateway -- see shared/zone/zone.js. Both
// services have to answer "is this turn sovereign" identically, so there is
// one implementation and these are re-exports of it.
export {
 SOVEREIGN_POLICIES,
 isSovereign,
 resolveSovereign
} from "../../../shared/zone/zone.js";

// ── SOV-004: Redis must not be a hosted service in Sovereign Mode ────────────
//
// The sovereign Redis tier stores restricted conversation history. If REDIS_URL
// points at a hosted provider (Upstash, Redis Cloud, ElastiCache) the data
// leaves the customer's boundary — the same violation the mode exists to prevent,
// just one layer lower than the LLM. Fail closed on the first sovereign turn
// rather than discovering it in a compliance audit.
//
// What counts as "local" is intentionally narrow: 127.x, ::1, and an explicit
// allowlist. Docker Compose service names (e.g. "redis") resolve to private RFC
// 1918 addresses at runtime, so they pass network-level controls without being
// allowed here by name — resolve first, then check.

import dns from "dns/promises";
import net from "net";

// Read at call time so env changes in tests and deployments that set the
// variable after first import take effect without a process restart.
const allowlist = () =>
  (process.env.SOVEREIGN_REDIS_ALLOWLIST || "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);

const isLoopback = (ip) =>
  ip === "127.0.0.1" ||
  ip === "::1" ||
  ip.startsWith("127.");

const isPrivateRfc1918 = (ip) => {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4) return false;
  const [a, b] = parts;
  return (
    (a === 10) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
};

/**
 * SOV-004: Refuses to start a sovereign turn if the Redis URL resolves to a
 * host outside the deployment's trust boundary.
 *
 * Loopback and RFC 1918 addresses are allowed (they never leave the machine or
 * the private network). A host in SOVEREIGN_REDIS_ALLOWLIST is also allowed,
 * which covers on-premises Redis clusters with routable IPs.
 *
 * Everything else — hosted Redis providers, public IPs — is refused.
 */
export const assertRedisLocal = async () => {
  const rawUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

  let host;
  try {
    // ioredis accepts redis://host:port and rediss://host:port
    host = new URL(rawUrl.replace(/^rediss?:\/\//, "http://")).hostname;
  } catch {
    // Cannot parse → cannot verify → fail closed.
    throw new PolicyDenied(
      `REDIS_URL ("${rawUrl}") could not be parsed. Set a valid redis:// URL that resolves locally.`,
      "SOV-004"
    );
  }

  if (allowlist().includes(host)) return;

  // A literal IP is checked directly; a hostname is resolved first so a
  // Docker Compose service name ("redis") passes when it resolves to 172.x.
  const addresses = net.isIP(host)
    ? [host]
    : await dns.lookup(host, { all: true })
        .then((entries) => entries.map((e) => e.address))
        .catch(() => {
          throw new PolicyDenied(
            `REDIS_URL host "${host}" could not be resolved. Sovereign Mode requires a reachable local Redis.`,
            "SOV-004"
          );
        });

  for (const ip of addresses) {
    if (isLoopback(ip) || isPrivateRfc1918(ip)) return;
  }

  throw new PolicyDenied(
    `REDIS_URL resolves to a public address (${addresses.join(", ")}). ` +
    "Sovereign Mode requires a local Redis instance. " +
    "Add the host to SOVEREIGN_REDIS_ALLOWLIST if it is an on-premises cluster.",
    "SOV-004"
  );
};

export const SOVEREIGN_BASE_URL =
 process.env.SOVEREIGN_BASE_URL || "";

// Local runtimes ignore the key, but the OpenAI client refuses to start
// without one.
export const SOVEREIGN_API_KEY =
 process.env.SOVEREIGN_API_KEY || "not-needed";

// Which local model answers for each agent. One deployment rarely serves every
// one of these, so they all fall back to a single general model that a small
// install can point at everything.
const DEFAULT_LOCAL_MODEL =
 process.env.SOVEREIGN_MODEL || "llama3.1";

export const localModelFor =
(agent)=>{

 switch(agent){

  case "coding":
   return process.env.SOVEREIGN_CODING_MODEL || DEFAULT_LOCAL_MODEL;

  case "vision":
   return process.env.SOVEREIGN_VISION_MODEL || DEFAULT_LOCAL_MODEL;

  case "pdf":
  case "ppt":
  case "pdf_rag":
   return process.env.SOVEREIGN_DOC_MODEL || DEFAULT_LOCAL_MODEL;

  default:
   return DEFAULT_LOCAL_MODEL;

 }

};

// Agents that cannot run without reaching a third party. Image generation is a
// Gemini call and search is a Tavily call; there is no local substitute wired
// up, so in Sovereign Mode they are refused rather than quietly served from the
// cloud. Sending the prompt to Tavily to "just do the search" is exactly the
// leak the mode exists to prevent.
export const CLOUD_ONLY_AGENTS =
 new Set([
  "image",
  "search",
  "github"
 ]);

// ── What the configured local model can actually do ────────────────────────
//
// localModelFor() returns a name; nothing verified the model behind it could
// do the job. The default falls through to a general text model, so a vision
// turn in Sovereign Mode handed an image to a model that cannot see and got
// back a confident description of nothing. A wrong answer is worse than a
// refusal, because the user believes it.
//
// Matched on substrings because a deployment names its own models: "llava",
// "llava:13b" and "my-org/llava-v1.6" are all the same capability.
const CAPABILITY_MARKERS = {

 vision:[
  "llava", "vision", "-vl", "minicpm-v", "moondream", "pixtral", "gemma3"
 ],

 tools:[
  "kimi", "qwen", "llama3.1", "llama3.2", "llama3.3", "mistral", "mixtral",
  "command-r", "firefunction", "hermes", "deepseek", "gpt-oss", "granite"
 ]

};

// Which agents genuinely need a capability. Everything absent needs plain text
// generation, which every model can do.
const AGENT_NEEDS = {
 vision:"vision"
};

export const modelSupports =
(model, capability)=>{

 const markers =
  CAPABILITY_MARKERS[capability];

 if(!markers) return true;

 const name =
  String(model || "").toLowerCase();

 return markers.some(
  (marker)=> name.includes(marker)
 );

};

/**
 * Refuses rather than answering badly when the configured local model cannot
 * do what the agent needs. Only applies in Sovereign Mode -- a cloud route
 * picks its own known-capable model.
 */
export const assertModelCapable =
(agent, model, sovereign)=>{

 if(!sovereign) return;

 const needed =
  AGENT_NEEDS[agent];

 if(!needed) return;

 if(modelSupports(model, needed)) return;

 throw new PolicyDenied(
  `The local model configured for this route ("${model}") cannot handle ${needed}. Point SOVEREIGN_VISION_MODEL at a model that can, or use this agent in Cloud Mode.`,
  "SOV-006"
 );

};

export class PolicyDenied extends Error{

 constructor(message, rule){

  super(message);

  this.name = "PolicyDenied";

  // The rule id is what lets an audit reconstruct *why* a request was
  // refused, months later, without the original prompt.
  this.rule = rule;

  this.isPolicyDenial = true;

 }

}

// Fail closed. If Sovereign Mode is asked for and no local runtime is
// configured, the turn dies here -- it must never walk back to a cloud model
// because the local one was unavailable. That fallback is the single most
// common way "local only" products leak, since it fires during an outage when
// nobody is watching the logs.
export const assertSovereignReady =
()=>{

 if(!SOVEREIGN_BASE_URL){

  throw new PolicyDenied(
   "Sovereign Mode is on but no local model runtime is configured. Set SOVEREIGN_BASE_URL. Refusing to fall back to a cloud model.",
   "SOV-001"
  );

 }

};

export const assertAgentAllowed =
(agent, sovereign)=>{

 if(!sovereign) return;

 if(CLOUD_ONLY_AGENTS.has(agent)){

  throw new PolicyDenied(
   `The "${agent}" agent needs an external service, so it is unavailable in Sovereign Mode.`,
   "SOV-002"
  );

 }

};
