// These routes take a userId in the body instead of deriving it from a session,
// so an unauthenticated caller could hand themselves credits. The shared key is
// the only thing separating them from the public internet.
export const requireInternalKey = (req, res, next) => {

  // Read this at request time. In an ESM application, imported modules are
  // evaluated before app/index.js runs dotenv.config(), so a module-level
  // constant permanently captured an empty value and every internal request
  // returned 503 even though INTERNAL_API_KEY was present in .env.
  const internalApiKey = process.env.INTERNAL_API_KEY;

  if (!internalApiKey) {
    return res.status(503).json({
      success: false,
      message: "INTERNAL_API_KEY is not configured."
    });
  }

  if (req.headers["x-internal-key"] !== internalApiKey) {
    return res.status(403).json({
      success: false,
      message: "Forbidden"
    });
  }

  next();
};
