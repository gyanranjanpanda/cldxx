import { AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { McpSession, fetchServers } from "./registry.js";

// Each round trip is a full model call, so this caps cost and stops a server
// that keeps asking to be called again from looping forever.
const MAX_ROUNDS = Number(process.env.MCP_MAX_TOOL_ROUNDS) || 5;

// Big tool outputs (a file listing, a scrape) blow the context window and push
// the real conversation out of it.
const MAX_RESULT_CHARS = Number(process.env.MCP_MAX_RESULT_CHARS) || 8000;

// Binding tools is not the same as using them. The chat prompt tells the model
// to answer in Markdown and never to mention internal tools, which read as
// "write something" -- so asked to render an animation it wrote a Manim script
// instead of calling the Manim tool sitting right there. This says the tools
// are the user's own, and that running one beats describing it.
const toolPolicy = (specs) => new SystemMessage(`
You have these tools, connected by the user themselves:

${specs.map((spec) => `- ${spec.function.name}`).join("\n")}

How to use them:

- If a tool can carry out the request, CALL IT. Do not write code, instructions
  or a description of what the tool would do instead -- actually run it.
- Asking a tool to do something and showing the user source code are different
  answers. They asked for the thing done.
- These are the user's own tools, not internal machinery: you may name the tool
  you used and report exactly what it returned.
- Report the real result. If a tool fails, say so and say why -- never invent an
  output, a file path or a URL the tool did not give you.
- If no tool fits, answer normally without mentioning them.
`);

const truncate = (text) =>
  text.length > MAX_RESULT_CHARS
    ? `${text.slice(0, MAX_RESULT_CHARS)}\n\n[truncated — ${text.length - MAX_RESULT_CHARS} more characters]`
    : text;

// Rate limits, outages and auth rejections come from the model provider, not
// from any MCP server, and retrying the same call without tools will usually
// fail the same way -- or worse, succeed with an answer that contradicts the
// tools the user has connected.
const isProviderFailure = (error) => {

  const status = error?.status ?? error?.response?.status;

  if (status === 429 || (status >= 500 && status < 600)) return true;

  return /rate.?limit|quota|overloaded|timeout|unauthorized|api key/i
    .test(error?.message || "");

};

// Providers say how long to wait ("Please try again in 20.175s"), and a free
// tier plus a dozen tool schemas reaches that limit easily. Waiting once is a
// far better answer than handing the user a raw 429.
const MAX_RETRY_WAIT_MS = Number(process.env.MCP_MAX_RETRY_WAIT_MS) || 25_000;

const retryDelayMs = (error) => {

  const header = error?.response?.headers?.["retry-after"];

  if (header && !Number.isNaN(Number(header))) {
    return Math.ceil(Number(header) * 1000);
  }

  const stated = String(error?.message || "").match(/try again in ([\d.]+)\s*s/i);

  return stated ? Math.ceil(Number(stated[1]) * 1000) + 500 : 0;

};

const rateLimited = (error) =>
  (error?.status ?? error?.response?.status) === 429 ||
  /rate.?limit/i.test(error?.message || "");

const friendlyProviderError = (error) => {

  const seconds = Math.ceil(retryDelayMs(error) / 1000);

  const wrapped = new Error(
    rateLimited(error)
      ? `The model is rate limited right now${seconds ? `. Try again in about ${seconds}s` : ""}.`
      : "The model provider is unavailable right now. Please try again."
  );

  wrapped.status = error?.status ?? error?.response?.status ?? 503;

  wrapped.data = {
    success: false,
    title: rateLimited(error) ? "Rate limited" : "Model unavailable",
    message: wrapped.message
  };

  return wrapped;

};

// One retry, and only for a limit the provider says will clear on its own.
const invokeWithRetry = async (model, thread) => {

  try {

    return await model.invoke(thread);

  } catch (error) {

    const wait = rateLimited(error) ? retryDelayMs(error) : 0;

    if (!wait || wait > MAX_RETRY_WAIT_MS) throw error;

    console.warn(`[mcp] rate limited, retrying in ${Math.round(wait / 1000)}s`);

    await new Promise((resolve) => setTimeout(resolve, wait));

    return model.invoke(thread);

  }

};

/**
 * Runs the model with the user's MCP tools bound, executing whatever it asks
 * for until it answers in plain text.
 *
 * Falls back to a plain `llm.invoke` whenever the user has no usable tools, so
 * the common case costs one extra internal HTTP call and nothing else.
 *
 * @returns {{ response: string, toolCalls: Array, mcpErrors: Array }}
 */
export const runWithMcpTools = async ({ llm, messages, userId }) => {

  let session = null;

  try {

    const { servers, stdioAllowed } = await fetchServers(userId);

    if (!servers.length) {
      const reply = await llm.invoke(messages);
      return { response: reply.content, toolCalls: [], mcpErrors: [] };
    }

    session = new McpSession(servers, { stdioAllowed });

    const { specs, errors } = await session.discover();

    if (!specs.length) {
      const reply = await llm.invoke(messages);
      return { response: reply.content, toolCalls: [], mcpErrors: errors };
    }

    const llmWithTools = llm.bindTools(specs);

    // Placed after the agent's own system prompt so it reads as an addition to
    // it, not a competing first instruction.
    const thread = [messages[0], toolPolicy(specs), ...messages.slice(1)]
      .filter(Boolean);

    const executed = [];

    for (let round = 0; round < MAX_ROUNDS; round++) {

      const reply = await invokeWithRetry(llmWithTools, thread);
      const calls = reply.tool_calls || [];

      if (!calls.length) {
        return { response: reply.content, toolCalls: executed, mcpErrors: errors };
      }

      thread.push(reply);

      // Sequential on purpose: MCP servers are often a single local process,
      // and a parallel burst is the fastest way to trip their rate limits.
      for (const call of calls) {

        const result = await session.invoke(call.name, call.args);
        const text   = truncate(result.text);

        executed.push({
          name:    call.name,
          args:    call.args,
          isError: result.isError
        });

        thread.push(new ToolMessage({
          tool_call_id: call.id,
          name:         call.name,
          content:      text
        }));

      }

    }

    // Out of rounds. Ask for an answer from what was gathered rather than
    // returning the model's last tool request as if it were a reply.
    thread.push(new AIMessage(
      "I have gathered enough from the tools. Answering now from what I have."
    ));

    const final = await invokeWithRetry(llmWithTools, thread);

    return {
      response: final.content,
      toolCalls: executed,
      mcpErrors: errors
    };

  } catch (error) {

    // A provider failure is not an MCP failure. Answering anyway produces a
    // confident "I cannot see your files" from a model that had a file tool
    // bound a moment ago -- worse than an error, because the user believes it.
    if (isProviderFailure(error)) throw friendlyProviderError(error);

    // MCP itself is an enhancement, so anything else still gets an answer.
    console.error("[mcp] tool loop failed:", error.message);

    const reply = await llm.invoke(messages);

    return {
      response: reply.content,
      toolCalls: [],
      mcpErrors: [{ server: "mcp", error: error.message }]
    };

  } finally {

    await session?.close();

  }

};
