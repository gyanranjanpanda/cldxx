// Every path a tool touches passes through here.
//
// A coding agent is handed paths by a model that was handed them by a
// repository, a stack trace or a user, and any of those can say "../../..".
// Confinement is therefore not a hardening pass to do later: it is the
// precondition for letting a tool exist at all.

import fs from "node:fs/promises";
import path from "node:path";
import { PolicyDenied } from "./policy.js";

// Checked against the basename and against the path relative to the root, so
// both "id_rsa" and "config/secrets/id_rsa" are caught.
const SECRET_PATTERNS = [
  /^\.env(\..*)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.keystore$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)$/i,
  /^\.npmrc$/i,
  /^\.netrc$/i,
  /^serviceaccount\.json$/i,
  /credentials\.json$/i,
  /^\.git-credentials$/i
];

// Directories no useful answer comes out of, and which are large enough that
// walking them turns a grep into a hang.
export const SKIP_DIRECTORIES = new Set([
  ".git",
  ".cldx",
  "node_modules",
  ".next",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".cache",
  "coverage",
  ".pytest_cache"
]);

export const looksSecret = (relative) => {

  const base = path.basename(relative);

  return SECRET_PATTERNS.some(
    (pattern) => pattern.test(base) || pattern.test(relative)
  );

};

const insideRoot = (root, target) => {

  const relative = path.relative(root, target);

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));

};

/**
 * Resolves a model-supplied path to a real one inside the workspace, or
 * refuses.
 *
 * Symlinks are resolved before the check, not after. A link inside the
 * repository pointing at ~/.ssh passes every string comparison in the world --
 * the only way to catch it is to ask the filesystem where the path actually
 * goes. The parent is resolved rather than the file itself so that a path which
 * does not exist yet can still be validated.
 */
export const resolveInside = async (root, candidate, { mustExist = true } = {}) => {

  if (typeof candidate !== "string" || candidate.trim() === "") {
    throw new PolicyDenied("No path was given.", "CODE-007");
  }

  const target = path.resolve(root, candidate);

  if (!insideRoot(root, target)) {
    throw new PolicyDenied(
      `"${candidate}" is outside the workspace. Tools may only touch files under ${root}.`,
      "CODE-007"
    );
  }

  let real;

  try {
    real = await fs.realpath(target);
  } catch (error) {

    if (error.code !== "ENOENT") throw error;

    if (mustExist) {
      throw new PolicyDenied(`"${candidate}" does not exist.`, "CODE-007");
    }

    // Validate where it *would* be created.
    const parent = await fs.realpath(path.dirname(target)).catch(() => null);

    if (!parent || !insideRoot(await fs.realpath(root), parent)) {
      throw new PolicyDenied(
        `"${candidate}" would be created outside the workspace.`,
        "CODE-007"
      );
    }

    return { absolute: target, relative: path.relative(root, target) };

  }

  if (!insideRoot(await fs.realpath(root), real)) {
    throw new PolicyDenied(
      `"${candidate}" resolves to ${real}, which is outside the workspace. A symlink does not widen what a tool may read.`,
      "CODE-007"
    );
  }

  const relative = path.relative(await fs.realpath(root), real);

  // CODE-008. The model is local, so this is not an egress event -- but a
  // secret read into context ends up in the session transcript, in any summary
  // built from it, and in whatever the developer pastes elsewhere. Cheap to
  // refuse, expensive to regret.
  if (looksSecret(relative)) {
    throw new PolicyDenied(
      `"${relative}" looks like a secret, so it is not readable by a tool. Paste the specific line if the model genuinely needs it.`,
      "CODE-008"
    );
  }

  return { absolute: real, relative };

};
