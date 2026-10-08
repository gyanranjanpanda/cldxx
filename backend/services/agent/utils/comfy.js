import path from "path";
import { readFile, stat } from "fs/promises";
import { fileURLToPath } from "url";

import axios from "axios";

// Z-Image Turbo runs on a ComfyUI the user hosts themselves -- today a Colab
// notebook behind a Cloudflare tunnel. The tunnel hands out a new hostname
// every time the notebook restarts, so the base URL is read from the
// environment on every call rather than captured at module scope: pinning it
// here would mean a restarted notebook could only be picked up by restarting
// this service too.
export const comfyUrl = () =>
 String(process.env.COMFY_URL || "")
  .trim()
  .replace(/\/+$/, "");

export const comfyConfigured = () =>
 Boolean(comfyUrl());

const __dirname =
 path.dirname(fileURLToPath(import.meta.url));

// The exported workflow lives at the repo root, which is four levels up from
// backend/services/agent/utils. Overridable because a container image may lay
// the tree out differently.
const workflowPath = () =>
 process.env.COMFY_WORKFLOW ||
 path.join(
  __dirname,
  "..", "..", "..", "..",
  "workflow_api.json"
 );

// The server is reachable over a public tunnel that answers slowly when the
// notebook is cold, so "offline" has to mean "did not answer", not "took a
// moment". These are generous on purpose.
const QUEUE_TIMEOUT_MS = 20000;
const HISTORY_TIMEOUT_MS = 20000;
const IMAGE_TIMEOUT_MS = 60000;
const HEALTH_TIMEOUT_MS = 10000;

// Thrown when the tunnel itself is unreachable, as opposed to ComfyUI
// answering with a complaint. The controllers turn this one error into the
// "Image server is offline" the user sees, and nothing else -- a rejected
// workflow is a different problem with a different message.
export class ComfyOfflineError extends Error {

 constructor(message) {

  super(message || "Image server is offline");

  this.name = "ComfyOfflineError";

  // Read by the route handlers to choose the status code, so the decision
  // lives here rather than being re-derived from the message text.
  this.offline = true;

 }

}

// A missing base URL is the same user-visible situation as a dead tunnel --
// there is no image server to talk to -- so it raises the same error instead
// of a generic crash.
const requireUrl = () => {

 const base = comfyUrl();

 if (!base) {

  throw new ComfyOfflineError(
   "COMFY_URL is not set, so there is no image server to reach."
  );

 }

 return base;

};

// Connection-level failures mean offline; an HTTP response means the server is
// alive and said no, which the caller should surface verbatim. Axios reports
// both as rejections, so they are separated by whether a response came back.
const asComfyError = (error, what) => {

 if (error?.response) {

  const status = error.response.status;

  const detail =
   // ComfyUI answers a bad workflow with { error, node_errors }, and the
   // nested message is the only part that says what is actually wrong.
   error.response.data?.error?.message ||
   error.response.data?.error ||
   error.message;

  const err = new Error(
   `The image server rejected the ${what} (${status}): ${
    typeof detail === "string" ? detail : JSON.stringify(detail)
   }`
  );

  err.status = 502;

  return err;

 }

 return new ComfyOfflineError(
  `The image server did not respond to the ${what} (${error?.code || error?.message || "no response"}).`
 );

};

export const health = async () => {

 const base = requireUrl();

 await axios
  .get(`${base}/system_stats`, {
   timeout: HEALTH_TIMEOUT_MS
  })
  .catch((error) => {

   throw asComfyError(error, "health check");

  });

 return true;

};

// Re-read when the file changes rather than cached for the life of the
// process: the workflow is something the user re-exports from ComfyUI while
// iterating, and a cached copy would quietly keep generating from the old
// graph.
let cached = null;

const loadWorkflow = async () => {

 const file = workflowPath();

 const stamp = await stat(file).catch(() => null);

 if (!stamp) {

  const err = new Error(
   `No workflow found at ${file}. Export the workflow from ComfyUI with "Export (API)" and save it there.`
  );

  err.status = 500;

  throw err;

 }

 const key = `${stamp.mtimeMs}:${stamp.size}`;

 if (cached && cached.key === key) {

  return cached.graph;

 }

 const text = await readFile(file, "utf8");

 let graph;

 try {

  graph = JSON.parse(text);

 } catch {

  const err = new Error(
   `The workflow at ${file} is not valid JSON.`
  );

  err.status = 500;

  throw err;

 }

 // The UI's "Save" format is a different shape -- it nests everything under
 // `nodes` as an array. Only the API format has node ids as top-level keys
 // with a `class_type`, and only that format can be posted to /prompt.
 if (Array.isArray(graph?.nodes)) {

  const err = new Error(
   `The workflow at ${file} is in ComfyUI's UI format. Re-export it with "Export (API)" -- the API format is the one this endpoint accepts.`
  );

  err.status = 500;

  throw err;

 }

 cached = { key, graph };

 return graph;

};

