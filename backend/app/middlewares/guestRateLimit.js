import redis from "../../shared/redis/redis.js";

/**
 * Per-link, per-minute cap on guest traffic.
 *
 * The invite's own allowance limits how much of the owner's balance a guest can
 * spend in total; this limits how fast, so a shared link cannot be turned into
 * a burst of expensive calls the moment it leaks.
 */
export const guestRateLimit = (bucket, perMinute) =>

  async (req, res, next) => {

    try {

      const token = String(req.params.token || "").slice(0, 64);

      if (!token) return next();

      const key = `guest-rate:${bucket}:${token}`;
      const count = await redis.incr(key);

      if (count === 1) await redis.expire(key, 60);

      if (count > perMinute) {

        const ttl = await redis.ttl(key);

        return res.status(429).json({
          success: false,
          message: `Too many requests. Try again in ${Math.max(ttl, 1)}s.`
        });

      }

      next();

    } catch {

      // Redis being down must not lock guests out of a link that works.
      next();

    }

  };
