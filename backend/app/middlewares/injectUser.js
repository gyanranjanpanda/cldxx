// The chat/billing/agent controllers were written to read the caller's identity
// out of x-user-* headers, back when the gateway proxied to them over HTTP.
// In-process there is no proxy to set those, so mirror the session onto the
// request before handing it to a module router and the controllers work as-is.
export const injectUser = (req, res, next) => {

  if (req.user) {
    req.headers["x-user-id"] = String(req.user.userId ?? "");
    req.headers["x-user-email"] = req.user.email ?? "";
    req.headers["x-user-avatar"] = req.user.avatar ?? "";
  }

  next();
};
