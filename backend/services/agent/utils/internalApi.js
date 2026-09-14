import axios from "axios";

// The agent runs as its own process, so its calls into auth/chat still go over
// HTTP — but they now hit one app instead of two services. These routes take a
// userId in the body rather than a session, hence the shared key.
export const internalApi = axios.create();

// Resolved per request, not at module scope: ESM evaluates this file before
// index.js gets to dotenv.config(), so reading process.env up here would
// capture an empty key and every internal call would come back 403.
internalApi.interceptors.request.use((config) => {

  config.baseURL =
    process.env.INTERNAL_API_URL || "http://127.0.0.1:8000/internal";

  const key = process.env.INTERNAL_API_KEY || "";

  if (typeof config.headers?.set === "function") {
    config.headers.set("x-internal-key", key);
  } else {
    config.headers = { ...config.headers, "x-internal-key": key };
  }

  return config;
});
