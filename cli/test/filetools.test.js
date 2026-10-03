// The tools that touch a real repository. Most of these are about what the
// tools refuse, because a path arrives from a model that got it from a stack
// trace, a README or a user, and any of those can say "..".

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";

import { createFileTools, renderDiff } from "../src/filetools.js";
import { looksSecret } from "../src/paths.js";

let workspace = null;

const makeWorkspace = async (files) => {

  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "cldx-test-"));

  // Resolved because macOS hands back /var/... which realpath turns into
  // /private/var/..., and a confinement check that compares the two forms
  // without resolving would reject every path in its own workspace.
  workspace = await fs.realpath(workspace);

  for (const [name, content] of Object.entries(files)) {
    const full = path.join(workspace, name);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  }

  return workspace;

};

afterEach(async () => {
  if (workspace) await fs.rm(workspace, { recursive: true, force: true });
  workspace = null;
});

const toolNamed = (root, name, options) =>
  createFileTools(root, options).find((tool) => tool.name === name);

const refusal = async (fn) => {
  try {
    return { result: await fn() };
  } catch (error) {
    return { rule: error.rule, message: error.message };
  }
};

// ── confinement ────────────────────────────────────────────────────────────

test("CODE-007: a traversal out of the workspace is refused", async () => {

  const root = await makeWorkspace({ "a.js": "x" });

  const { rule } = await refusal(() =>
    toolNamed(root, "read_file").run({ path: "../../../../etc/passwd" })
  );

  assert.equal(rule, "CODE-007");

});

test("CODE-007: an absolute path outside the workspace is refused", async () => {

  const root = await makeWorkspace({ "a.js": "x" });

  const { rule } = await refusal(() =>
    toolNamed(root, "read_file").run({ path: "/etc/passwd" })
  );

  assert.equal(rule, "CODE-007");

});

test("CODE-007: a symlink pointing out of the workspace is refused", async () => {

  // The case string comparison cannot catch. A link inside the repository
  // satisfies every prefix check there is; only the filesystem knows where it
  // actually goes.
  const root = await makeWorkspace({ "a.js": "x" });

  await fs.symlink(os.tmpdir(), path.join(root, "escape"));

  const outside = path.join(os.tmpdir(), `cldx-outside-${process.pid}.txt`);

  await fs.writeFile(outside, "secret");

  try {

    const { rule, message } = await refusal(() =>
      toolNamed(root, "read_file").run({ path: `escape/${path.basename(outside)}` })
    );

    assert.equal(rule, "CODE-007");
    assert.match(message, /symlink does not widen/);

  } finally {
    await fs.rm(outside, { force: true });
  }

});

test("a path inside the workspace is allowed", async () => {

  const root = await makeWorkspace({ "src/a.js": "const x = 1;\n" });

  const result = await toolNamed(root, "read_file").run({ path: "src/a.js" });

  assert.match(result, /const x = 1;/);

});

// ── secrets ────────────────────────────────────────────────────────────────

test("CODE-008: a secret-looking file is not readable", async () => {

  const root = await makeWorkspace({ ".env": "TOKEN=hunter2\n" });

  const { rule } = await refusal(() => toolNamed(root, "read_file").run({ path: ".env" }));

  assert.equal(rule, "CODE-008");

});

test("the secret test looks at the name wherever it sits", () => {
  assert.equal(looksSecret(".env"), true);
  assert.equal(looksSecret("config/.env.production"), true);
  assert.equal(looksSecret("certs/server.pem"), true);
  assert.equal(looksSecret("deploy/id_rsa"), true);
  assert.equal(looksSecret("src/environment.js"), false);
  assert.equal(looksSecret("src/keyboard.js"), false);
});

test("grep skips secrets rather than refusing the whole search", async () => {

  // Refusing the lot would teach the model to stop using grep, which is worse
  // for everyone than quietly not searching one file.
  const root = await makeWorkspace({
    ".env": "TOKEN=hunter2\n",
    "app.js": "const TOKEN = 1;\n"
  });

  const result = await toolNamed(root, "grep").run({ pattern: "TOKEN" });

  assert.match(result, /app\.js/);
  assert.doesNotMatch(result, /hunter2/);

});

