import api from "../utils/axios";

// Z-Image Turbo runs on a self-hosted ComfyUI and takes 30-90s on a T4, so the
// server queues the job and hands back an id instead of holding the request
// open for a minute and a half. The waiting happens here, in the browser,
// where a slow reply costs nothing.

const POLL_INTERVAL_MS = 3000;

// Generation is 30-90s on a healthy GPU, so three minutes is already well past
// "slow". Past it the notebook has almost certainly died mid-job, and the user
// is better told that than left watching a spinner that will never stop.
const POLL_TIMEOUT_MS = 3 * 60 * 1000;

// Carries a title/message pair the composer's banner can show as-is. Server
// failures already arrive in that shape on error.response.data; this is for
// the ones decided in the browser.
export class ImageError extends Error {

 constructor(title, detail) {

  super(detail);

  this.name = "ImageError";

  this.title = title;

  this.detail = detail;

 }

}

const wait = (ms) =>
 new Promise((resolve) => setTimeout(resolve, ms));

export const queueImage = async (payload) => {

 const { data } = await api.post(
  "/api/agent/image/generate",
  payload
 );

 return data;

};

export const getImageStatus = async (promptId) => {

 const { data } = await api.get(
  `/api/agent/image/status/${promptId}`
 );

 return data;

};

export const generateImage = async ({
 prompt,
 conversationId,
 incognito,
 sovereign,
 width,
 height
}) => {

 let queued;

 try {

  queued = await queueImage({
   prompt,
   conversationId,
   incognito,
   sovereign,
   ...(width ? { width } : {}),
   ...(height ? { height } : {})
  });

 } catch (error) {

  // Dual mode. The ComfyUI box is a Colab notebook behind a tunnel that dies
  // on every restart, so "unreachable" is the ordinary case rather than an
  // exceptional one. Reported rather than thrown, so the caller can fall back
  // to the pollinations agent instead of stopping at an error.
  //
  // Only a queue-time refusal is reported this way. The server charges the
  // credit and the rate-limit slot only once the GPU has accepted the job, so
  // this branch is reached having spent neither -- which is what lets the
  // backup engine spend its own exactly once. A tunnel that dies *after* the
  // job was accepted has already cost a credit, so it stays an error rather
  // than silently paying twice for one picture.
  if (
   error.response?.status === 503 &&
   error.response?.data?.offline === true
  ) {

   return { offline: true };

  }

  throw error;

 }

 const { prompt_id } = queued;

 const deadline = Date.now() + POLL_TIMEOUT_MS;

 while (Date.now() < deadline) {

  await wait(POLL_INTERVAL_MS);

  const status = await getImageStatus(prompt_id);

  if (status.done) {

   return {
    images: status.images || [],
    answer: status.answer || ""
   };

  }

 }

 throw new ImageError(
  "Image is taking too long",
  "The image server did not finish within three minutes. It may have run out of memory or the notebook may have stopped — check it and try again."
 );

};
