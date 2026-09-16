import dotenv from "dotenv";
dotenv.config();

import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";
import { ChatOpenRouter } from "@langchain/openrouter";

// Claude is used where it is strongest -- open-ended chat with MCP tools bound,
// and code generation -- and only when a key is configured. Without one, every
// route falls through to exactly the providers used before, so adding the key
// is the whole migration and removing it is the whole rollback.
const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

const claudeConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

const claude = (maxTokens) =>
  new ChatAnthropic({
    model: CLAUDE_MODEL,
    // Opus 5 thinks by default and max_tokens caps thinking AND the reply
    // together, so this budget is larger than the equivalent Groq one --
    // sized too tightly, the answer truncates mid-sentence after the model
    // has spent the budget reasoning.
    maxTokens,
    // Already the default on Opus 5; stated so the intent is visible rather
    // than implied by absence.
    thinking: { type: "adaptive" },
    // Deliberately NO temperature/top_p/top_k: Opus 5 rejects all three with a
    // 400. The other providers below still take temperature -- this is the one
    // branch where passing it breaks the request.
  });

export const getModel = (agent) => {
  switch (agent) {
    case "coding":
      if (claudeConfigured()) {
        // Deliberately NOT CODING_MAX_TOKENS: that value was tuned for Groq,
        // where the budget covers only the reply. Here it also has to cover
        // thinking, so inheriting it would truncate generated projects.
        return claude(Number(process.env.CLAUDE_CODING_MAX_TOKENS) || 32000);
      }

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

    case "chat":
      if (claudeConfigured()) {
        return claude(Number(process.env.CLAUDE_CHAT_MAX_TOKENS) || 16000);
      }

      return new ChatGroq({
        apiKey: process.env.GROQ_API_KEY,
        model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
        temperature: 0,
        maxRetries: 2,
      });

    // The router classifies every single message, so it stays on the fast,
    // cheap model even when Claude is configured -- routing one word through
    // a frontier model is the most expensive way to save nothing.
    case "router":
    case "image":
    case "search":
    default:
      return new ChatGroq({
        apiKey: process.env.GROQ_API_KEY,
        model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
        temperature: 0,
        maxRetries: 2,
      });
  }
};