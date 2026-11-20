// Every agent route takes the caller's identity from an x-user-id header that
// the app sets after checking the session. Nothing re-checked that the request
// actually came from the app, so anything able to reach this port could send
// the header itself and act as any user -- spend their credits, read their
// conversation memory, and make the agent connect to their MCP servers.
//
// The app now signs proxied calls with the shared internal key. Requests
// without it are refused.
export const requireGateway = (req, res, next) => {

  const expected = process.env.INTERNAL_API_KEY;

  if (!expected) {
    return res.status(503).json({ success: false, message: "INTERNAL_API_KEY is not configured" });
  }

  const provided = req.headers["x-internal-key"];

  if (provided !== expected) {

    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });

  }

  next();

};
