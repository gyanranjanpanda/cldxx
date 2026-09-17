import redis from "../../../../shared/redis/redis.js";
import { fetchServers } from "./registry.js";

// The router is an LLM classifier that knows nothing about MCP, so "use the
// manim mcp server to create X" looked like a coding request and was answered
// with a generated project instead of a tool call. Naming a server or one of
// its tools is an explicit instruction, so it is matched here -- before the
// classifier -- rather than hoping a prompt tweak wins the argument.

// One internal call per message would be wasteful when the answer changes only
// when the user edits their servers.
const CACHE_TTL = 60;

const cacheKey = (userId) => `mcp-vocab:v2:${userId}`;

// Server names are matched word by word, because people type "the manim
// server" rather than the exact label.
const tokenise = (value) =>
  String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);

// Words too common to mean "use my server". Without this, a server called
// "Local Tools" would capture most of what anyone types.
const TOO_GENERIC = new Set([
  "mcp", "server", "servers", "tool", "tools", "api", "app", "test", "demo",
  "local", "remote", "code", "run", "get", "set", "new", "the", "and", "for",
  "with", "this", "that", "file", "files", "data", "main", "util", "utils"
]);

/**
 * Tool names are matched whole, never token by token: splitting
 * "execute_manim_code" would leave "execute", which appears in plenty of
 * ordinary coding requests and would drag them away from the coding agent.
 */
export const buildVocabulary = (servers = []) => {

  const words   = new Set();
  const phrases = new Set();

  servers.forEach((server) => {

    tokenise(server.name).forEach((word) => {
      if (!TOO_GENERIC.has(word)) words.add(word);
    });

    (server.tools || []).forEach((tool) => {

      const name = String(tool?.name ?? tool).toLowerCase();

      phrases.add(name);
      // "execute manim code" reads the same to a person as the snake_case form.
      phrases.add(name.replace(/[_-]+/g, " "));

    });

  });

  return { words: [...words], phrases: [...phrases] };

};

const loadVocabulary = async (userId) => {

  const cached = await redis.get(cacheKey(userId));

  if (cached) return JSON.parse(cached);

  const { servers } = await fetchServers(userId);
  const vocabulary  = buildVocabulary(servers);

  await redis.set(cacheKey(userId), JSON.stringify(vocabulary), "EX", CACHE_TTL);

  return vocabulary;

};

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const forgetVocabulary = (userId) => redis.del(cacheKey(userId));

/**
 * The servers a prompt actually names, or all of them when it names none.
 *
 * Every bound tool's schema is prompt text the provider bills and counts
 * against the per-minute token budget: 45 GitHub tools serialize to ~9k tokens
 * on their own, which a free tier refuses outright ("Request too large ...
 * Limit 8000, Requested 9125") before any conversation is added. "Use the
 * manim server" is an explicit choice of one server, so honour it and leave
 * the other 45 tools out of the request rather than paying for them unused.
 *
 * Falls back to every server when nothing is named -- the model still needs to
 * see what it can reach when the user does not say.
 */
export const selectServers = (prompt, servers = []) => {

  const text = String(prompt || "").toLowerCase();

  if (!text || servers.length < 2) return servers;

  const named = servers.filter((server) => {

    const words = tokenise(server.name).filter((word) => !TOO_GENERIC.has(word));

    if (words.some((word) => new RegExp(`\\b${escape(word)}\\b`).test(text))) {
      return true;
    }

    // Tool names are matched whole for the same reason buildVocabulary does
    // it: the fragments of "execute_manim_code" appear in ordinary requests.
    return (server.tools || []).some((tool) => {

      const name = String(tool?.name ?? tool).toLowerCase();
      // Stored names are namespaced ("manim__execute_manim_code"); a person
      // types the bare tool name, not the qualified one.
      const bare = name.includes("__") ? name.slice(name.indexOf("__") + 2) : name;

      return [name, bare].some((form) =>
        text.includes(form) || text.includes(form.replace(/[_-]+/g, " "))
      );

    });

  });

  return named.length ? named : servers;

};

/**
 * What the user's tools can do, in one short block. The router shows this to
 * the classifier so a request that a tool can serve lands on the chat agent --
 * the only place tools are bound -- even when the user never names the server.
 */
export const describeTools = async (userId) => {

  if (!userId) return "";

  try {

    const { servers } = await fetchServers(userId);

    const lines = servers.flatMap((server) =>
      (server.tools || []).map((tool) => {
        const name = tool?.name ?? tool;
        const what = tool?.description || "";
        return `- ${name}${what ? `: ${what}` : ""}`;
      })
    );

    return lines.join("\n");

  } catch (error) {

    console.error("[mcp] tool description lookup failed:", error.message);

    return "";

  }

};

/**
 * True when the prompt names one of the user's MCP servers or its tools, or
 * asks for MCP explicitly. Used to pin routing to the chat agent, which is
 * where tools are bound.
 */
export const wantsMcpTools = async (userId, prompt) => {

  if (!userId || !prompt) return false;

  try {

    const { words, phrases } = await loadVocabulary(userId);

    if (!words.length && !phrases.length) return false;

    const text = String(prompt).toLowerCase();

    // "use the mcp server" is explicit even without a name, but only counts
    // for someone who actually has one configured.
    if (/\bmcp\b/.test(text)) return true;

    if (phrases.some((phrase) => text.includes(phrase))) return true;

    return words.some((word) =>
      new RegExp(`\\b${escape(word)}\\b`).test(text)
    );

  } catch (error) {

    // Routing must never fail because the MCP lookup did.
    console.error("[mcp] intent check failed:", error.message);

    return false;

  }

};