// ── reading ────────────────────────────────────────────────────────────────

test("a binary file is reported, not dumped into the context", async () => {

  const root = await makeWorkspace({ "x.bin": "" });

  await fs.writeFile(path.join(root, "x.bin"), Buffer.from([0x00, 0x01, 0x02, 0x00]));

  const result = await toolNamed(root, "read_file").run({ path: "x.bin" });

  assert.match(result, /binary/);

});

test("a line range is honoured", async () => {

  const root = await makeWorkspace({ "a.js": "one\ntwo\nthree\nfour\n" });

  const result = await toolNamed(root, "read_file").run({
    path: "a.js",
    start_line: 2,
    end_line: 3
  });

  assert.match(result, /two/);
  assert.match(result, /three/);
  assert.doesNotMatch(result, /four/);

});

test("build and dependency directories are not walked", async () => {

  const root = await makeWorkspace({
    "src/a.js": "x",
    "node_modules/pkg/index.js": "x",
    ".git/config": "x"
  });

  const result = await toolNamed(root, "list_files").run({});

  assert.match(result, /src\/a\.js/);
  assert.doesNotMatch(result, /node_modules/);
  assert.doesNotMatch(result, /\.git/);

});

test("an invalid regular expression is reported, not thrown", async () => {

  const root = await makeWorkspace({ "a.js": "x" });

  const result = await toolNamed(root, "grep").run({ pattern: "[unclosed" });

  assert.match(result, /not a valid regular expression/);

});

// ── editing ────────────────────────────────────────────────────────────────

test("without --auto-edit the file is not written", async () => {

  const root = await makeWorkspace({ "a.js": "const x = 1;\n" });

  const result = await toolNamed(root, "edit_file", { allowEdits: false }).run({
    path: "a.js",
    old_string: "const x = 1;",
    new_string: "const x = 2;"
  });

  assert.match(result, /not written/);
  assert.equal(await fs.readFile(path.join(root, "a.js"), "utf8"), "const x = 1;\n");

});

test("with --auto-edit the file is written", async () => {

  const root = await makeWorkspace({ "a.js": "const x = 1;\n" });

  await toolNamed(root, "edit_file", { allowEdits: true }).run({
    path: "a.js",
    old_string: "const x = 1;",
    new_string: "const x = 2;"
  });

  assert.equal(await fs.readFile(path.join(root, "a.js"), "utf8"), "const x = 2;\n");

});

test("an ambiguous edit is refused rather than resolved by position", async () => {

  // "the first one" is a guess, and a guess that edits the wrong call site is
  // the most expensive mistake this tool can make.
  const root = await makeWorkspace({ "a.js": "foo();\nbar();\nfoo();\n" });

  const result = await toolNamed(root, "edit_file", { allowEdits: true }).run({
    path: "a.js",
    old_string: "foo();",
    new_string: "baz();"
  });

  assert.match(result, /appears 2 times/);
  assert.equal(await fs.readFile(path.join(root, "a.js"), "utf8"), "foo();\nbar();\nfoo();\n");

});

test("text that is not present is reported with advice", async () => {

  const root = await makeWorkspace({ "a.js": "const x = 1;\n" });

  const result = await toolNamed(root, "edit_file", { allowEdits: true }).run({
    path: "a.js",
    old_string: "const y = 9;",
    new_string: "const y = 8;"
  });

  assert.match(result, /does not appear/);

});

test("an edit outside the workspace is refused before anything is read", async () => {

  const root = await makeWorkspace({ "a.js": "x" });

  const { rule } = await refusal(() =>
    toolNamed(root, "edit_file", { allowEdits: true }).run({
      path: "../escape.js",
      old_string: "a",
      new_string: "b"
    })
  );

  assert.equal(rule, "CODE-007");

});

test("the diff shows the change with surrounding context", () => {

  const diff = renderDiff("a.js", "one\ntwo\nthree\n", "one\nTWO\nthree\n");

  assert.match(diff, /-two/);
  assert.match(diff, /\+TWO/);
  assert.match(diff, / one/);

});
