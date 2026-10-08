import redis from "../../../shared/redis/redis.js";

import {
 buildWorkflow,
 comfyConfigured,
 fetchImage,
 fetchOutputs,
 queuePrompt
} from "../utils/comfy.js";

import { uploadToS3 } from "../utils/uploadToS3.js";
import { getDownloadUrl } from "../utils/getDownloadUrl.js";
import { checkAgentLimit } from "../config/agentRateLimit.js";
import { deductCredits } from "../utils/deductCredits.js";
import { addMessage, isEphemeral } from "../utils/memory.js";
import { internalApi } from "../utils/internalApi.js";
import {
 assertAgentAllowed,
 resolveSovereign
} from "../utils/sovereign.js";

// Z-Image Turbo takes 30-90s on a T4, which is longer than most proxies and
// every serverless platform will hold a request open. So generation is split
// in two: this queues the job and answers immediately with the id, and the
// status route below collects the result. Nothing waits on the GPU.
//
// The alternative -- generating inside the graph the way the pollinations
// agent does -- works only because that service answers in seconds. At a
// minute and a half the request is dead before the picture exists.

const MAX_PROMPT_LENGTH = 2000;

// Long enough that a job can finish and be collected, short enough that a
// prompt id is not a credential with an indefinite life.
const JOB_TTL_SECONDS = 60 * 60;

const LINK_TTL_SECONDS = 24 * 60 * 60;

const jobKey = (promptId) =>
 `comfy-job:${promptId}`;

const claimKey = (promptId) =>
 `comfy-claim:${promptId}`;

// The browser polls every three seconds, so two requests can be in flight at
// once when one of them is slow. Without a claim both would download the PNG,
// both would upload it to S3 and both would write an assistant message, so the
// conversation would show the same picture twice.
const claimCompletion = async (promptId) => {

 const won = await redis.set(
  claimKey(promptId),
  "1",
  "EX",
  180,
  "NX"
 );

 return won === "OK";

};

const readJob = async (promptId) => {

 const raw = await redis.get(jobKey(promptId));

 if (!raw) return null;

 try {

  return JSON.parse(raw);

 } catch {

  return null;

 }

};

const writeJob = async (promptId, job) => {

 await redis.set(
  jobKey(promptId),
  JSON.stringify(job),
  "EX",
  JOB_TTL_SECONDS
 );

};

// "Image server is offline" is the one message the user asked to see when the
// tunnel is down, and 503 is what tells the browser this is the server's
// availability rather than the request's fault.
const offline = (res, detail) =>
 res.status(503).json({
  success: false,
  offline: true,
  title: "Image server is offline",
  message:
   detail ||
   "The image server is not reachable right now. Start the ComfyUI notebook and try again."
 });

export const generate =
async (req, res, next) => {

 try {

  const {
   prompt,
   width,
   height,
   conversationId,
   incognito,
   sovereign
  } = req.body || {};

  const text = String(prompt || "").trim();

  if (!text) {

   return res.status(400).json({
    success: false,
    title: "Nothing to draw",
    message: "Describe the image you want generated."
   });

  }

  if (text.length > MAX_PROMPT_LENGTH) {

   return res.status(400).json({
    success: false,
    title: "Prompt too long",
    message: `Keep the description under ${MAX_PROMPT_LENGTH} characters.`
   });

  }

  // The same rule the image agent already lives under, for the same reason and
  // then some: this ComfyUI is reached over a public Cloudflare tunnel, so a
  // sovereign turn sent here would put the prompt on the open internet --
  // exactly what the mode exists to prevent. Policy from the gateway outranks
  // what the client asked for.
  const zone = resolveSovereign(
   req.headers["x-sovereign-policy"],
   sovereign
  );

  assertAgentAllowed("image", zone.sovereign);

  if (!comfyConfigured()) {

   return offline(
    res,
    "COMFY_URL is not configured on the server, so there is no image server to reach."
   );

  }

  const userId = req.headers["x-user-id"];

  // Built before anything is charged: a workflow that cannot be read or has no
  // traceable prompt node is a server misconfiguration, and the user should
  // not pay a credit to find that out.
  const { graph, seed } = await buildWorkflow({
   prompt: text,
   width,
   height
  });

  let promptId;

  try {

   promptId = await queuePrompt(graph);

  } catch (error) {

   if (error.offline) {

    return offline(res, error.message);

   }

   throw error;

  }

  // The allowance and the credit are both spent here, after the GPU has really
  // accepted the job -- never before. Two reasons.
  //
  // An offline tunnel then costs the user nothing: the pollinations agent
  // deducts first and so bills for a generation that never started, which is
  // the mistake this avoids.
  //
  // And it is what makes the browser's fallback safe. When ComfyUI is
  // unreachable this route returns above having charged nothing and counted
  // nothing, so the backup engine applies its own limit and credit exactly
  // once. Counting here instead would quietly halve the 3/min image allowance
  // every time Colab was down -- one slot burnt by the attempt, one by the
  // engine that actually drew the picture.
  //
  // If either throws the job is left unclaimed: it finishes on the server and
  // is never collected, which is the right way round -- no image is delivered
  // unpaid.
  await checkAgentLimit(userId, "image");

  await deductCredits(userId, "image");

  const isIncognito =
   isEphemeral(conversationId) ||
   incognito === true ||
   incognito === "true";

  await writeJob(promptId, {
   userId,
   conversationId: conversationId || null,
   incognito: isIncognito,
   prompt: text,
   seed,
   startedAt: Date.now()
  });

  // The prompt joins the conversation now rather than when the picture lands,
  // so a reload mid-generation still shows what was asked for.
  if (conversationId) {

   await addMessage(
    conversationId,
    "user",
    text,
    { sovereign: false }
   );

   if (!isIncognito) {

    await internalApi.post("/save-message", {
     conversationId,
     role: "user",
     content: text,
     sovereign: false
    });

   }

  }

  return res.status(202).json({
   success: true,
   prompt_id: promptId,
   seed
  });

 } catch (error) {

  next(error);

 }

};