const findByClass = (graph, classType) =>
 Object.keys(graph).filter(
  (id) => graph[id]?.class_type === classType
 );

// A ComfyUI link is ["<node id>", <output index>], so this is how a node
// reference in an input is turned back into a node id.
const linkedNode = (input) =>
 Array.isArray(input) ? String(input[0]) : null;

// Z-Image Turbo graphs carry two CLIPTextEncode nodes -- positive and negative
// -- and nothing in the node itself says which is which. Picking "the first
// one" is a coin flip that writes the user's prompt into the negative slot and
// returns the opposite of what they asked for. The sampler knows, so the
// answer is read from its `positive` input instead of guessed.
const findPromptNode = (graph, samplerId) => {

 const sampler = graph[samplerId];

 const direct = linkedNode(sampler?.inputs?.positive);

 // The link usually lands on the encoder, but a graph with a conditioning
 // combine or zero-out in between points at that instead, so the chain is
 // walked back to the first node that actually holds text.
 const seen = new Set();

 let at = direct;

 while (at && !seen.has(at)) {

  seen.add(at);

  const node = graph[at];

  if (!node) break;

  if (typeof node.inputs?.text === "string") {

   return at;

  }

  const next =
   linkedNode(node.inputs?.conditioning) ||
   linkedNode(node.inputs?.conditioning_1) ||
   linkedNode(node.inputs?.positive);

  at = next;

 }

 // Nothing traceable from the sampler. One text encoder in the whole graph is
 // still unambiguous; two or more without a usable link is not, and a wrong
 // guess is worse than a clear error.
 const encoders = findByClass(graph, "CLIPTextEncode");

 if (encoders.length === 1) {

  return encoders[0];

 }

 return null;

};

// KSampler calls it `seed`; the SamplerCustom/RandomNoise pair calls the same
// thing `noise_seed`. Both appear in Turbo workflows depending on which
// template the user started from, so both are handled rather than assuming the
// common one.
const SEED_FIELDS = ["seed", "noise_seed"];

const seedTargets = (graph) =>
 Object.keys(graph).filter((id) => {

  const inputs = graph[id]?.inputs;

  if (!inputs) return false;

  return SEED_FIELDS.some(
   (field) => typeof inputs[field] === "number"
  );

 });

// ComfyUI seeds are unsigned 64-bit, but JSON numbers lose precision past
// 2^53 and a seed that cannot round-trip is not reproducible. Staying inside
// the safe integer range keeps the value the user sees the value that ran.
const randomSeed = () =>
 Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);

// Latent sizes have to be multiples of 8 or the VAE decode fails, and an
// unbounded size is a way to ask a T4 for an allocation it cannot serve.
const LATENT_MIN = 256;
const LATENT_MAX = 1536;

const normaliseSize = (value, fallback) => {

 const number = Number(value);

 if (!Number.isFinite(number)) return fallback;

 const clamped = Math.min(
  LATENT_MAX,
  Math.max(LATENT_MIN, Math.round(number))
 );

 return Math.round(clamped / 8) * 8;

};

