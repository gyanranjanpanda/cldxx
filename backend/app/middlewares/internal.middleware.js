const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

// These routes take a userId in the body instead of deriving it from a session,
// so an unauthenticated caller could hand themselves credits. The shared key is
// the only thing separating them from the public internet.
export const requireInternalKey = (req, res, next) => {

  if (!INTERNAL_API_KEY) {
    return res.status(503).json({
      success: false,
      message: "INTERNAL_API_KEY is not configured."
    });
  }

  if (req.headers["x-internal-key"] !== INTERNAL_API_KEY) {
    return res.status(403).json({
      success: false,
      message: "Forbidden"
    });
  }

  next();
};
