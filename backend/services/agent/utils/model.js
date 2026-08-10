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
          maxTokens: 2500,
        });
      }
      return new ChatGroq({
        apiKey: process.env.GROQ_API_KEY,
        model: "llama-3.3-70b-versatile",
        temperature: 0,
        maxRetries: 2,
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
        model: "llama-3.3-70b-versatile",
        temperature: 0,
        maxRetries: 2,
      });
  }
};