/**
 * PDF Agent — thin wrapper over the Document Generation Engine.
 *
 * This LangGraph node:
 *   1. Checks credits/limits
 *   2. Calls the docgen pipeline
 *   3. Uploads the result to S3
 *   4. Returns a download link
 *
 * All document logic lives in docgen/.
 */

import { generateDocument } from "../docgen/pipeline.js";
import { storeArtifact }     from "../utils/storage.js";
import { checkAgentLimit }   from "../config/agentRateLimit.js";
import { deductCredits }     from "../utils/deductCredits.js";
import { getCached, setCached } from "../utils/promptCache.js";

export const pdfAgent = async (state) => {
  try {

    // Cache check — same prompt = same PDF structure. Serve from Redis, skip
    // the LLM + S3 upload entirely.
    const cached = await getCached("pdf", state.prompt, state.sovereign === true);
    if (cached) {
      console.log("[pdfAgent] cache hit:", state.prompt.slice(0, 60));
      return { ...state, response: cached.response, artifacts: cached.artifacts, fromCache: true };
    }

    await checkAgentLimit(state.userId, "pdf");
    await deductCredits(state.userId, "pdf");

    const { buffer, meta } = await generateDocument({
      topic:  state.prompt,
      theme:  "professional",
      format: "pdf",
      sovereign: state.sovereign === true,
    });

    const fileName = `pdf-${Date.now()}.pdf`;
    const downloadUrl = await storeArtifact(buffer, fileName, "application/pdf", state);

    const pdfResponse = `
# ✅ PDF Generated Successfully

📄 **${meta.title}**
📊 ~${meta.pages} pages

📥 [Download PDF](${downloadUrl})

⏳ Link expires in 24 hours.
`.trim();

    await setCached("pdf", state.prompt, state.sovereign === true, {
      response: pdfResponse,
      artifacts: []
    });

    return {
      ...state,
      response: pdfResponse,
    };
  } catch (error) {
    console.error("[pdfAgent] Error:", error);

    // Surface credit / rate-limit errors directly
    const apiError = error?.data ?? error?.response?.data;
    if (apiError?.title) {
      return {
        ...state,
        response: `❌ **${apiError.title}**\n\n${apiError.message ?? "Please upgrade your plan or wait before trying again."}`,
        isError: true,
      };
    }

    // Detect Gemini API rate limits
    const isRateLimit = error?.status === 429 || error?.message?.includes("429") || error?.message?.includes("quota");
    if (isRateLimit) {
      return {
        ...state,
        response: "❌ **AI Rate Limit**\n\nThe AI service is temporarily rate-limited. Please wait 1 minute and try again.",
        isError: true,
      };
    }

    return {
      ...state,
      response: "❌ Failed to generate PDF. Please try again.",
        isError: true,
    };
  }
};