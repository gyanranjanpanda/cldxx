import dotenv from "dotenv";
dotenv.config();

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";
import { ChatOpenRouter } from "@langchain/openrouter";

export const getModel = (agent) => {
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