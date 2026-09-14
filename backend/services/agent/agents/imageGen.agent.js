import axios from "axios";
import { getModel } from "../utils/model.js";

import { uploadToS3 } from "../utils/uploadToS3.js";
import { getDownloadUrl } from "../utils/getDownloadUrl.js";
import { checkAgentLimit } from "../config/agentRateLimit.js";
import { deductCredits } from "../utils/deductCredits.js";

export const imageAgent = async (state) => {

  try {

await checkAgentLimit(
    state.userId,
    "image"
  );
 await deductCredits(

        state.userId,

        "image"

    );


    const llm =
      getModel("image");

    const promptResponse =
      await llm.invoke(`

You are an elite AI image prompt engineer.

Convert the user request into a highly detailed image generation prompt.

Requirements:

- Cinematic lighting
- Professional composition
- Ultra realistic
- High detail
- Beautiful color palette
- Sharp focus
- 8K quality
- Photorealistic
- Depth of field
- Professional photography
- Stunning visuals

Return only the image prompt.

User Request:

${state.prompt}

`);

    const enhancedPrompt =
      promptResponse.content.trim();

    const imageUrl =
      `https://image.pollinations.ai/prompt/${encodeURIComponent(
        enhancedPrompt
      )}`;

    // The upstream service is free and flaky, so a slow reply is normal and a
    // hung one used to block the request forever -- there was no timeout at all.
    let imageResponse = null;
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {

      imageResponse = await axios
        .get(imageUrl, {
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

    await uploadToS3(
      imageBuffer,
      fileName,
      mimeType
    );

    const LINK_TTL_SECONDS = 24 * 60 * 60;

    const downloadUrl =
      await getDownloadUrl(
        fileName,
        LINK_TTL_SECONDS
      );

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