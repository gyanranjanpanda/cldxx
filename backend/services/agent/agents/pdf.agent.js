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
import { internalApi }       from "../utils/internalApi.js";
import { isProviderRateLimit } from "../utils/model.js";

export const pdfAgent = async (state) => {
  let charged = false;
  try {

    await checkAgentLimit(state.userId, "pdf");
    await deductCredits(state.userId, "pdf");
    charged = true;

    const { buffer, meta } = await generateDocument({
      topic:  state.prompt,
      theme:  "professional",
      format: "pdf",
      sovereign: state.sovereign === true,
      modelState: { keys: state.keys, userId: state.userId, conversationId: state.conversationId, trace: state.trace },
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

    return {
      ...state,
      response: pdfResponse,
    };
  } catch (error) {
    const status = error?.status ?? error?.response?.status;
    const code = ["PDF_PLANNER_OUTPUT", "PDF_WRITER_OUTPUT"].find((value) => value === error?.code);
    const frames = String(error?.stack || "").split("\n").slice(1, 6)
      .flatMap((line) => line.match(/docgen\/[\w/.-]+:\d+:\d+/) ?? []);
    console.error("[pdfAgent] Generation failed", {
      conversationId: state.conversationId, status, errorType: error?.name, code, frames,
    });
    if (charged) {
      try {
        await internalApi.patch("/refund-credits", { userId: state.userId, agent: "pdf" }, { timeout: 5000 });
      } catch (refundError) {
        console.error("[pdfAgent] Credit refund failed", {
          conversationId: state.conversationId, status: refundError?.response?.status,
        });
      }
    }

    // Surface credit / rate-limit errors directly
    const apiError = error?.data ?? error?.response?.data;
    if (apiError?.title) {
      return {
        ...state,
        response: `❌ **${apiError.title}**\n\n${apiError.message ?? "Please upgrade your plan or wait before trying again."}`,
        isError: true,
      };
    }

    if (!charged && status === 429 && apiError?.retryAfter) {
      return {
        ...state,
        response: `❌ **PDF request limit**\n\n${apiError.message}`,
        isError: true,
      };
    }

    if (isProviderRateLimit(error)) {
      const dailyQuota = /per day|perday|daily quota/i.test(error?.message || "");
      const quotaOwner = state.keys?.google || state.keys?.deepseek
        ? "Your API key’s project"
        : "The AI provider";
      console.warn("[pdfAgent] Provider quota reached", { conversationId: state.conversationId, dailyQuota });
      return {
        ...state,
        response: dailyQuota
          ? `❌ **Cloud PDF quota reached**\n\n${quotaOwner} has reached its daily quota. Try again after the quota resets.`
          : `❌ **Cloud PDF rate limit**\n\n${quotaOwner} is temporarily rate limited. Try again later.`,
        isError: true,
      };
    }

    if (charged && (state.keys?.google || state.keys?.deepseek) &&
        (status === 401 || status === 403 || /API_KEY_INVALID/i.test(error?.message || ""))) {
      return {
        ...state,
        response: "❌ **PDF API key rejected**\n\nThe provider rejected your saved key. Check that it is active and can use the model, then replace it in API Keys.",
        isError: true,
      };
    }

    if (status === 503) {
      return {
        ...state,
        response: "❌ **PDF service temporarily unavailable**\n\nThe AI provider is at capacity. Try again shortly.",
        isError: true,
      };
    }

    if (code) {
      return {
        ...state,
        response: "❌ **PDF content could not be generated**\n\nThe AI returned incomplete document content. Try again with a short description of what the PDF should cover.",
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
