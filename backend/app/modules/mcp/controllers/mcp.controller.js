import McpServer from "../models/mcpServer.model.js";
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

// The browser gets names and state; secret values stay on the server.
const toClient = (doc) => ({
  _id:       doc._id,
  name:      doc.name,
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

    if (pair?.key && !/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(pair.key)) {
      return `Invalid ${label} name: ${pair.key}`;
    }

    if (/[\r\n\0]/.test(String(pair?.value ?? ""))) {
      return `Invalid value for ${label} ${pair.key}`;
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
