import dotenv from "dotenv";
dotenv.config();

import { ChatDeepSeek } from "@langchain/deepseek";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";
import { ChatOpenAI } from "@langchain/openai";

import {
 SOVEREIGN_BASE_URL,
 SOVEREIGN_API_KEY,
 localModelFor,
 assertSovereignReady,
 assertAgentAllowed,
 assertModelCapable
} from "./sovereign.js";

import { assertModelIntegrity, fingerprintOf } from "./provenance.js";

import { audit } from "./audit.js";

// DeepSeek serves every route that needs more than a short text reply: the
// MCP loop, whose bound tool schemas are ~9k tokens of prompt before the
// conversation starts (a free Groq key refuses that outright -- "Request too
// large ... on tokens per minute (TPM): Limit 8000, Requested 9125"); coding,
// where a whole generated project has to fit in one reply; and the document
// and vision routes, which need to read an image. Plain chat does not need
// any of that and stays on Groq, which is faster and cheaper.
// Bring your own key. A user who has pasted their own provider key pays that
// provider directly, so their key is preferred over the platform's wherever a
// cloud client is built. It is read from the turn's state rather than the
// environment because it varies by user, not by deployment -- the same process
// serves one request on the platform's key and the next on someone else's.
const PLATFORM_ENV = {
  groq:     "GROQ_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  google:   "GOOGLE_API_KEY"
};

const keyFor = (provider, state) =>
  state?.keys?.[provider] || process.env[PLATFORM_ENV[provider]] || "";

// True when *someone* can pay for DeepSeek on this turn -- the user or us.
const deepseekConfigured = (state) => Boolean(keyFor("deepseek", state));

const deepseek = (state, { maxTokens } = {}) =>
  new ChatDeepSeek({
    apiKey: keyFor("deepseek", state),
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    temperature: 0,
    maxRetries: 2,
    ...(maxTokens ? { maxTokens } : {}),
  });

// `sovereign` is threaded in from the graph state rather than read from the
// environment, because it is a property of the turn: the same deployment
// answers an ordinary question from the cloud and a confidential one locally,
// and the decision has to be made per request.
export const getModel =
(agent, state = {})=>{

 const sovereign =
  state.sovereign === true;

 const context = {

  userId: state.userId,

  conversationId: state.conversationId,

  prompt: state.prompt,

  agent

 };

 if(sovereign){

  // Both of these throw. Nothing below them may run, and in particular there
  // is no catch that retries against a cloud provider -- a turn that cannot
  // be served locally fails as a turn.
  assertSovereignReady();

  assertAgentAllowed(agent, sovereign);

  const model = localModelFor(agent);

  // Checked after the agent is allowed but before anything is constructed: a
  // model that cannot do the job should refuse here, not produce a confident
  // answer about an image it never saw.
  assertModelCapable(agent, model, sovereign);

  // Checked before the client is built: a substituted model should be refused,
  // not discovered in the log afterwards.
  assertModelIntegrity(model, sovereign);

  audit({

   ...context,

   zone: "SOVEREIGN",

   model,

   modelDigest: fingerprintOf(model).digest,

   endpoint: SOVEREIGN_BASE_URL,

   decision: "ALLOW",

   rule: "SOV-000"

  });

  return new ChatOpenAI({

   apiKey: SOVEREIGN_API_KEY,

   model,

   temperature: agent === "chat" ? 0.3 : 0,

   configuration:{

    baseURL: SOVEREIGN_BASE_URL

   }

  });

 }

 audit({

  ...context,

  zone: "CLOUD",

  decision: "ALLOW",

  rule: "CLD-000"

 });

 switch (agent) {
   case "coding":
     if (deepseekConfigured(state)) {
       return deepseek(state, {
         maxTokens: Number(process.env.CODING_MAX_TOKENS) || 16000,
       });
     }

     // A whole project has to fit in one reply, and gpt-oss spends part of its
     // budget on reasoning tokens before it emits any code -- too small a cap
     // truncates the last file mid-function.
     return new ChatGroq({
       apiKey: keyFor("groq", state),
       model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
       temperature: 0,
       maxRetries: 2,
       maxTokens: Number(process.env.CODING_MAX_TOKENS) || 16000,
     });

   // PDF and PPT require reliable structured JSON output. Gemini 2.5 Flash
   // follows JSON instructions very consistently and stays the fallback here,
   // so a DeepSeek outage degrades the document routes rather than ending them.
   //
   // pdf_rag answers questions about an uploaded document rather than writing
   // one, but it is the same kind of work on the same kind of input -- and
   // sovereign.js already groups all three under SOVEREIGN_DOC_MODEL, so
   // leaving it out here sent it to the Groq default and split the two layers.
   case "pdf":
   case "ppt":
   case "pdf_rag":
     if (deepseekConfigured(state)) return deepseek(state);

     return new ChatGoogleGenerativeAI({
       model: "gemini-2.5-flash",
       apiKey: keyFor("google", state),
       temperature: 0,
     });

   case "vision":
     if (deepseekConfigured(state)) return deepseek(state);

     return new ChatGoogleGenerativeAI({
       model: "gemini-2.5-flash",
       apiKey: keyFor("google", state),
     });

   // Not an agent the router can pick: the chat agent asks for this one only
   // once it knows the user has MCP tools to bind, so an ordinary chat turn is
   // never charged DeepSeek's latency for tools it is not going to send.
   case "mcp":
     if (deepseekConfigured(state)) return deepseek(state);

     return new ChatGroq({
       apiKey: keyFor("groq", state),
       model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
       temperature: 0,
       maxRetries: 2,
     });

   // Chat is short text and the router classifies every single message, so
   // both stay on the fast, cheap model.
   case "chat":
   case "image":
   default:
     return new ChatGroq({
       apiKey: keyFor("groq", state),
       model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
       temperature: 0,
       maxRetries: 2,
     });
 }
};
