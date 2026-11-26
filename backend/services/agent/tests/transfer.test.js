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

test("ChatGPT ZIP and Claude JSON import searchable text into the restricted database only", async () => {
  process.env.SOVEREIGN_IMPORT_ENABLED = "true";
  process.env.SOVEREIGN_IMPORT_DATABASE = "local-restricted";
  const restricted = { conversations: new Map(), messages: new Map() };
  mongoose.connection.db = { databaseName: "primary", collection() { assert.fail("wrote to primary database"); } };
  const client = mongoose.connection.client;
  mongoose.connection.client = {
    db(name) {
      assert.equal(name, "local-restricted");
      return { collection(table) {
        return { async updateOne({ _id }, { $setOnInsert }) {
          if (!restricted[table].has(String(_id))) restricted[table].set(String(_id), $setOnInsert);
        } };
      } };
    }
  };
  const node = (parent, role, text) => ({
    parent, message: { author: { role }, content: { content_type: "text", parts: [text] } }
  });
  const gpt = [{
    id: "shared-source-id", title: "River research",
    current_node: "report", create_time: 1710000000,
    mapping: {
      base: node(null, "system", "skip system"),
      question: node("base", "user", "Compare the river basins."),
      report: node("question", "assistant", "# River report\n[Reference](https://example.org/report)"),
      alternate: node("question", "assistant", "skip alternate branch")
    }
  }];
  const claude = [{
    uuid: "shared-source-id", name: "Wetlands notes", created_at: "2024-03-09T16:00:00Z",
    chat_messages: [
      { uuid: "q", sender: "human", text: "List wetland species." },
      { uuid: "a", sender: "assistant", content: [
        { type: "thinking", thinking: "skip thinking" },
        { type: "text", text: "The study includes marsh birds." }
      ] }
    ],
    api_key: "skip account metadata"
  }];
  const archive = new JSZip();
  archive.file("export/conversations-001.json", JSON.stringify(gpt));
  archive.file("export/conversations-002.json", "[]");
  archive.file("export/user.json", '{"private":"skip account metadata"}');
  const headers = { "x-user-id": "local-admin", "x-sovereign-policy": "sovereign_only" };
  const importFile = (body) => run(route("/import"), { headers, body });
  try {
    const zip = await archive.generateAsync({ type: "nodebuffer" });
    assert.equal((await run(route("/import"), {
      headers: { "x-user-id": "local-admin", "x-sovereign-policy": "cloud_only" }, body: zip
    })).code, 404);
    const first = await importFile(zip);
    assert.equal(first.code, 200);
    assert.equal(first.body.provider, "ChatGPT");
    assert.equal((await importFile(Buffer.from(JSON.stringify(gpt)))).code, 200);
    const second = await importFile(Buffer.from(JSON.stringify(claude)));
    assert.equal(second.code, 200);
    assert.equal(second.body.provider, "Claude");
    assert.equal((await importFile(Buffer.from('{"other":"data"}'))).code, 400);
    assert.equal(restricted.conversations.size, 2);
    assert.deepEqual([...restricted.conversations.values()].map((chat) => [chat.userId, chat.title]), [
      ["local-admin", "River research"], ["local-admin", "Wetlands notes"]
    ]);
    assert.deepEqual([...restricted.messages.values()].map((message) => [message.role, message.content]), [
      ["user", "Compare the river basins."],
      ["assistant", "# River report\n[Reference](https://example.org/report)"],
      ["user", "List wetland species."],
      ["assistant", "The study includes marsh birds."]
    ]);
  } finally {
    mongoose.connection.client = client;
  }
});

test.after(() => { fs.rmSync(scratch, { recursive: true, force: true }); });
