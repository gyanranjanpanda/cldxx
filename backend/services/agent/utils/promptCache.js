import { createHash } from "crypto";
import redis from "../../../shared/redis/redis.js";

// Prompt cache is disabled for generation agents until a context-aware,
// user-scoped key can be used.
//
// Reusing a prompt-only result can expose another user's generated project or
// return stale code when a follow-up depends on the previous project files.
// PDF/PPT links are user-owned and may expire, so those are not cached either.
//
// Fix: SHA-256 hash of (normalised prompt + agent + sovereign) → Redis key.
// Cache hit = 0 credits, 0 LLM call, <5ms response.
// Cache miss = run the agent, write result, return.
//
// Why sovereign in the key?
//   Cloud model (DeepSeek) and local model (llama3.1) generate different code.
//   Same prompt, different tier → different cache entry.
//
// TTL = 7 days. Generated code does not go stale like a weather page.

const CACHE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

const CACHEABLE_AGENTS = new Set();

// Normalise so "Create Snake Game", "create snake game  " and
// "CREATE SNAKE GAME" all hit the same key.
const normalise = (text) =>
  String(text ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const buildKey = (agent, prompt, sovereign) => {
  const digest = createHash("sha256")
    .update(`${agent}:${sovereign ? "sov" : "cld"}:${normalise(prompt)}`)
    .digest("hex")
    .slice(0, 40);

  return `prompt-cache:${agent}:${digest}`;
};

/**
 * Returns cached generation result, or null on miss.
 * Attaches { fromCache: true } so UI can show "Served from cache".
 */
export const getCached = async (agent, prompt, sovereign = false) => {
  if (!CACHEABLE_AGENTS.has(agent)) return null;

  const raw = await redis.get(buildKey(agent, prompt, sovereign));
  if (!raw) return null;

  try {
    return { ...JSON.parse(raw), fromCache: true };
  } catch {
    await redis.del(buildKey(agent, prompt, sovereign));
    return null;
  }
};

/**
 * Stores generation result. Only response + artifacts are stored —
 * userId/conversationId are excluded: cache belongs to the prompt, not the user.
 */
export const setCached = async (agent, prompt, sovereign = false, payload) => {
  if (!CACHEABLE_AGENTS.has(agent)) return;

  const entry = {
    response:  payload.response  ?? "",
    artifacts: payload.artifacts ?? [],
    cachedAt:  Date.now()
  };

  await redis.set(
    buildKey(agent, prompt, sovereign),
    JSON.stringify(entry),
    "EX",
    CACHE_TTL_SECONDS
  );
};

/**
 * Explicitly busts a cache entry — for a future "Regenerate" button.
 */
export const invalidateCache = async (agent, prompt, sovereign = false) =>
  redis.del(buildKey(agent, prompt, sovereign));
