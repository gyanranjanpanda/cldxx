// Provider presets keep OAuth details out of controllers and make adding a
// first-party integration a data change instead of another route.
const builtInProviders = {

  slack: {
    id: "slack",
    name: "Slack",
    description: "Search Slack, read channels, and send messages.",
    mcpUrl: "https://mcp.slack.com/mcp",
    authorizeUrl: "https://slack.com/oauth/v2_user/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.user.access",
    scopes: [
      "search:read.public",
      "search:read.private",
      "search:read.mpim",
      "search:read.im",
      "search:read.files",
      "files:read",
      "users:read",
      "channels:history",
      "groups:history",
      "im:history",
      "mpim:history",
      "chat:write"
    ]
  }

};

// Standard OAuth MCP servers can be added without another controller or
// frontend change. The environment value is intentionally metadata only; the
// client secret remains in PROVIDER_CLIENT_SECRET.
const configuredProviders = () => {
  if (!process.env.MCP_OAUTH_PROVIDERS) return [];

  try {
    const list = JSON.parse(process.env.MCP_OAUTH_PROVIDERS);

    if (!Array.isArray(list)) return [];

    return list
      .filter((item) => item?.id && item?.name && item?.mcpUrl && item?.authorizeUrl && item?.tokenUrl)
      .map((item) => ({
        ...item,
        id: String(item.id).toLowerCase(),
        scopes: Array.isArray(item.scopes) ? item.scopes : [],
        scopeSeparator: item.scopeSeparator || " ",
        tokenField: item.tokenField || "access_token"
      }));
  } catch (error) {
    console.error("[mcp] MCP_OAUTH_PROVIDERS must be valid JSON:", error.message);
    return [];
  }
};

const allProviders = () => {
  const providers = new Map(Object.values(builtInProviders).map((provider) => [provider.id, provider]));

  for (const provider of configuredProviders()) providers.set(provider.id, provider);

  return [...providers.values()];
};

export const getProvider = (id) =>
  allProviders().find((provider) => provider.id === String(id || "").toLowerCase());

// Only public metadata leaves the server. Client secrets and token endpoints
// stay server-side.
export const listProviders = () => allProviders().map((provider) => ({
  id: provider.id,
  name: provider.name,
  description: provider.description,
  auth: "oauth",
  mcpUrl: provider.mcpUrl
}));
