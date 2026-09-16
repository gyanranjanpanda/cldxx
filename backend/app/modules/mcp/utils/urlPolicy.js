// Save-time feedback only. The binding check is the agent's, at connect time --
// see services/agent/utils/mcp/urlGuard.js -- because a hostname that resolves
// publicly now can point at 127.0.0.1 by the time it is used. This catches the
// obvious cases early so the form can explain the rule instead of the health
// check failing later with no context.
export const privateUrlsAllowed = () =>
  process.env.MCP_ALLOW_PRIVATE_URLS === "true" ||
  (process.env.NODE_ENV !== "production" &&
   process.env.MCP_ALLOW_PRIVATE_URLS !== "false");

const LITERAL_PRIVATE = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,          // link-local, incl. cloud metadata
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^\[?::1\]?$/,
  /^\[?f[cd]/i,           // unique-local IPv6
  /\.local$/i,
  /\.internal$/i
];

export const isObviouslyPrivate = (hostname) =>
  LITERAL_PRIVATE.some((pattern) => pattern.test(hostname));
