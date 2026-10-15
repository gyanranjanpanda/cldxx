import crypto from "node:crypto";
import axios from "axios";
import redis from "../../../../shared/redis/redis.js";
import McpServer from "../models/mcpServer.model.js";
import { getProvider, listProviders } from "../providers.js";
import {
  encryptPairs,
  decryptPairs,
  maskPairs
} from "../utils/secretBox.js";
import {
  privateUrlsAllowed,
  isObviouslyPrivate
} from "../utils/urlPolicy.js";

// Spawning a process from user-supplied input is remote code execution on the
// agent host by design -- that is what a "local" MCP server is. It is fine for
// a single-operator install and not fine for a shared deployment, so it is off
// in production unless the operator explicitly opts in.
export const stdioAllowed = () =>
  process.env.MCP_ALLOW_STDIO === "true" ||
  (process.env.NODE_ENV !== "production" &&
   process.env.MCP_ALLOW_STDIO !== "false");

const MAX_SERVERS_PER_USER = 20;
const OAUTH_STATE_TTL_SECONDS = 600;

const frontendUrl = () => process.env.FRONTEND_URL || "http://localhost:5173";

const providerRedirectUrl = (provider) => {
  const configured = process.env[`${provider.id.toUpperCase()}_REDIRECT_URI`]
    || (provider.id === "slack" ? process.env.SLACK_REDIRECT_URI : "");

  if (configured) return configured;

  const base = process.env.PUBLIC_URL || process.env.APP_URL;

  if (!base) {
    throw new Error(
      `Set ${provider.id.toUpperCase()}_REDIRECT_URI to the public callback URL`
    );
  }

  return `${base.replace(/\/$/, "")}/api/mcp/oauth/${provider.id}/callback`;
};

const oauthStateKey = (provider, state) => `mcp-oauth:${provider.id}:${state}`;

const oauthToken = (data, provider) => {
  const value = (provider.tokenField || "access_token")
    .split(".")
    .reduce((current, key) => current?.[key], data);

  return value || data?.authed_user?.access_token || data?.access_token;
};

const oauthRedirect = (res, status, message = "") => {
  const params = new URLSearchParams({ mcp: status });
  if (message) params.set("message", message);
  return res.redirect(`${frontendUrl().replace(/\/$/, "")}/?${params}`);
};

export const listMcpProviders = (_req, res) =>
  res.json({ success: true, providers: listProviders() });

// The browser gets names and state; secret values stay on the server.
const toClient = (doc) => ({
  _id:       doc._id,
  name:      doc.name,
  provider:  doc.provider || "custom",
  authType:  doc.authType || "header",
  transport: doc.transport,
  url:       doc.url,
  command:   doc.command,
  args:      doc.args,
  headers:   maskPairs(doc.headers),
  env:       maskPairs(doc.env),
  enabled:   doc.enabled,
  status:    doc.status,
  tools:     doc.tools,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt
});

const badRequest = (res, message) =>
  res.status(400).json({ success: false, message });

// A remote server must be reachable over http(s). Anything else -- file:,
// javascript:, a bare hostname -- is rejected before it reaches a transport.
const validateUrl = (url) => {

  let parsed;

  try {
    parsed = new URL(url);
  } catch {
    return "Enter a full URL, for example https://mcp.example.com/mcp";
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return "Only http and https URLs are supported";
  }

  // Pointing a "remote" server at an internal address turns the agent into a
  // request forgery proxy -- cloud metadata, admin ports, anything it can
  // reach. Allowed on a single-operator box, refused on a shared deployment.
  if (!privateUrlsAllowed() && isObviouslyPrivate(parsed.hostname)) {
    return "That address is on a private network, which is blocked on this deployment";
  }

  return null;
};

// CR/LF in a header value smuggles extra headers into the outgoing request.
const validateSecrets = (pairs, label) => {

  for (const pair of pairs || []) {

    // Trimmed before the test because encryptPairs and mergeSecrets already
    // store the trimmed key. A pasted "Authorization " was refused here for a
    // space that would never have been saved -- and the message echoed the
    // padded name, so it read as "Invalid header name: Authorization".
    const key = String(pair?.key ?? "").trim();

    if (key && !/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(key)) {
      return `Invalid ${label} name: ${key}`;
    }

    if (/[\r\n\0]/.test(String(pair?.value ?? ""))) {
      return `Invalid value for ${label} ${key}`;
    }

  }

  return null;

};

