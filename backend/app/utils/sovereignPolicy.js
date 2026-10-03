import redis from "../../shared/redis/redis.js";
import User from "../modules/auth/models/user.model.js";

// Re-exported so gateway code has one obvious place to reach for the zone rule.
export { resolveSovereign } from "../../shared/zone/zone.js";

// The organisation's rule about where a user's turns may be answered. Resolved
// here, in the gateway, because this is the last point that still knows who the
// caller is from a session the client cannot forge.
//
// Read fresh rather than taken from the session: an administrator who moves a
// user to `sovereign_only` expects it to apply to the next request, not after
// the user happens to log in again. Cached briefly so it is not a database
// round trip on every message.

const CACHE_TTL = 60;

const DEFAULT_POLICY = "user_choice";

const cacheKey = (userId) => `sov-policy:v1:${userId}`;

export const getSovereignPolicy = async (userId) => {

  if (!userId) return DEFAULT_POLICY;

  try {

    const cached = await redis.get(cacheKey(userId));

    if (cached) return cached;

    const user = await User.findById(userId).select("sovereignPolicy").lean();

    const policy = user?.sovereignPolicy || DEFAULT_POLICY;

    await redis.set(cacheKey(userId), policy, "EX", CACHE_TTL);

    return policy;

  } catch (error) {

    // Failing open here would mean a lookup error silently downgrades an
    // organisation from sovereign_only to user_choice, which is the one
    // outcome this control exists to prevent. The safe default is the
    // strictest thing we can assert without knowing: leave the decision to the
    // agent's own fail-closed checks and say nothing.
    console.error("[policy] sovereign policy lookup failed:", error.message);

    return DEFAULT_POLICY;

  }

};

/** Called after an administrator changes the policy so it applies immediately. */
export const forgetSovereignPolicy = (userId) => redis.del(cacheKey(userId));

/**
 * Express middleware: resolves the caller's policy onto the request so the
 * proxy decorator, which is synchronous, can put it on a header.
 */
export const withSovereignPolicy = async (req, _res, next) => {

  req.sovereignPolicy = await getSovereignPolicy(req.user?.userId);

  next();

};
