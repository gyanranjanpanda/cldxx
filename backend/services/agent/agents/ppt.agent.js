/**
 * PPT Agent — thin wrapper over the Document Generation Engine.
 *
 * This LangGraph node:
 *   1. Checks credits/limits
 *   2. Calls the docgen pipeline with format "pptx"
 *   3. Uploads the result to S3
 *   4. Returns a download link
 *
 * All deck logic lives in docgen/ — the same planner, writer, schema, validation
 * and themes the PDF uses. Slide drawing is in docgen/exporters/pptx.js.
 */

import { generateDocument } from "../docgen/pipeline.js";
import { uploadToS3 }       from "../utils/uploadToS3.js";
import { getDownloadUrl }   from "../utils/getDownloadUrl.js";
import { checkAgentLimit }  from "../config/agentRateLimit.js";
import { deductCredits }    from "../utils/deductCredits.js";

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export const pptAgent = async (state) => {
  try {
    await checkAgentLimit(state.userId, "ppt");
    await deductCredits(state.userId, "ppt");

    const { buffer, meta } = await generateDocument({
      topic:  state.prompt,
      theme:  "professional",
      format: "pptx",
    });

    const fileName = `ppt-${Date.now()}.pptx`;
    await uploadToS3(buffer, fileName, PPTX_MIME);
    const downloadUrl = await getDownloadUrl(fileName, 24 * 60 * 60);

    return {
      ...state,
      response: `
# ✅ Presentation Generated Successfully

📊 **${meta.title}**
🖼️ ${meta.pages} slides

📥 [Download PPT](${downloadUrl})

⏳ Link expires in 24 hours.
`.trim(),
    };
  } catch (error) {
    console.error("[pptAgent] Error:", error);

    // Surface credit / rate-limit errors directly
    const apiError = error?.data ?? error?.response?.data;
    if (apiError?.title) {
      return {
        ...state,
        response: `❌ **${apiError.title}**\n\n${apiError.message ?? "Please upgrade your plan or wait before trying again."}`,
        isError: true,
      };
    }

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
      response: "❌ Failed to generate presentation. Please try again.",
        isError: true,
    };
  }
};
