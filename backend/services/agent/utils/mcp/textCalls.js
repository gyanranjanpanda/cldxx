// Recovering a tool call from a model that cannot emit one.
//
// bindTools() reads `reply.tool_calls`, which is empty on most self-hosted
// models: they emit a perfectly formed call in `content` instead. Measured on
// Ollama serving qwen2.5-coder:7b, asked to call a trivial tool:
//
//   tool_calls: null
//   content:    '{"name": "ping", "arguments": {"message": "hello"}}'
//
// The loop then concludes the model wanted no tools and answers in prose, so
// MCP silently does nothing for every Sovereign Mode turn -- with nothing in
// the UI to say so. This file is the layer that reads the call out of the text.
//
// Ported from cli/src/textloop.js, where the same problem is solved for the
// coding CLI. Two implementations is two chances to diverge, but the CLI ships
// as its own dependency-free package and cannot import from the backend.

// Finds the first balanced {...} run. A model often wraps its call in a
// courtesy sentence ("Sure, I'll plot that: {...}"), and discarding the whole
// reply over a politeness costs a generation that was substantively right --
// expensive on local hardware, where a generation is seconds.
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

const CALL_KEYS = new Set([
  "tool", "name", "function", "tool_name",
  "arguments", "args", "parameters", "input"
]);

const ARGUMENT_KEYS = ["arguments", "args", "parameters", "input"];

const isCallShaped = (entry) => {

  if (ARGUMENT_KEYS.some((key) => key in entry)) return true;

  // An argument-less call is legitimate but rare, so it is accepted only when
  // the object contains nothing that is not part of a call.
  return Object.keys(entry).every((key) => CALL_KEYS.has(key));

};

const asText = (content) => {

  if (typeof content === "string") return content;

  // Some providers return content as an array of parts.
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.text || ""))
      .join("");
  }

  return "";

};

/**
 * @param {unknown} content  the model's reply text
 * @param {Array<{name: string}>} specs  the tools actually offered this turn
 * @returns {Array<{name: string, args: object, id: string}>}
 */
export const parseTextToolCalls = (content, specs = []) => {

  const candidate = firstJsonObject(stripFence(asText(content)));

  if (!candidate) return [];

  let parsed;

  try {
    parsed = JSON.parse(candidate);
  } catch {
    return [];
  }

  const entries = Array.isArray(parsed) ? parsed : [parsed];

  const calls = [];

  for (const entry of entries) {

    if (!entry || typeof entry !== "object") continue;

    const name =
      entry.tool ?? entry.name ?? entry.function?.name ?? entry.tool_name;

    if (typeof name !== "string") continue;

    // A name no offered tool answers to is not a call. Without this, any reply
    // that merely contains JSON -- a code sample, a config snippet, which is
    // most replies from a *coding* agent -- would be executed as a tool call.
    if (!specs.some((spec) => spec.name === name)) continue;

    // The name alone is not enough. A package.json whose "name" happens to
    // equal a live tool name would otherwise be executed, and a coding agent
    // emits package.json constantly. So the object must also *look* like a
    // call: either it carries arguments, or it carries nothing but call keys.
    if (!isCallShaped(entry)) continue;

    let args = entry.arguments ?? entry.args ?? entry.parameters ?? entry.input ?? {};

    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        args = {};
      }
    }

    calls.push({
      name,
      args: args && typeof args === "object" ? args : {},
      id: `text_${Date.now()}_${calls.length}`
    });

  }

  return calls;

};

// The contract added to the prompt when the model takes tools in the text
// rather than in the protocol. Only added for those models: telling a model
// that already has native tool calling to emit JSON instead gives it two
// conflicting channels and it will use the wrong one.
export const textToolContract = (specs) => [
  "",
  "TOOL USE",
  "",
  "If you need a tool, reply with ONLY this JSON object and nothing else:",
  '{"tool": "<name>", "arguments": {<arguments>}}',
  "",
  "Do not wrap it in explanation. Do not emit it alongside other output.",
  "To answer without a tool, reply normally and include no JSON object.",
  "",
  "Available tools:",
  ...specs.map((spec) => `- ${spec.name}: ${String(spec.description || "").slice(0, 160)}`),
  ""
].join("\n");
