// read, grep, edit -- in that order, and edit last on purpose.
//
// These are the first things that touch a real repository, so every one of them
// goes through resolveInside() and none of them takes a path on trust.

import fs from "node:fs/promises";
import path from "node:path";
import { PolicyDenied } from "./policy.js";
import { looksSecret, resolveInside, SKIP_DIRECTORIES } from "./paths.js";

// A local 7B model is working in an 8k-32k window. Handing it a 2MB file does
// not fail loudly -- the runtime silently drops the oldest tokens, which here
// means the instructions. Truncating with a visible marker is the honest
// failure. The real budget lands in step 5.
const MAX_READ_BYTES = 64 * 1024;
const MAX_GREP_MATCHES = 60;
const MAX_GREP_FILE_BYTES = 1024 * 1024;

const looksBinary = (buffer) => {

  // A NUL in the first 8k is the test every tool from grep onwards has used,
  // and it is right often enough to be worth more than a content sniffer.
  const window = buffer.subarray(0, 8192);

  return window.includes(0);

};

const walk = async function* (root, directory = root) {

  let entries;

  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {

    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {

      if (SKIP_DIRECTORIES.has(entry.name)) continue;

      yield* walk(root, full);

      continue;

    }

    if (entry.isFile()) yield full;

  }

};

const readFileTool = (root) => ({

  name: "read_file",
  description:
    "Read a file from the repository. Returns the contents with line numbers. Use this instead of guessing what a file contains.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path relative to the repository root." },
      start_line: { type: "number", description: "Optional first line (1-based)." },
      end_line: { type: "number", description: "Optional last line, inclusive." }
    },
    required: ["path"]
  },

  run: async ({ path: candidate, start_line: start, end_line: end }) => {

    const { absolute, relative } = await resolveInside(root, candidate);

    const stat = await fs.stat(absolute);

    if (stat.isDirectory()) {
      return `Error: "${relative}" is a directory. Use list_files to see what is in it.`;
    }

    const buffer = await fs.readFile(absolute);

    if (looksBinary(buffer)) {
      return `Error: "${relative}" is a binary file (${stat.size} bytes).`;
    }

    const lines = buffer.toString("utf8").split("\n");

    const from = Math.max(1, Number(start) || 1);
    const to = Math.min(lines.length, Number(end) || lines.length);

    const selected = lines.slice(from - 1, to);

    let body = selected
      .map((line, index) => `${String(from + index).padStart(5)}  ${line}`)
      .join("\n");

    let note = "";

    if (Buffer.byteLength(body, "utf8") > MAX_READ_BYTES) {
      body = body.slice(0, MAX_READ_BYTES);
      note = `\n\n[truncated at ${MAX_READ_BYTES} bytes -- read a line range to see more]`;
    }

    return `${relative} (${lines.length} lines)\n${body}${note}`;

  }

});

const listFilesTool = (root) => ({

  name: "list_files",
  description:
    "List files in the repository, optionally under a subdirectory. Build, dependency and version-control directories are omitted.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Optional subdirectory, relative to the repository root." }
    }
  },

  run: async ({ path: candidate }) => {

    const base = candidate
      ? (await resolveInside(root, candidate)).absolute
      : root;

    const found = [];

    for await (const file of walk(root, base)) {

      found.push(path.relative(root, file));

      if (found.length >= 400) break;

    }

    if (found.length === 0) return "No files found.";

    return found.sort().join("\n");

  }

});

