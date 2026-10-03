// The native tool loop.
//
// Step 3 ships the loop with no tools registered in it, which is deliberate:
// the loop is the part that has to be right before anything can be allowed to
// touch a repository, and it is easier to get right in isolation than after
// read/grep/edit are competing for attention. Step 4 registers the real tools
// against this interface without changing it.

import { policyDenialWithin } from "./egress.js";
import { localRuntimeUnreachable } from "./policy.js";

// A model that keeps calling tools instead of answering is not making progress,
// and on local hardware each cycle costs real seconds. The cap turns a hang
// into a message.
const MAX_STEPS = 8;

/**
 * @typedef {object} Tool
 * @property {string}   name
 * @property {string}   description
 * @property {object}   parameters   JSON Schema for the arguments
 * @property {Function} run          (args) => Promise<string>
 */

export const toolSchema = (tools) =>
  tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));

const parseArguments = (raw) => {

  if (raw === undefined || raw === null || raw === "") return {};

  if (typeof raw === "object") return raw;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }

};

/**
 * Runs one tool call and renders the result as the string the model sees.
 *
 * A failing tool returns its error as ordinary content rather than throwing.
 * The model is usually able to recover -- wrong path, bad pattern -- and
 * killing the turn would make every such mistake fatal. Policy refusals are the
 * exception: those are not something to recover from, and they end the turn.
 */
export const runTool = async (tools, call) => {

  const name = call?.function?.name;

  const tool = tools.find((candidate) => candidate.name === name);

  if (!tool) return `Error: no tool named "${name}".`;

  const args = parseArguments(call.function.arguments);

  if (args === null) {
    return `Error: the arguments for "${name}" were not valid JSON. Emit a JSON object.`;
  }

  try {
    return String(await tool.run(args));
  } catch (error) {

    if (error.isPolicyDenial) throw error;

    return `Error: ${error.message}`;

  }

};

const complete = async ({ baseUrl, apiKey, model, messages, tools, timeoutMs, signal }) => {

  const controller = new AbortController();
  const abort = () => controller.abort();

  signal?.addEventListener("abort", abort, { once: true });

  const timer = setTimeout(abort, timeoutMs);

  try {

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      // Not streamed. A tool call has to arrive complete before it can be run,
      // and runtimes vary in how they chunk tool_calls across SSE frames --
      // reassembling that correctly for four runtimes is a real cost for no
      // user-visible gain, since nothing can be shown until the call is whole.
      // The final prose answer is streamed by the caller.
      body: JSON.stringify({
        model,
        stream: false,
        messages,
        tools: toolSchema(tools)
      })
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw localRuntimeUnreachable(baseUrl, `HTTP ${response.status} ${detail}`);
    }

    return (await response.json())?.choices?.[0]?.message ?? {};

  } catch (error) {

    if (error.isPolicyDenial) throw error;

    const denial = policyDenialWithin(error);

    if (denial) throw denial;

    if (signal?.aborted) return null;

    throw localRuntimeUnreachable(baseUrl, error.message);

  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }

};

/**
 * Drives tool calls until the model answers in prose.
 *
 * Mutates `messages` as it goes so the caller keeps the full exchange,
 * including tool results -- a transcript missing them would leave the next turn
 * unable to explain its own previous answer.
 *
 * @returns {Promise<{ content: string, steps: number, exhausted: boolean }>}
 */
export const runToolLoop = async (context, messages, tools, { onToolCall } = {}) => {

  for (let step = 0; step < MAX_STEPS; step += 1) {

    const message = await complete({ ...context, messages, tools });

    if (message === null) return { content: "", steps: step, exhausted: false };

    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

    if (calls.length === 0) {
      return { content: message.content || "", steps: step, exhausted: false };
    }

    // The assistant turn carrying the calls must be kept, or the tool results
    // that follow refer to a request the model cannot see.
    messages.push({
      role: "assistant",
      content: message.content || "",
      tool_calls: calls
    });

    for (const call of calls) {

      onToolCall?.(call);

      const result = await runTool(tools, call);

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result
      });

    }

  }

  return {
    content: `Stopped after ${MAX_STEPS} tool calls without reaching an answer.`,
    steps: MAX_STEPS,
    exhausted: true
  };

};
