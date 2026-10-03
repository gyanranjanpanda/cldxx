// Tool calling for models that cannot call tools.
//
// The probe found that qwen2.5-coder:7b on Ollama emits a perfectly formed call
// as *text* -- it knows what to say and not where to put it. That is the common
// case on local hardware, so the loop meets the model where it is: tools are
// described in the prompt, the reply is parsed rather than read out of a
// protocol field, and the runtime's constrained decoder is used as a second
// attempt when the model tried to call something and produced invalid syntax.
//
// Shared by the `constrained` and `react` modes. They differ only in how often
// the retry fires, which is a property of the model rather than of the code.

import { constraintFor, toolCallSchema } from "./constrain.js";
import { policyDenialWithin } from "./egress.js";
import { localRuntimeUnreachable } from "./policy.js";
import { runTool } from "./tools.js";

const MAX_STEPS = 8;

export const toolInstructions = (tools) => [
  "",
  "You have tools. To use one, reply with ONLY this JSON object and nothing else:",
  '{"tool": "<name>", "arguments": {<arguments>}}',
  "",
  "To answer the developer instead, reply with ordinary prose and no JSON.",
  "Never do both in one reply. Never invent a tool that is not listed.",
  "",
  "Tools:",
  ...tools.map(
    (tool) =>
      `- ${tool.name}(${Object.keys(tool.parameters?.properties ?? {}).join(", ")}) -- ${tool.description}`
  ),
  ""
].join("\n");

// Finds the first balanced {...} run in the text. A model often wraps its call
// in a sentence ("Sure, I'll read that file: {...}"), and discarding the whole
// reply over a courtesy phrase wastes a generation that was substantively
// correct.
const firstJsonObject = (text) => {

  const start = text.indexOf("{");

  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {

    const character = text[index];

    if (escaped) { escaped = false; continue; }

    if (character === "\\") { escaped = true; continue; }

    if (character === '"') { inString = !inString; continue; }

    if (inString) continue;

    if (character === "{") depth += 1;

    if (character === "}") {

      depth -= 1;

      if (depth === 0) return text.slice(start, index + 1);

    }

  }

  return null;

};

const stripFence = (text) =>
  String(text || "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

/**
 * Accepts every spelling of a call seen in the wild, because the alternative is
 * refusing work a model actually did correctly. Returns null for a plain prose
 * answer, which is the signal to stop looping.
 */
export const parseTextToolCall = (content, tools) => {

  const candidate = firstJsonObject(stripFence(content));

  if (!candidate) return null;

  let parsed;

  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }

  const name = parsed.tool ?? parsed.name ?? parsed.function?.name ?? parsed.tool_name;

  if (typeof name !== "string") return null;

  // A name no tool answers to is not a call. Treating it as one would send the
  // model an error for a sentence that merely happened to contain JSON.
  if (tools && !tools.some((tool) => tool.name === name)) return null;

  const args =
    parsed.arguments ?? parsed.args ?? parsed.parameters ?? parsed.input ?? {};

  return {
    id: `text-${Date.now()}`,
    function: {
      name,
      arguments: typeof args === "string" ? args : JSON.stringify(args)
    }
  };

};

/**
 * Did the model try to call something and fail at syntax, as opposed to simply
 * answering in prose?
 *
 * The distinction decides whether the constrained retry fires. Retrying on a
 * genuine prose answer would force a tool call the model did not want to make,
 * turning "here is your answer" into a spurious file read.
 */
export const looksLikeAttemptedCall = (content) => {

  const text = stripFence(content);

  if (text.startsWith("{") || text.startsWith("[")) return true;

  return /"(tool|name|arguments|function)"\s*:/.test(text);

};

const complete = async (context, body) => {

  const controller = new AbortController();
  const abort = () => controller.abort();

  context.signal?.addEventListener("abort", abort, { once: true });

  const timer = setTimeout(abort, context.timeoutMs);

  try {

    const response = await fetch(`${context.baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${context.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw localRuntimeUnreachable(context.baseUrl, `HTTP ${response.status} ${detail}`);
    }

    return (await response.json())?.choices?.[0]?.message?.content ?? "";

  } catch (error) {

    if (error.isPolicyDenial) throw error;

    const denial = policyDenialWithin(error);

    if (denial) throw denial;

    if (context.signal?.aborted) return null;

    throw localRuntimeUnreachable(context.baseUrl, error.message);

  } finally {
    clearTimeout(timer);
    context.signal?.removeEventListener("abort", abort);
  }

};

/**
 * The loop. Mirrors runToolLoop's contract so the session does not care which
 * strategy it got.
 */
export const runTextToolLoop = async (context, messages, tools, { onToolCall, onRetry } = {}) => {

  let retries = 0;

  for (let step = 0; step < MAX_STEPS; step += 1) {

    let content = await complete(context, {
      model: context.model,
      stream: false,
      messages,
      temperature: context.toolTemperature
    });

    if (content === null) return { content: "", steps: step, exhausted: false, retries };

    let call = parseTextToolCall(content, tools);

    // The constrained retry. Only when the model was reaching for a tool and
    // produced something unparseable -- never on a prose answer.
    if (!call && looksLikeAttemptedCall(content)) {

      retries += 1;
      onRetry?.(content);

      const forced = await complete(context, {
        model: context.model,
        stream: false,
        messages: [
          ...messages,
          {
            role: "user",
            content:
              "That was not a valid tool call. Reply with only the JSON object for the tool you intended to use."
          }
        ],
        temperature: context.toolTemperature,
        ...constraintFor(context.runtime, toolCallSchema(tools))
      });

      if (forced === null) return { content: "", steps: step, exhausted: false, retries };

      call = parseTextToolCall(forced, tools);

      // Still nothing. The original reply is the honest answer to return --
      // inventing a call here would be worse than admitting the model fumbled.
      if (!call) return { content, steps: step, exhausted: false, retries };

      content = forced;

    }

    if (!call) return { content, steps: step, exhausted: false, retries };

    messages.push({ role: "assistant", content });

    onToolCall?.(call);

    const result = await runTool(tools, call);

    // Fed back as a user turn, not a `tool` turn. A model that cannot emit
    // tool_calls generally has no tool role in its chat template either, and
    // a message in a role the template does not know is silently dropped by
    // some runtimes -- which looks exactly like the tool returning nothing.
    messages.push({
      role: "user",
      content: `Result of ${call.function.name}:\n${result}\n\nUse this to answer, or call another tool.`
    });

  }

  return {
    content: `Stopped after ${MAX_STEPS} tool calls without reaching an answer.`,
    steps: MAX_STEPS,
    exhausted: true,
    retries
  };

};
