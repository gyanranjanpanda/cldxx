import redis from "../../../shared/redis/redis.js";
import { internalApi } from "./internalApi.js";

// A user who brings their own provider key pays the provider directly, so the
// key has to reach the process that constructs the model client -- this one.
//
// Fetched once per turn and cached briefly: the key changes only when the user
// edits it, and an internal round trip on every model construction would put a
// network hop inside getModel(), which is synchronous by design.
const CACHE_TTL = 60;

const cacheKey = (userId) => `user-keys:v1:${userId}`;

/**
 * The user's own provider keys, as `{ groq, deepseek, google, tavily }`.
 * Missing providers are simply absent, so a caller falls back to the platform
 * key with `state.keys?.groq || process.env.GROQ_API_KEY`.
 *
 * Never throws: a user's key is an enhancement, and a lookup failure must not
 * cost them the turn. It degrades to the platform key instead.
 */
export const fetchUserKeys = async (userId) => {

  if (!userId) return {};

  try {

    const cached = await redis.get(cacheKey(userId));

    if (cached) return JSON.parse(cached);

    const { data } = await internalApi.get(`/user-keys/${userId}`);

    const keys = data?.keys || {};

    await redis.set(cacheKey(userId), JSON.stringify(keys), "EX", CACHE_TTL);

    return keys;

  } catch (error) {

    console.error("[keys] lookup failed, falling back to platform keys:", error.message);

    return {};

  }

};

/** Called after an edit so the next turn sees the new key rather than waiting out the TTL. */
export const forgetUserKeys = (userId) => redis.del(cacheKey(userId));
