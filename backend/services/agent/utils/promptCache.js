import { createHash } from "crypto";
import redis from "../../../shared/redis/redis.js";

// Prompt cache for expensive generation agents (coding, pdf, ppt).
//
// Problem: user types "create a snake game" → 14,000 tokens, 10 credits, 8 sec.
// Types same thing again in new conversation → burns another 10 credits for
// identical output.
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

// Only these agents justify the cache — they cost 10+ credits and 8-30 seconds.
const CACHEABLE_AGENTS = new Set(["coding", "pdf", "ppt"]);

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
