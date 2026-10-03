// Streaming completions over the OpenAI wire format, with no SDK.
//
// Zero dependencies is a feature here, not minimalism for its own sake: this
// package has to install on an air-gapped workstation from a mirror or a USB
// stick, and every dependency is one more thing to vendor and one more thing
// that could open a socket of its own.

import { policyDenialWithin } from "./egress.js";
import { localRuntimeUnreachable } from "./policy.js";

const IDENTITY = [
  "You are cldx code, a coding assistant running on the developer's own hardware.",
  "Answer concretely and briefly. Prefer showing code over describing it."
].join(" ");

// Told, not left to be inferred. A model that does not know it lacks file
// access will describe the contents of files it has never seen, confidently,
// and the developer has no way to tell that apart from a real read.
const WITHOUT_TOOLS = [
  "You have no access to the filesystem, the shell, or the network.",
  "If asked to read, search, or change a file, say plainly that you cannot,",
  "and work from what the developer has pasted instead of guessing."
].join(" ");

const WITH_TOOLS = [
  "Use the provided tools to inspect the repository rather than guessing.",
  "Never claim to have read a file you did not read with a tool."
].join(" ");

/**
 * @param {object}  options
 * @param {boolean} options.toolsUsable
 * @param {string}  options.contract  tool descriptions, when the model takes
 *                                    them in the prompt rather than the protocol
 */
export const newConversation = ({ toolsUsable = false, contract = "" } = {}) => [
  {
    role: "system",
    content: `${IDENTITY} ${toolsUsable ? WITH_TOOLS : WITHOUT_TOOLS}${contract}`
  }
];

/**
 * Yields text deltas as they arrive.
 *
 * Any transport failure becomes CODE-002. That mapping is the whole point: the
 * caller is given something it can only report, never something it could
 * plausibly retry against a different provider.
 */
export async function* streamCompletion({ baseUrl, apiKey, model, messages, signal, timeoutMs }) {

  const controller = new AbortController();

  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });

  const timer = setTimeout(abort, timeoutMs);

  let response;

  try {

    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model, messages, stream: true })
    });

  } catch (error) {

    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);

    // A user pressing ctrl-c is not a policy event.
    if (signal?.aborted) return;

    // Order matters. The egress guard throws from under fetch, so a refusal
    // arrives here wrapped in a TypeError and would otherwise be reported as
    // "the local runtime did not respond" -- a blocked exfiltration attempt
    // described to the user as an outage.
    const denial = policyDenialWithin(error);

    if (denial) throw denial;

    throw localRuntimeUnreachable(baseUrl, error.message);

  }

  try {

    if (!response.ok) {

      const detail = (await response.text()).slice(0, 400);

      throw localRuntimeUnreachable(baseUrl, `HTTP ${response.status} ${detail}`);

    }

    // SSE frames are separated by a blank line and can split across chunks, so
    // the tail of a chunk is carried forward rather than parsed as it stands.
    let buffer = "";

    for await (const chunk of response.body) {

      buffer += Buffer.from(chunk).toString("utf8");

      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {

        for (const line of frame.split("\n")) {

          if (!line.startsWith("data:")) continue;

          const payload = line.slice(5).trim();

          if (payload === "[DONE]") return;

          try {

            const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;

            if (delta) yield delta;

          } catch {
            // A frame that is not JSON is a runtime quirk, not a reason to lose
            // the rest of a working stream.
          }

        }

      }

    }

  } finally {

    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);

  }

}
