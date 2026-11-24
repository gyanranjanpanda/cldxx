import test from "node:test";
import assert from "node:assert/strict";
import { codingContext, parseProjectFiles } from "../utils/codingOutput.js";

test("parses a generated project without stripping nested README fences", () => {
  const answer = `FILE: index.html
\`\`\`html
<main>Hello</main>
\`\`\`
FILE: README.md
# Run
\`\`\`bash
npm start
\`\`\``;
  assert.deepEqual(parseProjectFiles(answer), [
    { name: "index.html", content: "<main>Hello</main>" },
    { name: "README.md", content: "# Run\n```bash\nnpm start\n```" }
  ]);
});

test("does not turn a review mentioning FILE into an artifact", () => {
  assert.deepEqual(parseProjectFiles("The FILE: index.html line is malformed."), []);
});

test("rejects unsafe, duplicate, and empty file entries", () => {
  assert.deepEqual(parseProjectFiles("FILE: ../secret.txt\nno"), []);
  assert.deepEqual(parseProjectFiles("FILE: a.js\n1\nFILE: A.js\n2"), []);
  assert.deepEqual(parseProjectFiles("FILE: a.js\n"), []);
  assert.deepEqual(parseProjectFiles("FILE:\nname.js\ncode"), []);
});

test("follow-up context includes the last project without repeating the current turn", () => {
  const history = [
    { role: "user", content: "Make a game" },
    { role: "assistant", content: "Generated one file", artifacts: [
      { type: "project", files: [{ name: "index.html", content: "<main>Game</main>" }] }
    ] },
    { role: "user", content: "Make it blue" }
  ];
  const context = codingContext(history, "Make it blue");
  assert.equal(context.recent.length, 2);
  assert.match(context.projectText, /FILE: index\.html\n<main>Game<\/main>/);
});

test("large prior projects are not silently truncated", () => {
  const history = [{ role: "assistant", content: "project", artifacts: [
    { type: "project", files: [{ name: "index.html", content: "x".repeat(50) }] }
  ] }];
  const context = codingContext(history, "Edit it", { maxProjectChars: 20 });
  assert.match(context.projectText, /exceed the context limit/);
  assert.doesNotMatch(context.projectText, /x{20}/);
});
