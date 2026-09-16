import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { McpSession, fetchServers } from "./registry.js";

// Each round trip is a full model call, so this caps cost and stops a server
// that keeps asking to be called again from looping forever.
const MAX_ROUNDS = Number(process.env.MCP_MAX_TOOL_ROUNDS) || 5;

// Big tool outputs (a file listing, a scrape) blow the context window and push
// the real conversation out of it.
const MAX_RESULT_CHARS = Number(process.env.MCP_MAX_RESULT_CHARS) || 8000;

const truncate = (text) =>
  text.length > MAX_RESULT_CHARS
    ? `${text.slice(0, MAX_RESULT_CHARS)}\n\n[truncated — ${text.length - MAX_RESULT_CHARS} more characters]`
    : text;

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
    const thread       = [...messages];
    const executed     = [];

    for (let round = 0; round < MAX_ROUNDS; round++) {

      const reply = await llmWithTools.invoke(thread);
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

    const final = await llmWithTools.invoke(thread);

    return {
      response: final.content,
      toolCalls: executed,
      mcpErrors: errors
    };

  } catch (error) {

    // MCP is an enhancement. If the whole layer fails, the user still gets a
    // normal answer rather than an error page.
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
