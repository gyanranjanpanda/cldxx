import axios from "axios";

import { storeArtifact } from "../utils/storage.js";
import { checkAgentLimit } from "../config/agentRateLimit.js";
import { deductCredits } from "../utils/deductCredits.js";
import { internalApi } from "../utils/internalApi.js";

const LINK_TTL_SECONDS = 24 * 60 * 60;

// No guardrails here, deliberately. Every other agent fences the outside text
// it reads -- web pages, documents, repositories, tool output -- because that
// text can carry instructions. This agent reads none of it: it takes the
// user's own words and returns a picture, consults no external source and
// calls no tools, so there is no untrusted channel to defend. Adding an
// injection-rules block would only compete with the prompt the user is trying
// to write. Keep it out unless this agent starts reading something it did not
// get from the user.


export const imageAgent = async (state) => {

  let charged = false;

  try {

    const apiKey = String(process.env.POLLINATIONS_API_KEY || "").trim();
    if (!apiKey) {
      return {
        ...state,
        response: "❌ **Image generation is unavailable.** This deployment has no backup image provider key. Image mode also needs a running ComfyUI server. No credits were used for this request.",
        isError: true,
      };
    }

await checkAgentLimit(
    state.userId,
    "image"
  );
 await deductCredits(

        state.userId,

        "image"

    );
    charged = true;


    const imageUrl =
      `https://gen.pollinations.ai/image/${encodeURIComponent(state.prompt)}?model=${encodeURIComponent(process.env.POLLINATIONS_IMAGE_MODEL || "black-forest-labs/flux.1-schnell")}`;

    // A slow reply is possible, but a hung one must not block the chat forever.
    let imageResponse = null;
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {

      imageResponse = await axios
        .get(imageUrl, {
          headers: { Authorization: `Bearer ${apiKey}` },
          responseType: "arraybuffer",
          timeout: 90000,
          validateStatus: () => true
        })
        .catch((err) => {
          lastError = err;
          return null;
        });

      if (imageResponse && imageResponse.status === 200) break;

      lastError =
        lastError ||
        new Error(`image service returned ${imageResponse?.status}`);

      imageResponse = null;

      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }

    if (!imageResponse) {
      throw new Error(
        `The image service did not respond (${lastError?.message || "unknown error"}).`
      );
    }

    const imageBuffer =
      Buffer.from(
        imageResponse.data
      );

    // Previously anything with a 200 was uploaded and announced as a success,
    // so an HTML error page was happily stored and shown as a broken image.
    const contentType =
      String(imageResponse.headers["content-type"] || "");

    const magic = imageBuffer.slice(0, 3).toString("hex");
    const isJpeg = magic === "ffd8ff";
    const isPng = imageBuffer.slice(0, 4).toString("hex") === "89504e47";

    if (!contentType.startsWith("image/") || (!isJpeg && !isPng)) {
      throw new Error("The image service returned something that is not an image.");
    }

    // A real generation is tens of kilobytes; anything this small is an error
    // graphic rather than a picture.
    if (imageBuffer.length < 2048) {
      throw new Error("The image service returned an empty image.");
    }

    // The service answers with JPEG, but this was hardcoded to .png/image/png,
    // so every stored object was mislabelled.
    const extension = isPng ? "png" : "jpg";
    const mimeType = isPng ? "image/png" : "image/jpeg";

    const fileName =
      `image-${Date.now()}.${extension}`;

    const downloadUrl = await storeArtifact(imageBuffer, fileName, mimeType, state);

    return {

      ...state,

     response: `
# 🖼️ Image Generated Successfully

![Generated Image](${downloadUrl})

📥 [Download Image](${downloadUrl})

⏳ Link expires in ${LINK_TTL_SECONDS / 3600} hours.
`

    };

  } catch (error) {

    if (charged) {
      try {
        await internalApi.patch("/refund-credits", { userId: state.userId, agent: "image" });
      } catch (refundError) {
        console.error("Image credit refund failed:", refundError);
      }
    }

    console.log(
      "Image Agent Error:",
      error
    );

    const apiError = error?.data ?? error?.response?.data;
    if (apiError?.title) {
      return {
        ...state,
        response: `❌ **${apiError.title}**\n\n${apiError.message ?? "Please upgrade your plan or wait before trying again."}`,
        isError: true,
      };
    }

    return {

      ...state,

      // Say what actually went wrong: the old message claimed nothing more than
      // "try again" even when the service had returned a non-image.
      response:
        `❌ **Image generation failed**\n\n${
          error?.message || "The image service could not produce an image."
        }\n\nTry rephrasing the description, or try again in a moment.`,

      isError: true

    };

  }

};
