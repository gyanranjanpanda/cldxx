import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cldx-transfer-"));
process.env.ARTIFACT_DIR = scratch;
process.env.CLOUD_EXPORT_ENABLED = "true";
process.env.SOVEREIGN_IMPORT_ENABLED = "true";

const [{ default: router }, { default: mongoose }, { default: JSZip }, { default: redis }] = await Promise.all([
  import("../routes/transfer.route.js"), import("mongoose"), import("jszip"),
  import("../../../shared/redis/redis.js")
]);
redis.disconnect();
redis.del = async () => 1;

const route = (pathName) => router.stack.find((layer) => layer.route?.path === pathName)
  .route.stack.at(-1).handle;
const response = () => ({
  code: 200, headers: {}, body: null,
  status(code) { this.code = code; return this; },
  set(key, value) { Object.assign(this.headers, typeof key === "string" ? { [key]: value } : key); return this; },
  json(value) { this.body = value; return this; },
  send(value) { this.body = value; return this; }
});
const run = async (handler, req) => {
  const res = response();
  await handler(req, res, (error) => { throw error; });
  return res;
};

test("export is scoped to the signed-in user and import is local, idempotent, and rewrites artifact links", async () => {
  const sourceId = new mongoose.Types.ObjectId();
  const messageId = new mongoose.Types.ObjectId();
  const foreignId = new mongoose.Types.ObjectId();
  const name = `${"a".repeat(64)}.pdf`;
  fs.writeFileSync(path.join(scratch, name), "PDF CONTENT");
  fs.writeFileSync(path.join(scratch, `${name}.meta.json`), JSON.stringify({
    userId: "cloud-user", downloadName: "report.pdf", contentType: "application/pdf", expiresAt: null
  }));
  const docs = {
    conversations: [{ _id: sourceId, userId: "cloud-user", title: "Cloud chat" },
      { _id: foreignId, userId: "someone-else", title: "Private" }],
    messages: [{ _id: messageId, conversationId: sourceId, role: "assistant",
      content: `Download https://cloud.example/artifacts/${name}`, images: [], artifacts: [] },
      { _id: new mongoose.Types.ObjectId(), conversationId: foreignId, role: "user", content: "FOREIGN SECRET" }]
  };
  const inserted = { conversations: new Map(), messages: new Map() };
  mongoose.connection.db = {
    collection(table) {
      assert.ok(["conversations", "messages"].includes(table), "no credentials collection accessed");
      return {
        find(query) {
          return { toArray: async () => docs[table].filter((row) => table === "conversations"
            ? row.userId === query.userId
            : query.conversationId.$in.some((id) => id.equals(row.conversationId))) };
        },
        async updateOne(query, update) {
          if (!inserted[table].has(String(query._id)))
            inserted[table].set(String(query._id), update.$setOnInsert);
        }
      };
    }
  };
  const exported = await run(route("/export"), { headers: { "x-user-id": "cloud-user" } });
  assert.equal(exported.code, 200);
  const zip = await JSZip.loadAsync(exported.body);
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  assert.equal(manifest.conversations.length, 1);
  assert.equal(manifest.messages.length, 1);
  assert.equal(manifest.includedArtifacts.length, 1);
  assert.equal(JSON.stringify(manifest).includes("FOREIGN SECRET"), false);
  assert.equal(await zip.file(`artifacts/${name}`).async("string"), "PDF CONTENT");

  const request = { headers: { "x-user-id": "local-admin" }, body: exported.body };
  const first = await run(route("/import"), request);
  const second = await run(route("/import"), request);
  assert.equal(first.code, 200);
  assert.equal(second.code, 200);
  assert.equal(inserted.conversations.size, 1);
  assert.equal(inserted.messages.size, 1);
  const importedMessage = [...inserted.messages.values()][0];
  assert.match(importedMessage.content, /^Download \/artifacts\/[a-f0-9]{64}\.pdf$/);
  assert.equal(importedMessage.content.includes("cloud.example"), false);
  const localName = importedMessage.content.split("/").at(-1);
  assert.equal(fs.readFileSync(path.join(scratch, localName), "utf8"), "PDF CONTENT");
  assert.equal(JSON.parse(fs.readFileSync(path.join(scratch, `${localName}.meta.json`))).userId, "local-admin");
});

test("cloud refuses import and local refuses export", async () => {
  process.env.SOVEREIGN_IMPORT_ENABLED = "false";
  assert.equal((await run(route("/import"), { headers: {}, body: Buffer.from("PK") })).code, 404);
  process.env.CLOUD_EXPORT_ENABLED = "false";
  assert.equal((await run(route("/export"), { headers: {} })).code, 404);
});

test.after(() => { fs.rmSync(scratch, { recursive: true, force: true }); });
