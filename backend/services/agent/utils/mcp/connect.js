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
export const CALL_TIMEOUT_MS    = Number(process.env.MCP_CALL_TIMEOUT_MS)    || 45_000;

const pairsToObject = (pairs = []) =>
  pairs.reduce((out, pair) => {
    if (pair?.key) out[pair.key] = pair.value ?? "";
    return out;
  }, {});

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    )
  ]);

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

const buildTransport = async (config) => {

  if (config.transport === "stdio") {

    assertCommandSafe(config.command);

    // Inheriting the agent's whole environment would hand a user-named binary
    // every key the service holds. Only PATH plus what was configured.
    return new StdioClientTransport({
      command: config.command,
      args:    config.args || [],
      env: {
        PATH: process.env.PATH,
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

  return config.transport === "sse"
    ? new SSEClientTransport(url, options)
    : new StreamableHTTPClientTransport(url, options);

};

/**
 * Opens a connection and returns the live client. The caller owns it and must
 * call `close()` -- see registry.js, which pools these per request.
 */
export const openClient = async (config) => {

  const client = new Client(CLIENT_INFO, {
    capabilities: {}
  });

  const transport = await buildTransport(config);

  await withTimeout(
    client.connect(transport),
    CONNECT_TIMEOUT_MS,
    `Connecting to ${config.name}`
  );

  return client;

};

export const listTools = async (client, serverName) => {

  const result = await withTimeout(
    client.listTools(),
    CONNECT_TIMEOUT_MS,
    `Listing tools on ${serverName}`
  );

  return result?.tools || [];

};

export const callTool = async (client, name, args, serverName) =>
  withTimeout(
    client.callTool({ name, arguments: args || {} }),
    CALL_TIMEOUT_MS,
    `${serverName}.${name}`
  );
