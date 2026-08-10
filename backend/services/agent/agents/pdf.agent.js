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
import { uploadToS3 }       from "../utils/uploadToS3.js";
import { getDownloadUrl }   from "../utils/getDownloadUrl.js";
import { checkAgentLimit }   from "../config/agentRateLimit.js";
import { deductCredits }     from "../utils/deductCredits.js";

export const pdfAgent = async (state) => {
  try {
    await checkAgentLimit(state.userId, "pdf");
    await deductCredits(state.userId, "pdf");

    const { buffer, meta } = await generateDocument({
      topic:  state.prompt,
      theme:  "professional",
      format: "pdf",
    });

    const fileName = `pdf-${Date.now()}.pdf`;
    await uploadToS3(buffer, fileName, "application/pdf");
    const downloadUrl = await getDownloadUrl(fileName, 24 * 60 * 60);

    return {
      ...state,
      response: `
# ✅ PDF Generated Successfully

📄 **${meta.title}**
📊 ~${meta.pages} pages

📥 [Download PDF](${downloadUrl})

⏳ Link expires in 24 hours.
`.trim(),
    };
  } catch (error) {
    console.error("[pdfAgent] Error:", error);

    // Surface credit / rate-limit errors directly
    const apiError = error?.data ?? error?.response?.data;
    if (apiError?.title) {
      return {
        ...state,
        response: `❌ **${apiError.title}**\n\n${apiError.message ?? "Please upgrade your plan or wait before trying again."}`,
      };
    }

    // Detect Gemini API rate limits
    const isRateLimit = error?.status === 429 || error?.message?.includes("429") || error?.message?.includes("quota");
    if (isRateLimit) {
      return {
        ...state,
        response: "❌ **AI Rate Limit**\n\nThe AI service is temporarily rate-limited. Please wait 1 minute and try again.",
      };
    }

    return {
      ...state,
      response: "❌ Failed to generate PDF. Please try again.",
    };
  }
};