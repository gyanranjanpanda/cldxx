// Branch C -- can this model actually call tools?
//
// The branch the whole product rests on. Claude Code is built on a model with
// reliable, trained-in tool calling; a 7B coder on a workstation may or may not
// have it, and an agent loop that assumes it produces a stream of malformed
// JSON and burned GPU hours. So the question is measured once, at startup, with
// a single request -- not assumed from the model's name, which lies: the same
// weights behave differently depending on whether the runtime ships a tool
// template for them.

import path from "node:path";
import { localRuntimeUnreachable } from "./policy.js";
import { policyDenialWithin } from "./egress.js";
import { cldxDir, readJson, writeJson } from "./workspace.js";

export const MODES = {
  NATIVE: "native",
  CONSTRAINED: "constrained",
  REACT: "react",
  READ_ONLY: "read-only"
};

// Which modes can execute a tool. Only read-only cannot, and it is the mode
// reached when the model ignored the tool entirely or the runtime refused the
// request -- there is nothing left to drive.
//
// native goes through the OpenAI tools API; constrained and react go through
// the text protocol in textloop.js, which differ only in how often the
// constrained retry has to fire.
const EXECUTABLE = new Set([MODES.NATIVE, MODES.CONSTRAINED, MODES.REACT]);

export const canExecuteTools = (mode) => EXECUTABLE.has(mode);

// Whether tools travel in the protocol or in the prompt.
export const usesTextProtocol = (mode) =>
  mode === MODES.CONSTRAINED || mode === MODES.REACT;

const PROBE_TOOL = {
  type: "function",
  function: {
    name: "ping",
    description: "Echo a message back to the caller.",
    parameters: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"]
    }
  }
};

const PROBE_MESSAGES = [
  {
    role: "user",
    content: "Call the ping tool with the message \"hello\". Use the tool; do not answer in prose."
  }
];

// Models wrap JSON in fences as often as not, and a fence is a formatting habit
// rather than a capability difference -- stripping it costs nothing and
// correctly separates "knows what to emit" from "cannot emit it".
const stripFence = (text) =>
  String(text || "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

const parsesAsToolCall = (content) => {

  const text = stripFence(content);

  if (!text.startsWith("{") && !text.startsWith("[")) return false;

  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }

  const candidate = Array.isArray(parsed) ? parsed[0] : parsed;

  if (!candidate || typeof candidate !== "object") return false;

  // The shapes a model reaches for when it knows the call but not the channel.
  const name =
    candidate.name ||
    candidate.tool ||
    candidate.function?.name ||
    candidate.tool_name;

  return name === PROBE_TOOL.function.name;

};

const hasValidToolCall = (message) => {

  const calls = message?.tool_calls;

  if (!Array.isArray(calls) || calls.length === 0) return false;

  const call = calls[0];

  if (call?.function?.name !== PROBE_TOOL.function.name) return false;

  // A name with unparseable arguments is not a working tool call -- it is the
  // same failure one layer in, and treating it as native would hand the
  // executor garbage on the first real call.
  try {
    const args = call.function.arguments;
    if (typeof args === "string") JSON.parse(args || "{}");
    return true;
  } catch {
    return false;
  }

};

/**
 * One request. Returns the mode and the evidence for it, because "why is my
 * model in read-only" is the first question anyone will ask.
 */
export const probeToolCalling = async ({ baseUrl, apiKey, model, timeoutMs = 60000 }) => {

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;

  try {

    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: PROBE_MESSAGES,
        tools: [PROBE_TOOL],
        // Low but not zero. A model that only ever emits its single most likely
        // token can pass a probe it would fail at the temperature real work
        // runs at, which is a measurement of the wrong thing.
        temperature: 0.2
      })
    });

  } catch (error) {

    const denial = policyDenialWithin(error);

    if (denial) throw denial;

    throw localRuntimeUnreachable(baseUrl, error.message);

  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {

    const detail = (await response.text()).slice(0, 200);

    // A runtime that rejects the request outright -- some builds 400 on an
    // unexpected `tools` key -- has answered the question clearly enough.
    return {
      mode: MODES.READ_ONLY,
      evidence: `the runtime refused a request carrying tools (HTTP ${response.status} ${detail})`
    };

  }

  const message = (await response.json())?.choices?.[0]?.message ?? {};

  if (hasValidToolCall(message)) {
    return { mode: MODES.NATIVE, evidence: "returned a well-formed tool_calls entry" };
  }

  if (parsesAsToolCall(message.content)) {
    return {
      mode: MODES.CONSTRAINED,
      evidence: "emitted a well-formed call as text instead of in tool_calls"
    };
  }

  if (String(message.content || "").includes(PROBE_TOOL.function.name)) {
    return {
      mode: MODES.REACT,
      evidence: "named the tool in prose but produced no parseable call"
    };
  }

  return {
    mode: MODES.READ_ONLY,
    evidence: "ignored the tool entirely"
  };

};

const cachePath = (root) => path.join(cldxDir(root), "capability.json");

/**
 * Cached per (endpoint, model): the answer is a property of that pair and
 * nothing else, and the probe costs a model round trip that should not be paid
 * on every invocation.
 */
export const resolveCapability = async (root, context, { reprobe = false } = {}) => {

  const key = `${context.baseUrl}|${context.model}`;

  if (!reprobe) {

    const cached = await readJson(cachePath(root), {});

    if (cached[key]) return { ...cached[key], cached: true };

  }

  const result = await probeToolCalling(context);

  const cached = await readJson(cachePath(root), {});

  await writeJson(cachePath(root), { ...cached, [key]: result });

  return { ...result, cached: false };

};
