// Layered configuration, highest precedence first:
//
//   1. command line flags      this invocation
//   2. <root>/.cldx/config.json  the repository -- committed, travels with the code
//   3. ~/.cldx/config.json       the developer
//   4. environment             the deployment (shares SOVEREIGN_* with the server)
//   5. defaults
//
// The repository outranks the developer on purpose. Classification is a
// property of the code, not a preference of whoever happens to be reading it.

import os from "node:os";
import path from "node:path";
import { readJson } from "./workspace.js";

const DEFAULTS = {
  zone: "sovereign",
  classification: "internal",
  baseUrl: "",
  model: "",
  apiKey: "not-needed",
  timeoutMs: 120000
};

// Local runtimes ignore the key but the OpenAI wire format expects one, the
// same accommodation utils/sovereign.js makes server-side.
const fromEnv = () => clean({
  baseUrl: process.env.SOVEREIGN_BASE_URL,
  model: process.env.SOVEREIGN_CODING_MODEL || process.env.SOVEREIGN_MODEL,
  apiKey: process.env.SOVEREIGN_API_KEY
});

const clean = (object) =>
  Object.fromEntries(
    Object.entries(object).filter(
      ([, value]) => value !== undefined && value !== null && value !== ""
    )
  );

export const userConfigPath = () => path.join(os.homedir(), ".cldx", "config.json");

export const repoConfigPath = (root) => path.join(root, ".cldx", "config.json");

export const loadConfig = async (root, flags = {}) => {

  const user = await readJson(userConfigPath(), {});
  const repo = await readJson(repoConfigPath(root), {});

  const merged = {
    ...DEFAULTS,
    ...fromEnv(),
    ...clean(user),
    ...clean(repo),
    ...clean(flags)
  };

  // Kept so the zone decision can explain itself: "cloud because you passed
  // --cloud" and "cloud because ~/.cldx said so" are different situations and
  // the user deserves to be told which one they are in.
  merged.sources = {
    repo: Object.keys(clean(repo)),
    user: Object.keys(clean(user)),
    flags: Object.keys(clean(flags))
  };

  return merged;

};