// Incoming secrets arrive as [{key, value}]. A pair with no value is the client
// saying "keep whatever is stored", which is how an edit form can show a header
// exists without ever having received its value.
const mergeSecrets = (incoming, existing = []) => {

  const previous = new Map(existing.map((pair) => [pair.key, pair.value]));

  return (incoming || [])
    .filter((pair) => pair?.key)
    .map((pair) => ({
      key: String(pair.key).trim(),
      value: pair.value
        ? pair.value
        : previous.get(String(pair.key).trim()) || ""
    }));
};

// Mongoose builds the unique index in the background, so on a fresh database
// the first few writes can land before it exists -- a duplicate name got in
// that way. The index still guards against races; this is what makes the
// common case deterministic.
const nameTaken = async (userId, name, excludeId) => {

  const clash = await McpServer.findOne({
    userId,
    name: String(name).trim()
  });

  return Boolean(clash) && String(clash._id) !== String(excludeId || "");

};

const validate = (body) => {

  const name = String(body.name || "").trim();

  if (!name) return "Give the server a name";
  if (name.length > 60) return "Name is too long";

  const transport = body.transport || "http";

  if (!["http", "sse", "stdio"].includes(transport)) {
    return "Unknown transport";
  }

  const badEnv = validateSecrets(body.env, "environment variable");
  if (badEnv) return badEnv;

  const badHeader = validateSecrets(body.headers, "header");
  if (badHeader) return badHeader;

  if (transport === "stdio") {

    if (!stdioAllowed()) {
      return "Local (stdio) servers are disabled on this deployment";
    }

    const command = String(body.command || "").trim();

    if (!command) {
      return "Give the command that starts the server";
    }

    // Args are passed to the process directly, never through a shell, so shell
    // syntax here would run as a literal filename and fail confusingly.
    if (/[;&|`$(){}<>\n\r]/.test(command)) {
      return "Command contains shell syntax. Put the program in Command and each argument in Arguments.";
    }

    return null;
  }

  return validateUrl(String(body.url || "").trim());
};

export const listServers = async (req, res) => {

  try {

    const userId = req.headers["x-user-id"];

    const servers = await McpServer
      .find({ userId })
      .sort({ createdAt: 1 });

    res.json({
      success: true,
      servers: servers.map(toClient),
      // The UI hides the local option entirely rather than offering a choice
      // that will be refused on save.
      stdioAllowed: stdioAllowed(),
      privateUrlsAllowed: privateUrlsAllowed()
    });

  } catch (error) {

    res.status(500).json({ success: false, message: error.message });

  }

};

export const startMcpOAuth = async (req, res) => {

  try {

    const provider = getProvider(req.params.provider);

    if (!provider) {
      return res.status(404).json({ success: false, message: "Unknown MCP provider" });
    }

    const clientId = process.env[`${provider.id.toUpperCase()}_CLIENT_ID`];
    const clientSecret = process.env[`${provider.id.toUpperCase()}_CLIENT_SECRET`];

    if (!clientId || !clientSecret) {
      return res.status(503).json({
        success: false,
        message: `${provider.name} OAuth is not configured. Set ${provider.id.toUpperCase()}_CLIENT_ID and ${provider.id.toUpperCase()}_CLIENT_SECRET.`
      });
    }

    const userId = String(req.headers["x-user-id"] || "");

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const state = crypto.randomBytes(32).toString("hex");

    await redis.set(
      oauthStateKey(provider, state),
      JSON.stringify({ userId }),
      "EX",
      OAUTH_STATE_TTL_SECONDS
    );

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: providerRedirectUrl(provider),
      state,
      scope: process.env[`${provider.id.toUpperCase()}_OAUTH_SCOPES`]
        || provider.scopes.join(provider.scopeSeparator || ",")
    });

    return res.json({
      success: true,
      url: `${provider.authorizeUrl}?${params}`
    });

  } catch (error) {

    return res.status(500).json({ success: false, message: error.message });

  }

};

export const mcpOAuthCallback = async (req, res) => {

  try {

    const { code, state, error } = req.query;
    const provider = getProvider(req.params.provider);

    if (!provider) return oauthRedirect(res, "error", "Unknown MCP provider");

    if (error) return oauthRedirect(res, "error", `${provider.name} authorization was cancelled`);

    if (!code || !state) {
      return oauthRedirect(res, "error", `${provider.name} returned an invalid OAuth response`);
    }

    const stored = await redis.get(oauthStateKey(provider, state));
    await redis.del(oauthStateKey(provider, state));

    if (!stored) {
      return oauthRedirect(res, "error", `${provider.name} OAuth session expired. Please try again`);
    }

    const { userId } = JSON.parse(stored);
    const body = new URLSearchParams({
      client_id: process.env[`${provider.id.toUpperCase()}_CLIENT_ID`],
      client_secret: process.env[`${provider.id.toUpperCase()}_CLIENT_SECRET`],
      code,
      redirect_uri: providerRedirectUrl(provider)
    });

    const { data } = await axios.post(
      provider.tokenUrl,
      body.toString(),
      { headers: { "content-type": "application/x-www-form-urlencoded" } }
    );

    if (data?.ok === false) {
      return oauthRedirect(res, "error", `${provider.name} token exchange failed`);
    }

    const accessToken = oauthToken(data, provider);

    if (!accessToken) {
      return oauthRedirect(res, "error", `${provider.name} did not return a user access token`);
    }

    const headers = encryptPairs([
      { key: "Authorization", value: `Bearer ${accessToken}` }
    ]);

    const existing = await McpServer.findOne({ userId, name: provider.name });

    if (existing) {
      existing.transport = "http";
      existing.provider = provider.id;
      existing.authType = "oauth";
      existing.url = provider.mcpUrl;
      existing.headers = headers;
      existing.enabled = true;
      existing.status = { state: "unknown", toolCount: 0 };
      existing.tools = [];
      await existing.save();
    } else {
      const count = await McpServer.countDocuments({ userId });

      if (count >= MAX_SERVERS_PER_USER) {
        return oauthRedirect(res, "error", "Your MCP server limit has been reached");
      }

      await McpServer.create({
        userId,
        name: provider.name,
        provider: provider.id,
        authType: "oauth",
        transport: "http",
        url: provider.mcpUrl,
        headers,
        enabled: true
      });
    }

    return oauthRedirect(res, "connected");

  } catch (error) {

    console.error(`[mcp] ${req.params.provider} OAuth callback failed:`, error.message);
    return oauthRedirect(res, "error", `${req.params.provider} connection failed. Check the server logs`);

  }

};

// Backward-compatible names for callers from the first Slack-only release.
export const startSlackOAuth = startMcpOAuth;
export const slackOAuthCallback = mcpOAuthCallback;

export const createServer = async (req, res) => {

  try {

    const userId = req.headers["x-user-id"];
    const invalid = validate(req.body);

    if (invalid) return badRequest(res, invalid);

    const count = await McpServer.countDocuments({ userId });

    if (count >= MAX_SERVERS_PER_USER) {
      return badRequest(res, `You can configure up to ${MAX_SERVERS_PER_USER} servers`);
    }

    if (await nameTaken(userId, req.body.name)) {
      return badRequest(res, "You already have a server with that name");
    }

    const server = await McpServer.create({
      userId,
      name:      String(req.body.name).trim(),
      transport: req.body.transport || "http",
      url:       String(req.body.url || "").trim(),
      command:   String(req.body.command || "").trim(),
      args:      Array.isArray(req.body.args) ? req.body.args.filter(Boolean) : [],
      headers:   encryptPairs(req.body.headers),
      env:       encryptPairs(req.body.env),
      enabled:   req.body.enabled !== false
    });

    res.json({ success: true, server: toClient(server) });

  } catch (error) {

    if (error.code === 11000) {
      return badRequest(res, "You already have a server with that name");
    }

    res.status(500).json({ success: false, message: error.message });

  }

};

export const updateServer = async (req, res) => {

  try {

    const userId = req.headers["x-user-id"];

    const existing = await McpServer.findOne({ _id: req.params.id, userId });

    if (!existing) {
      return res.status(404).json({ success: false, message: "Server not found" });
    }

    const invalid = validate({ ...existing.toObject(), ...req.body });

    if (invalid) return badRequest(res, invalid);

    if (req.body.name && await nameTaken(userId, req.body.name, existing._id)) {
      return badRequest(res, "You already have a server with that name");
    }

    existing.name      = String(req.body.name ?? existing.name).trim();
    existing.transport = req.body.transport ?? existing.transport;
    existing.url       = String(req.body.url ?? existing.url).trim();
    existing.command   = String(req.body.command ?? existing.command).trim();
    existing.args      = Array.isArray(req.body.args) ? req.body.args.filter(Boolean) : existing.args;
    existing.enabled   = req.body.enabled ?? existing.enabled;

    if (req.body.headers) {
      existing.headers = encryptPairs(mergeSecrets(req.body.headers, existing.headers));
    }

    if (req.body.env) {
      existing.env = encryptPairs(mergeSecrets(req.body.env, existing.env));
    }

    // Connection details changed, so the cached tool list and health are stale.
    existing.status = { state: "unknown", toolCount: 0 };
    existing.tools  = [];

    await existing.save();

    res.json({ success: true, server: toClient(existing) });

  } catch (error) {

    if (error.code === 11000) {
      return badRequest(res, "You already have a server with that name");
    }

    res.status(500).json({ success: false, message: error.message });

  }

};

export const toggleServer = async (req, res) => {

  try {

    const userId = req.headers["x-user-id"];

    const server = await McpServer.findOneAndUpdate(
      { _id: req.params.id, userId },
      { enabled: Boolean(req.body.enabled) },
      { new: true }
    );

    if (!server) {
      return res.status(404).json({ success: false, message: "Server not found" });
    }

    res.json({ success: true, server: toClient(server) });

  } catch (error) {

    res.status(500).json({ success: false, message: error.message });

  }

};

export const deleteServer = async (req, res) => {

  try {

    const userId = req.headers["x-user-id"];

    const server = await McpServer.findOneAndDelete({ _id: req.params.id, userId });

    if (!server) {
      return res.status(404).json({ success: false, message: "Server not found" });
    }

    res.json({ success: true, _id: req.params.id });

  } catch (error) {

    res.status(500).json({ success: false, message: error.message });

  }

};

/* ── Internal surface: only the agent process calls these ────────────────── */

// Returns decrypted credentials, which is exactly why it lives behind the
// internal key and never behind a session.
export const getServersForAgent = async (req, res) => {

  try {

    const { userId } = req.params;

    const query = { userId };

    if (req.query.enabled === "true") query.enabled = true;
    if (req.query.id) query._id = req.query.id;

    const servers = await McpServer.find(query).sort({ createdAt: 1 });

    res.json({
      success: true,
      stdioAllowed: stdioAllowed(),
      servers: servers.map((doc) => ({
        _id:       doc._id,
        name:      doc.name,
        provider:  doc.provider || "custom",
        authType:  doc.authType || "header",
        transport: doc.transport,
        url:       doc.url,
        command:   doc.command,
        args:      doc.args,
        headers:   decryptPairs(doc.headers),
        env:       decryptPairs(doc.env),
        enabled:   doc.enabled,
        // Cached from the last health check. The router matches the prompt
        // against these, and describes them to the classifier, so neither has
        // to open a connection to find out what a server can do.
        tools:     (doc.tools || []).map((tool) => ({
          name:        tool.name,
          description: tool.description || ""
        }))
      }))
    });

  } catch (error) {

    res.status(500).json({ success: false, message: error.message });

  }

};

// The agent reports back after a health check or a tool listing so the next
// page load can render state without reconnecting.
export const saveServerStatus = async (req, res) => {

  try {

    const { serverId, userId, state, error, tools } = req.body;

    const list = Array.isArray(tools) ? tools : [];

    const server = await McpServer.findOneAndUpdate(
      { _id: serverId, userId },
      {
        status: {
          state:     state === "ok" ? "ok" : "error",
          checkedAt: new Date(),
          error:     error || "",
          toolCount: list.length
        },
        tools: list.map((tool) => ({
          name:        tool.name,
          description: tool.description || ""
        }))
      },
      { new: true }
    );

    if (!server) {
      return res.status(404).json({ success: false, message: "Server not found" });
    }

    res.json({ success: true, server: toClient(server) });

  } catch (error) {

    res.status(500).json({ success: false, message: error.message });

  }

};
