import dotenv from "dotenv";
dotenv.config();

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";
import { ChatOpenRouter } from "@langchain/openrouter";
import { ChatOpenAI } from "@langchain/openai";

import {
 SOVEREIGN_BASE_URL,
 SOVEREIGN_API_KEY,
 localModelFor,
 assertSovereignReady,
 assertAgentAllowed
} from "./sovereign.js";

import { audit } from "./audit.js";

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

  audit({

   ...context,

   zone: "SOVEREIGN",

   model,

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
     if (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.startsWith("sk-or-")) {
       return new ChatOpenRouter({
         apiKey: process.env.OPENROUTER_API_KEY,
         model: "deepseek/deepseek-chat",
         temperature: 0,
         maxTokens: Number(process.env.CODING_MAX_TOKENS) || 16000,
       });
     }
     // A whole project has to fit in one reply, and gpt-oss spends part of its
     // budget on reasoning tokens before it emits any code -- too small a cap
     // truncates the last file mid-function.
     return new ChatGroq({
       apiKey: process.env.GROQ_API_KEY,
       model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
       temperature: 0,
       maxRetries: 2,
       maxTokens: Number(process.env.CODING_MAX_TOKENS) || 16000,
     });

   // PDF and PPT require reliable structured JSON output.
   // Gemini 2.5 Flash follows JSON instructions very consistently.
   case "pdf":
   case "ppt":
     return new ChatGoogleGenerativeAI({
       model: "gemini-2.5-flash",
       apiKey: process.env.GOOGLE_API_KEY,
       temperature: 0,
     });

   case "vision":
     return new ChatGoogleGenerativeAI({
       model: "gemini-2.5-flash",
       apiKey: process.env.GOOGLE_API_KEY,
     });

   case "image":
   case "search":
   case "chat":
   default:
     return new ChatGroq({
       apiKey: process.env.GROQ_API_KEY,
       model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
       temperature: 0,
       maxRetries: 2,
     });
 }
};
