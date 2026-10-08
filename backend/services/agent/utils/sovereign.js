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
  "search"
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
