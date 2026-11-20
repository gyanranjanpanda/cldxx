import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { assertUrlAllowed, assertHeadersSafe } from "./urlGuard.js";

const CLIENT_INFO = {
  name: "cldxAI",
  version: "1.0.0"
};

// A server that never answers would otherwise hold the whole chat request open.
export const CONNECT_TIMEOUT_MS = Number(process.env.MCP_CONNECT_TIMEOUT_MS) || 12_000;
// Python-based local servers can spend several seconds importing their MCP
// stack on a cold start. Keep remote connection checks fast, but give stdio
// processes a separate deadline so a slow first launch is not reported as an
// unreachable server.
export const STDIO_CONNECT_TIMEOUT_MS =
  Number(process.env.MCP_STDIO_CONNECT_TIMEOUT_MS) || 30_000;
export const CALL_TIMEOUT_MS    = Number(process.env.MCP_CALL_TIMEOUT_MS)    || 45_000;
// Rendering, video generation and other compute tools legitimately take
// longer than ordinary CRUD/search tools. A single global 45s deadline made
// Manim render calls fail even when the remote server was still working.
export const LONG_CALL_TIMEOUT_MS =
  Number(process.env.MCP_LONG_CALL_TIMEOUT_MS) || 180_000;

const pairsToObject = (pairs = []) =>
  pairs.reduce((out, pair) => {
    const key = String(pair?.key ?? "").trim();
    if (key) out[key] = pair.value ?? "";
    return out;
  }, {});

const withTimeout = (promise, ms, label) => {
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

// The args array is passed to the process directly -- no shell -- so argument
// injection is not possible. A command string carrying shell syntax is still a
// sign the user expected a shell, and would silently run as a literal filename;
// refusing is clearer than spawning something that cannot work.
const SHELL_METACHARACTERS = /[;&|`$(){}<>\n\r]/;

const assertCommandSafe = (command) => {

  if (!command || !String(command).trim()) {
    throw new Error("No command configured for this local server");
  }

  if (SHELL_METACHARACTERS.test(command)) {
    throw new Error(
      "Command contains shell syntax. Put the program in Command and each argument in Arguments."
    );
  }

  // An operator who wants a hard boundary can name exactly what may run.
  const allowlist = (process.env.MCP_STDIO_ALLOWED_COMMANDS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (allowlist.length) {

    const binary = command.split("/").pop();

    if (!allowlist.includes(command) && !allowlist.includes(binary)) {
      throw new Error(`Command not allowed on this deployment: ${binary}`);
    }

  }

};

const buildTransport = async (config, transportType = config.transport) => {

  if (config.transport === "stdio") {

    assertCommandSafe(config.command);

    // Inheriting the agent's whole environment would hand a user-named binary
    // every key the service holds. Only PATH plus what was configured, along
    // with unbuffered standard I/O so Python processes don't stall JSON-RPC pipes.
    return new StdioClientTransport({
      command: config.command,
      args:    config.args || [],
      env: {
        PATH: process.env.PATH,
        PYTHONUNBUFFERED: "1",
        ...pairsToObject(config.env)
      },
      stderr: "pipe"
    });

  }

  // Checked here, at connect time, because a name that resolved publicly when
  // the server was saved can point somewhere private by now.
  await assertUrlAllowed(config.url);
  assertHeadersSafe(config.headers);

  const url     = new URL(config.url);
  const headers = pairsToObject(config.headers);

  // The SDK passes requestInit through to fetch; custom headers are how bearer
  // tokens reach a remote server.
  const options = Object.keys(headers).length
    ? { requestInit: { headers } }
    : {};

  return transportType === "sse"
    ? new SSEClientTransport(url, options)
    : new StreamableHTTPClientTransport(url, options);

};

/**
 * Opens a connection and returns the live client. The caller owns it and must
 * call `close()` -- see registry.js, which pools these per request.
 */
export const openClient = async (config) => {

  // Prefer Streamable HTTP, but retry the legacy SSE handshake. Many hosted
  // MCP servers advertise one URL while still implementing the older SSE
  // transport, and treating that normal compatibility case as unreachable
  // leaves the chat with no tools.
  const transportTypes = config.transport === "http"
    ? ["http", "sse"]
    : [config.transport];
  let lastError;

  for (const transportType of transportTypes) {

    const client = new Client(CLIENT_INFO, {
      capabilities: {}
    });
    const transport = await buildTransport(config, transportType);

    try {

      await withTimeout(
        client.connect(transport),
        transportType === "stdio" ? STDIO_CONNECT_TIMEOUT_MS : CONNECT_TIMEOUT_MS,
        `Connecting to ${config.name}`
      );

      return client;

    } catch (error) {

      lastError = error;

      try {
        await transport.close();
      } catch {
        // The transport may not have finished initializing.
      }

    }

  }

  throw lastError || new Error(`Could not connect to ${config.name}`);

};

export const listTools = async (client, serverName) => {

  const result = await withTimeout(
    client.listTools(),
    CONNECT_TIMEOUT_MS,
    `Listing tools on ${serverName}`
  );

  return result?.tools || [];

};

export const callTool = async (
  client,
  name,
  args,
  serverName,
  timeoutMs = CALL_TIMEOUT_MS
) =>
  withTimeout(
    client.callTool({ name, arguments: args || {} }),
    timeoutMs,
    `${serverName}.${name}`
  );
