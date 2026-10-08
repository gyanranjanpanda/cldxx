import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import os from "os";
import path from "path";

// Pointed at a scratch directory before the module is imported, because the
// directory is resolved once at import and a test that swept the real artefact
// directory would delete a developer's documents.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "sov-artifacts-"));
process.env.SOVEREIGN_ARTIFACT_DIR = scratch;
process.env.SOVEREIGN_ARTIFACT_TTL_HOURS = "0.0003";

const {
  storeArtifact,
  readArtifact,
  sweepArtifacts,
  SOVEREIGN_ARTIFACT_DIR
} = await import("../utils/storage.js");

const state = { sovereign: true, userId: "u1", conversationId: "c1", agent: "pdf" };

const store = (name = "pdf-1727000000000.pdf") =>
  storeArtifact(Buffer.from("CLASSIFIED"), name, "application/pdf", state);

const nameFrom = (url) => url.split("/artifacts/")[1];

test("the download path is unguessable, because the path is the credential", async () => {

  // A browser follows a download link and cannot attach the internal identity
  // header, so this link is the whole access control. It used to be
  // `pdf-<milliseconds>.pdf`, which is a few thousand guesses for anyone who
  // knows roughly when a document was generated.
  const name = nameFrom(await store());

  assert.match(name, /^[a-f0-9]{64}\.pdf$/, `not a random token: ${name}`);
  assert.ok(!name.includes("1727000000000"), "the caller's guessable name reached the URL");

  // Two artefacts from the same caller name must not collide, or one document
  // silently overwrites another.
  const second = nameFrom(await store());
  assert.notEqual(name, second);

});

test("only this module's own names are served", async () => {

  // Validated exactly rather than sanitised: anything that is not a token is
  // not ours, which rules out traversal without having to reason about it.
  for (const bad of [
    "../../.env",
    "..%2F..%2F.env",
    "pdf-1727000000000.pdf",
    "",
    "0".repeat(63) + ".pdf",
    "0".repeat(64) + ".pdf.meta.json"
  ]) {
    const result = readArtifact(bad);
    assert.equal(result.ok, false, `served ${JSON.stringify(bad)}`);
    assert.equal(result.status, 404);
  }

});

test("the metadata sidecar is not itself downloadable", async () => {

  const name = nameFrom(await store());

  // It records who owned the artefact, so serving it would hand out the
  // attribution along with the document.
  assert.equal(readArtifact(`${name}.meta.json`).ok, false);

});

test("an artefact is unreadable by other accounts on the host", async () => {

  const name = nameFrom(await store());

  const file = fs.statSync(path.join(SOVEREIGN_ARTIFACT_DIR, name));
  const dir  = fs.statSync(SOVEREIGN_ARTIFACT_DIR);

  assert.equal(file.mode & 0o777, 0o600, "artefact was group/world readable");
  assert.equal(dir.mode  & 0o777, 0o700, "artefact directory was group/world readable");

});

test("retention is enforced on read, not only by the sweeper", async () => {

  const name = nameFrom(await store());

  assert.equal(readArtifact(name).ok, true);

  await new Promise((r) => setTimeout(r, 1200));

  // A sweep that has not run yet, or a process that restarted before one could,
  // must not become an artefact that outlives its retention window.
  const expired = readArtifact(name);

  assert.equal(expired.ok, false);
  assert.equal(expired.status, 410, "an expired artefact was served rather than reported gone");

});

test("the sweeper removes the artefact and its metadata", async () => {

  const name = nameFrom(await store());

  await new Promise((r) => setTimeout(r, 1200));

  const { removed } = sweepArtifacts();

  assert.ok(removed >= 1);
  assert.equal(fs.existsSync(path.join(SOVEREIGN_ARTIFACT_DIR, name)), false);
  assert.equal(fs.existsSync(path.join(SOVEREIGN_ARTIFACT_DIR, `${name}.meta.json`)), false);

});

test("the sweeper leaves files it cannot account for", () => {

  // It runs unattended against a directory an operator may also have put things
  // in. Deleting what it cannot explain is the more destructive guess.
  const stray = path.join(SOVEREIGN_ARTIFACT_DIR, "operator-notes.txt");
  fs.writeFileSync(stray, "not ours");

  sweepArtifacts();

  assert.equal(fs.existsSync(stray), true, "the sweeper deleted a file it had no metadata for");

  fs.rmSync(stray);

});

test("an artefact names its owner, so a download can be refused to anyone else", async () => {

  // The random name stops a stranger guessing a URL. It does nothing about a
  // colleague who was sent one, which is why the route compares this against
  // the identity the gateway proves.
  const name = nameFrom(await store());

  assert.equal(readArtifact(name).userId, "u1");

});

test.after(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});
