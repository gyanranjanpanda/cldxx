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

  if (!userId) throw new Error("Authenticated user id is required for sovereign policy lookup");

  try {

    const cached = await redis.get(cacheKey(userId));

    if (cached) return cached;

    const user = await User.findById(userId).select("sovereignPolicy").lean();

    if (!user) throw new Error("User record is unavailable for sovereign policy lookup");
    const policy = user.sovereignPolicy || DEFAULT_POLICY;

    await redis.set(cacheKey(userId), policy, "EX", CACHE_TTL);

    return policy;

  } catch (error) {

    console.error("[policy] sovereign policy lookup failed:", error.message);
    throw error;

  }

};

/** Called after an administrator changes the policy so it applies immediately. */
export const forgetSovereignPolicy = (userId) => redis.del(cacheKey(userId));

/**
 * Express middleware: resolves the caller's policy onto the request so the
 * proxy decorator, which is synchronous, can put it on a header.
 */
export const withSovereignPolicy = async (req, res, next) => {
  try {
    req.sovereignPolicy = await getSovereignPolicy(req.user?.userId);
    next();
  } catch {
    res.status(503).json({ message: "Sovereign policy is unavailable. Request refused." });
  }
};
