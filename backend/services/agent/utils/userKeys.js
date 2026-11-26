import { internalApi } from "./internalApi.js";

// Fetch once for each cloud turn so saving, disabling, or removing a key takes
// effect immediately. Provider credentials stay out of the Redis cache.
export const fetchUserKeys = async (userId) => {
  if (!userId) return {};

  try {
    const { data } = await internalApi.get(`/user-keys/${userId}`, { timeout: 5000 });
    if (data?.success === true && data.keys) return data.keys;
  } catch (error) {
    if (error.response?.data?.code === "PROVIDER_KEY_UNREADABLE") {
      throw Object.assign(
        new Error("A saved API key could not be read. Replace it or disable it in API Keys."),
        { status: 503 },
      );
    }
  }

  throw Object.assign(
    new Error("Could not load your API key settings. Try the request again."),
    { status: 503 },
  );
};