export const status =
async (req, res, next) => {

 try {

  const promptId = String(req.params.promptId || "");

  const job = await readJob(promptId);

  // A prompt id is all it takes to fetch a picture, so the job record is what
  // binds one to the user who paid for it. 404 rather than 403: confirming the
  // id exists would let someone walk the history of a shared ComfyUI.
  if (!job || job.userId !== req.headers["x-user-id"]) {

   return res.status(404).json({
    success: false,
    title: "Unknown job",
    message: "That generation was not found. It may have expired -- try generating again."
   });

  }

  // Already collected. Polls that arrive after completion -- a second tab, a
  // reload, the losing side of a race -- get the stored answer instead of
  // re-downloading and re-uploading the same image.
  if (job.images?.length) {

   return res.json({
    success: true,
    done: true,
    images: job.images,
    seed: job.seed,
    answer: job.answer || ""
   });

  }

  let outputs;

  try {

   outputs = await fetchOutputs(promptId);

  } catch (error) {

   if (error.offline) {

    return offline(res, error.message);

   }

   throw error;

  }

  if (!outputs) {

   return res.json({
    success: true,
    done: false
   });

  }

  if (!(await claimCompletion(promptId))) {

   // Another poll is finalising this one. Reporting "not done" lets the next
   // tick pick up the stored result, which is a tick later but never a
   // duplicate message.
   return res.json({
    success: true,
    done: false
   });

  }

  let image;

  try {

   image = await fetchImage(outputs.images[0]);

  } catch (error) {

   // The claim is released so a later poll can retry; a transient download
   // failure should not strand a job that the GPU actually completed.
   await redis.del(claimKey(promptId));

   if (error.offline) {

    return offline(res, error.message);

   }

   throw error;

  }

  // Stored and served from S3, the same as every other generated image in the
  // product. The browser never learns COMFY_URL: the bytes travel ComfyUI ->
  // this service -> S3, and the user gets a presigned link that keeps working
  // after the Colab notebook is gone, which a /view link would not.
  const fileName =
   `image-${Date.now()}.${image.extension}`;

  await uploadToS3(
   image.buffer,
   fileName,
   image.contentType
  );

  const downloadUrl =
   await getDownloadUrl(
    fileName,
    LINK_TTL_SECONDS
   );

  const images = [downloadUrl];

  const answer =
   `# 🖼️ Image Generated Successfully\n\n![Generated Image](${downloadUrl})\n\n📥 [Download Image](${downloadUrl})\n\n⏳ Link expires in ${LINK_TTL_SECONDS / 3600} hours.`;

  // The caption is stored with the image so a later poll -- a reload, a second
  // tab, the side of a race that did not finalise -- replays the identical
  // reply. Without it those callers got the picture with no text around it.
  await writeJob(promptId, {
   ...job,
   images,
   answer,
   finishedAt: Date.now()
  });

  if (job.conversationId) {

   await addMessage(
    job.conversationId,
    "assistant",
    answer,
    { sovereign: false }
   );

   if (!job.incognito) {

    await internalApi.post("/save-message", {
     conversationId: job.conversationId,
     role: "assistant",
     content: answer,
     images,
     artifacts: [],
     sovereign: false
    });

   }

  }

  return res.json({
   success: true,
   done: true,
   images,
   seed: job.seed,
   answer
  });

 } catch (error) {

  next(error);

 }

};
