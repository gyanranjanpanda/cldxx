import dotenv from "dotenv";
dotenv.config();

// Sovereign Mode routes a turn to models the organisation runs itself, so no
// part of the prompt leaves their infrastructure. vLLM, SGLang, Ollama and
// llama.cpp all speak the OpenAI HTTP shape, so the runtime is a base URL
// rather than a vendor -- binding to one of them would make the product only
// as portable as whichever we picked.

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

// A turn is sovereign when the client asks for it. The string form is here
// because the browser sends this over multipart/form-data alongside a file
// upload, where every field arrives as text -- `sovereign: false` and
// `sovereign: "false"` must not mean different things.
export const isSovereign =
(value)=>
 value === true ||
 value === "true";

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