const grepTool = (root) => ({

  name: "grep",
  description:
    "Search the repository for a regular expression. Returns matching lines with their file and line number.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "A JavaScript regular expression." },
      path: { type: "string", description: "Optional subdirectory to search." },
      ignore_case: { type: "boolean" }
    },
    required: ["pattern"]
  },

  run: async ({ pattern, path: candidate, ignore_case: ignoreCase }) => {

    let expression;

    try {
      expression = new RegExp(pattern, ignoreCase ? "i" : "");
    } catch (error) {
      return `Error: "${pattern}" is not a valid regular expression (${error.message}).`;
    }

    const base = candidate
      ? (await resolveInside(root, candidate)).absolute
      : root;

    const matches = [];

    for await (const file of walk(root, base)) {

      if (matches.length >= MAX_GREP_MATCHES) break;

      const relative = path.relative(root, file);

      // Secrets are skipped rather than refused. A grep over a repository that
      // happens to contain a .env should return its other results, not die --
      // refusing the lot would teach the model to stop using grep.
      //
      // read_file enforces this through resolveInside(); grep walks the tree
      // itself and never calls it, so the rule has to be applied again here.
      // It was described in this comment before it was implemented, and the
      // test caught the gap.
      if (looksSecret(relative)) continue;

      const stat = await fs.stat(file).catch(() => null);

      if (!stat || stat.size > MAX_GREP_FILE_BYTES) continue;

      let buffer;

      try {
        buffer = await fs.readFile(file);
      } catch {
        continue;
      }

      if (looksBinary(buffer)) continue;

      const lines = buffer.toString("utf8").split("\n");

      for (let index = 0; index < lines.length; index += 1) {

        if (!expression.test(lines[index])) continue;

        matches.push(`${relative}:${index + 1}: ${lines[index].trim().slice(0, 200)}`);

        if (matches.length >= MAX_GREP_MATCHES) break;

      }

    }

    if (matches.length === 0) return `No matches for /${pattern}/.`;

    const capped = matches.length >= MAX_GREP_MATCHES
      ? `\n\n[stopped at ${MAX_GREP_MATCHES} matches -- narrow the pattern]`
      : "";

    return matches.join("\n") + capped;

  }

});

/**
 * A minimal unified-ish diff around a single replacement.
 *
 * Not a general diff algorithm, because the edit is an exact string
 * replacement and the changed region is therefore already known. Computing an
 * LCS to rediscover something we were told would be effort spent to produce the
 * same answer.
 */
export const renderDiff = (relative, before, after) => {

  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

  let start = 0;

  while (
    start < beforeLines.length &&
    start < afterLines.length &&
    beforeLines[start] === afterLines[start]
  ) start += 1;

  let fromEnd = 0;

  while (
    fromEnd < beforeLines.length - start &&
    fromEnd < afterLines.length - start &&
    beforeLines[beforeLines.length - 1 - fromEnd] === afterLines[afterLines.length - 1 - fromEnd]
  ) fromEnd += 1;

  const context = 2;
  const head = Math.max(0, start - context);

  const removed = beforeLines.slice(start, beforeLines.length - fromEnd);
  const added = afterLines.slice(start, afterLines.length - fromEnd);

  return [
    `--- ${relative}`,
    `+++ ${relative}`,
    `@@ -${start + 1},${removed.length} +${start + 1},${added.length} @@`,
    ...beforeLines.slice(head, start).map((line) => ` ${line}`),
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
    ...beforeLines.slice(beforeLines.length - fromEnd, beforeLines.length - fromEnd + context)
      .map((line) => ` ${line}`)
  ].join("\n");

};

const editTool = (root, { apply }) => ({

  name: "edit_file",
  description: apply
    ? "Replace an exact string in a file. The string must appear exactly once."
    : "Propose replacing an exact string in a file. Returns a diff; nothing is written.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      old_string: { type: "string", description: "Exact text to replace, including indentation." },
      new_string: { type: "string", description: "Replacement text." }
    },
    required: ["path", "old_string", "new_string"]
  },

  run: async ({ path: candidate, old_string: oldString, new_string: newString }) => {

    if (typeof oldString !== "string" || oldString === "") {
      return "Error: old_string must be a non-empty exact excerpt of the file.";
    }

    const { absolute, relative } = await resolveInside(root, candidate);

    const before = await fs.readFile(absolute, "utf8");

    const occurrences = before.split(oldString).length - 1;

    if (occurrences === 0) {
      return `Error: that exact text does not appear in ${relative}. Read the file and copy the text exactly, including indentation.`;
    }

    // Ambiguity is refused rather than resolved by position. "The first one"
    // is a guess, and a guess that edits the wrong call site is the single
    // most expensive mistake this tool can make.
    if (occurrences > 1) {
      return `Error: that text appears ${occurrences} times in ${relative}. Include enough surrounding lines to make it unique.`;
    }

    const after = before.replace(oldString, newString);

    const diff = renderDiff(relative, before, after);

    if (!apply) {
      return `Proposed (not written -- session is read-only for edits):\n${diff}`;
    }

    await fs.writeFile(absolute, after, "utf8");

    return `Edited ${relative}:\n${diff}`;

  }

});

/**
 * @param {string}  root
 * @param {object}  options
 * @param {boolean} options.allowEdits  false proposes diffs without writing
 */
export const createFileTools = (root, { allowEdits = false } = {}) => [
  readFileTool(root),
  listFilesTool(root),
  grepTool(root),
  editTool(root, { apply: allowEdits })
];

export { PolicyDenied };
