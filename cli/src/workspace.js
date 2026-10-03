// Where cldx code is running, and the one file it writes into the repo.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const run = promisify(execFile);

/**
 * The repository root, or the working directory when there is no repository.
 *
 * Asked of git rather than walked by hand so that worktrees, submodules and
 * symlinked checkouts all answer correctly -- the cases where a hand-rolled
 * walk up to the first .git quietly picks the wrong root.
 */
export const findRoot = async (from = process.cwd()) => {

  try {

    const { stdout } = await run(
      "git",
      ["rev-parse", "--show-toplevel"],
      { cwd: from }
    );

    return stdout.trim() || from;

  } catch {
    return from;
  }

};

export const cldxDir = (root) => path.join(root, ".cldx");

export const ensureCldxDir = async (root) => {

  const dir = cldxDir(root);

  await fs.mkdir(dir, { recursive: true });

  await ensureIgnored(root);

  return dir;

};

// Session transcripts under .cldx/ contain source. Committing them into the
// repository being protected would be a self-inflicted version of the exact
// leak this product exists to prevent, so the tool writes the ignore rule
// itself on first run rather than documenting it and hoping.
const IGNORE_RULE = ".cldx/";

const IGNORE_BLOCK = [
  "",
  "# cldx code -- session state and probe cache. Contains source; never commit.",
  IGNORE_RULE,
  ""
].join("\n");

export const ensureIgnored = async (root) => {

  const file = path.join(root, ".gitignore");

  let current = "";

  try {
    current = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  // Matched line-wise. A substring test would be satisfied by an unrelated
  // path that merely contains ".cldx/", and would also be fooled by a negation
  // ("!.cldx/") that means the opposite of what we need.
  const already = current
    .split("\n")
    .some((line) => line.trim() === IGNORE_RULE);

  if (already) return false;

  await fs.writeFile(file, current + IGNORE_BLOCK, "utf8");

  return true;

};

export const readJson = async (file, fallback = null) => {

  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    // A corrupt cache or a half-written config is not worth failing a session
    // over -- every caller has a usable default.
    return fallback;
  }

};

export const writeJson = async (file, value) => {

  await fs.mkdir(path.dirname(file), { recursive: true });

  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n", "utf8");

};
