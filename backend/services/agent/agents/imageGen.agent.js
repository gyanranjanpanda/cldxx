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

    const imageResponse =
      await axios.get(
        imageUrl,
        {
          responseType:
            "arraybuffer"
        }
      );

    const imageBuffer =
      Buffer.from(
        imageResponse.data
      );

    const fileName =
      `image-${Date.now()}.png`;

    await uploadToS3(
      imageBuffer,
      fileName,
      "image/png"
    );

    const downloadUrl =
      await getDownloadUrl(
        fileName,
        24*60*60
      );

    return {

      ...state,

     response: `
# 🖼️ Image Generated Successfully

![Generated Image](${downloadUrl})

📥 [Download Image](${downloadUrl})

⏳ Link expires in 10 minutes.
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
      };
    }

    return {

      ...state,

      response:
        "❌ Failed to generate image. Please try again."

    };

  }

};