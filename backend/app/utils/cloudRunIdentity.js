// Cloud Run checks this token before a request reaches the private agent.
// The gateway's own internal key remains a second, application-level check.
const metadataUrl = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";

let cached = null;

export const cloudRunIdentityToken = async (audience) => {
  if (cached?.audience === audience && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const response = await fetch(`${metadataUrl}?audience=${encodeURIComponent(audience)}`, {
    headers: { "Metadata-Flavor": "Google" },
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error(`Cloud Run identity endpoint returned ${response.status}`);

  const token = await response.text();
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  if (!payload.exp || !payload.aud || payload.aud !== audience) {
    throw new Error("Cloud Run identity endpoint returned an invalid token");
  }
  cached = { audience, token, expiresAt: payload.exp * 1000 };
  return token;
};