export const buildWorkflow = async ({
 prompt,
 width,
 height
}) => {

 const base = await loadWorkflow();

 // Deep-cloned per request. The cache hands out the same object to every
 // caller, so mutating it in place would leak one user's prompt and seed into
 // the next request to arrive.
 const graph = structuredClone(base);

 const samplers = seedTargets(graph);

 if (!samplers.length) {

  const err = new Error(
   "The workflow has no sampler with a seed input, so there is nothing to randomise."
  );

  err.status = 500;

  throw err;

 }

 const seed = randomSeed();

 for (const id of samplers) {

  for (const field of SEED_FIELDS) {

   if (typeof graph[id].inputs[field] === "number") {

    graph[id].inputs[field] = seed;

   }

  }

 }

 // The sampler that owns the positive conditioning is the one to trace from.
 // With a RandomNoise/SamplerCustomAdvanced pair the seed lives on a node with
 // no conditioning at all, so the search is over every candidate rather than
 // just the first seeded one.
 let promptNode = null;

 for (const id of samplers) {

  promptNode = findPromptNode(graph, id);

  if (promptNode) break;

 }

 if (!promptNode) {

  for (const id of Object.keys(graph)) {

   if (graph[id]?.class_type === "KSamplerSelect") continue;

   const candidate = findPromptNode(graph, id);

   if (candidate) {

    promptNode = candidate;

    break;

   }

  }

 }

 if (!promptNode) {

  const err = new Error(
   "Could not tell which CLIPTextEncode node holds the positive prompt. Connect the sampler's positive input to a text encoder and re-export the workflow."
  );

  err.status = 500;

  throw err;

 }

 graph[promptNode].inputs.text = prompt;

 // Only applied when asked for. A Turbo workflow is exported at the size it
 // was tuned at, and silently overriding that with a default would change
 // every generation the user did not ask to change.
 if (width != null || height != null) {

  const latents = Object.keys(graph).filter((id) => {

   const inputs = graph[id]?.inputs;

   return (
    inputs &&
    typeof inputs.width === "number" &&
    typeof inputs.height === "number"
   );

  });

  for (const id of latents) {

   graph[id].inputs.width =
    normaliseSize(width, graph[id].inputs.width);

   graph[id].inputs.height =
    normaliseSize(height, graph[id].inputs.height);

  }

 }

 return { graph, seed, promptNode };

};

export const queuePrompt = async (graph) => {

 const base = requireUrl();

 const { data } = await axios
  .post(
   `${base}/prompt`,
   { prompt: graph },
   { timeout: QUEUE_TIMEOUT_MS }
  )
  .catch((error) => {

   throw asComfyError(error, "generation request");

  });

 const promptId = data?.prompt_id;

 if (!promptId) {

  const err = new Error(
   "The image server accepted the request but did not return a prompt id."
  );

  err.status = 502;

  throw err;

 }

 return promptId;

};

// Returns null while the job is still queued or running -- ComfyUI answers
// {} for a prompt it has not finished, and the same {} for one it has never
// heard of, so "not done" is all this can honestly report.
export const fetchOutputs = async (promptId) => {

 const base = requireUrl();

 const { data } = await axios
  .get(
   `${base}/history/${encodeURIComponent(promptId)}`,
   { timeout: HISTORY_TIMEOUT_MS }
  )
  .catch((error) => {

   throw asComfyError(error, "status check");

  });

 const entry = data?.[promptId];

 if (!entry) return null;

 // A job can finish without producing anything -- an out-of-memory sampler or
 // a node that raised mid-graph. ComfyUI records that in `status`, and without
 // this the caller would poll a completed-but-empty history until the timeout
 // and report it as a timeout rather than a failure.
 const status = entry.status;

 const images = [];

 for (const nodeId of Object.keys(entry.outputs || {})) {

  for (const image of entry.outputs[nodeId].images || []) {

   images.push({
    filename: image.filename,
    subfolder: image.subfolder || "",
    type: image.type || "output"
   });

  }

 }

 if (images.length) {

  return { images };

 }

 if (status?.completed === true || status?.status_str === "error") {

  const messages = status.messages || [];

  // The useful line is in the execution_error message's payload; the rest of
  // the array is progress chatter.
  const failure = messages.find(
   (m) => Array.isArray(m) && m[0] === "execution_error"
  );

  const err = new Error(
   failure?.[1]?.exception_message ||
   "The image server finished the job without producing an image."
  );

  err.status = 502;

  throw err;

 }

 return null;

};

export const fetchImage = async ({
 filename,
 subfolder,
 type
}) => {

 const base = requireUrl();

 const response = await axios
  .get(`${base}/view`, {
   params: {
    filename,
    subfolder: subfolder || "",
    type: type || "output"
   },
   responseType: "arraybuffer",
   timeout: IMAGE_TIMEOUT_MS
  })
  .catch((error) => {

   throw asComfyError(error, "image download");

  });

 const buffer = Buffer.from(response.data);

 // The same check the pollinations agent learned to make: a 200 is not proof
 // of an image, and storing an HTML error page would show up as a broken
 // picture long after the cause was forgotten.
 const isPng =
  buffer.slice(0, 4).toString("hex") === "89504e47";

 const isJpeg =
  buffer.slice(0, 3).toString("hex") === "ffd8ff";

 if (!isPng && !isJpeg) {

  const err = new Error(
   "The image server returned something that is not an image."
  );

  err.status = 502;

  throw err;

 }

 return {
  buffer,
  contentType: isPng ? "image/png" : "image/jpeg",
  extension: isPng ? "png" : "jpg"
 };

};
