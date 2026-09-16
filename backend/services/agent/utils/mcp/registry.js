import { internalApi } from "../internalApi.js";
import { openClient, listTools, callTool } from "./connect.js";

// Tool names are namespaced by server so two servers can both expose "search"
// without colliding. Models are strict about the character set, hence the slug.
const slug = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24) || "mcp";

export const qualifiedName = (serverName, toolName) =>
  `${slug(serverName)}__${slug(toolName)}`;

export const fetchServers = async (userId, { enabledOnly = true, id } = {}) => {

  if (!userId) return { servers: [], stdioAllowed: false };

  const params = new URLSearchParams();
  if (enabledOnly) params.set("enabled", "true");
  if (id) params.set("id", id);

  let data;

  try {

    ({ data } = await internalApi.get(
      `/mcp-servers/${userId}?${params.toString()}`
    ));

  } catch (error) {

    if (error.response?.status === 404) {

      const notFound = new Error(
        "The app service has no /internal/mcp-servers route -- it is running an older build. Restart it."
      );

      notFound.status = 503;

      throw notFound;

    }

    throw error;

  }

  return {
    servers: data?.servers || [],
    stdioAllowed: Boolean(data?.stdioAllowed)
  };

};

// Best effort: the chat must not fail because the status write did.
export const reportStatus = async (payload) => {

  try {

    await internalApi.post("/mcp-status", payload);

  } catch (error) {

    console.error("[mcp] status report failed:", error.message);

  }

};

/**
 * An MCP session that lives for exactly one chat turn. Connections are opened
 * lazily on first use and all closed together at the end, so a request that
 * never calls a tool pays nothing, and nothing is left dangling if it does.
 */
export class McpSession {

  constructor(servers, { stdioAllowed = false } = {}) {
    this.servers      = servers;
    this.stdioAllowed = stdioAllowed;
    this.clients      = new Map();   // serverId -> client
    this.toolIndex    = new Map();   // qualified name -> { server, tool }
  }

  usable(server) {

    if (server.transport === "stdio") return this.stdioAllowed;

    return Boolean(server.url);

  }

  async clientFor(server) {

    const key = String(server._id);

    if (!this.clients.has(key)) {
      this.clients.set(key, await openClient(server));
    }

    return this.clients.get(key);

  }

  /**
   * Connects to every enabled server and builds the combined tool list.
   * A server that fails to answer is reported and skipped -- one broken server
   * must not cost the user the tools on the others.
   */
  async discover() {

    const specs  = [];
    const errors = [];

    await Promise.all(this.servers.map(async (server) => {

      if (!this.usable(server)) {

        errors.push({
          server: server.name,
          error: server.transport === "stdio"
            ? "Local servers are disabled on this deployment"
            : "No URL configured"
        });

        return;

      }

      try {

        const client = await this.clientFor(server);
        const tools  = await listTools(client, server.name);

        tools.forEach((tool) => {

          const name = qualifiedName(server.name, tool.name);

          this.toolIndex.set(name, { server, tool });

          specs.push({
            type: "function",
            function: {
              name,
              // Every schema is resent on every round trip, so descriptions are
            // kept short: 14 filesystem tools at a full kilobyte each were
            // enough on their own to blow a provider's per-minute token limit.
            description:
                `[${server.name}] ${tool.description || tool.name}`.slice(0, 220),
              parameters: normaliseSchema(tool.inputSchema)
            }
          });

        });

      } catch (error) {

        errors.push({ server: server.name, error: error.message });

      }

    }));

    return { specs, errors };

  }

  async invoke(qualified, args) {

    const entry = this.toolIndex.get(qualified);

    if (!entry) {
      return { isError: true, text: `Unknown tool: ${qualified}` };
    }

    try {

      const client = await this.clientFor(entry.server);

      const result = await callTool(
        client,
        entry.tool.name,
        args,
        entry.server.name
      );

      return {
        isError: Boolean(result?.isError),
        text: flattenContent(result)
      };

    } catch (error) {

      // Handed back to the model as a tool result rather than thrown: it can
      // retry with different arguments or explain the failure to the user.
      return { isError: true, text: `Tool call failed: ${error.message}` };

    }

  }

  async close() {

    await Promise.all(
      [...this.clients.values()].map(async (client) => {
        try {
          await client.close();
        } catch {
          // A server that died mid-request has nothing to close cleanly.
        }
      })
    );

    this.clients.clear();

  }

}

// Providers reject a function with no parameter schema, and MCP servers are
// inconsistent about what they send, so missing pieces are filled in.
export const normaliseSchema = (schema) => {

  if (!schema || typeof schema !== "object") {
    return { type: "object", properties: {} };
  }

  return {
    ...schema,
    type: schema.type || "object",
    properties: schema.properties || {}
  };

};

// MCP returns content as typed blocks. The model only reads text, so image and
// resource blocks are described rather than dropped silently.
export const flattenContent = (result) => {

  const blocks = result?.content;

  if (!Array.isArray(blocks)) {
    return typeof result === "string" ? result : JSON.stringify(result ?? "");
  }

  const text = blocks
    .map((block) => {

      if (block?.type === "text")     return block.text;
      if (block?.type === "image")    return "[image returned by tool]";
      if (block?.type === "resource") return block.resource?.text
        || `[resource: ${block.resource?.uri || "unknown"}]`;

      return "";

    })
    .filter(Boolean)
    .join("\n")
    .trim();

  return text || "(tool returned no content)";

};
