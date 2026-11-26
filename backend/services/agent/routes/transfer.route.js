import express from "express";
import JSZip from "jszip";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import redis from "../../../shared/redis/redis.js";
import { requireGateway } from "../middlewares/requireGateway.js";
import { readArtifact, SOVEREIGN_ARTIFACT_DIR } from "../utils/storage.js";

const router = express.Router();
router.use(requireGateway);
const objectId = (value) => /^[a-f0-9]{24}$/i.test(String(value || ""));
const artifactName = (value) => /^[a-f0-9]{64}(\.[A-Za-z0-9]{1,8})?$/.test(value);
const artifactLinks = (value) => [...String(value).matchAll(/\/artifacts\/([a-f0-9]{64}(?:\.[A-Za-z0-9]{1,8})?)/g)].map((match) => match[1]);
const limited = (value, max) => typeof value === "string" && value.length <= max;
const failure = (res, status, message) => res.status(status).json({ success: false, message });

// Only chat content is selected. The user, key, integration and billing
// collections never enter this archive, even if their schemas change.
const conversationRecord = (row) => ({
  id: String(row._id), title: String(row.title || "New Chat"),
  createdAt: row.createdAt || null, updatedAt: row.updatedAt || null
});
const messageRecord = (row) => ({
  id: String(row._id), conversationId: String(row.conversationId),
  role: row.role, content: String(row.content || ""),
  images: Array.isArray(row.images) ? row.images : [],
  artifacts: Array.isArray(row.artifacts) ? row.artifacts : [],
  guest: row.guest === true,
  createdAt: row.createdAt || null, updatedAt: row.updatedAt || null
});

router.get("/export", async (req, res, next) => {
  if (process.env.CLOUD_EXPORT_ENABLED !== "true") return failure(res, 404, "Export is unavailable here");
  const userId = req.headers["x-user-id"];
  if (!userId) return failure(res, 401, "Missing identity");
  try {
    const db = mongoose.connection.db;
    const rows = await db.collection("conversations").find({ userId }).toArray();
    const conversations = rows.map(conversationRecord);
    const ids = rows.map((row) => row._id);
    const messages = ids.length
      ? (await db.collection("messages").find({ conversationId: { $in: ids } }).toArray()).map(messageRecord)
      : [];
    const zip = new JSZip();
    const missingArtifacts = [];
    const externalImages = [...new Set(messages.flatMap((message) => message.images)
      .filter((url) => typeof url === "string" && /^https?:\/\//.test(url) &&
        !artifactLinks(url).length))];
    const names = new Set(artifactLinks(JSON.stringify(messages)));
    for (const name of names) {
      const found = readArtifact(name);
      if (!found.ok || found.userId !== userId) {
        missingArtifacts.push(name);
        continue;
      }
      const bytes = fs.readFileSync(found.file);
      zip.file(`artifacts/${name}`, bytes);
      zip.file(`metadata/${name}.json`, JSON.stringify({
        downloadName: found.downloadName, contentType: found.contentType
      }));
    }
    zip.file("manifest.json", JSON.stringify({
      format: "cldx-cloud-content", version: 1, sourceUserId: userId,
      exportedAt: new Date().toISOString(), conversations, messages,
      includedArtifacts: [...names].filter((name) => !missingArtifacts.includes(name)),
      missingArtifacts, externalImages,
      note: "API keys and integration credentials are excluded. Historical uploads were not retained by older releases."
    }));
    const archive = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    if (archive.length > 128 * 1024 * 1024) return failure(res, 413, "Archive exceeds 128 MB");
    res.set({
      "Cache-Control": "private, no-store",
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="cldx-cloud-content.zip"'
    });
    return res.send(archive);
  } catch (error) { return next(error); }
});

const localId = (kind, userId, sourceUserId, sourceId) =>
  new mongoose.Types.ObjectId(crypto.createHash("sha256")
    .update(`${kind}\0${userId}\0${sourceUserId}\0${sourceId}`).digest("hex").slice(0, 24));
const localArtifactName = (userId, sourceUserId, name) =>
  crypto.createHash("sha256").update(`artifact\0${userId}\0${sourceUserId}\0${name}`).digest("hex") + path.extname(name);

router.post("/import", express.raw({ type: ["application/zip", "application/octet-stream"], limit: "128mb" }), async (req, res, next) => {
  if (process.env.SOVEREIGN_IMPORT_ENABLED !== "true") return failure(res, 404, "Import is unavailable here");
  const userId = req.headers["x-user-id"];
  if (!userId) return failure(res, 401, "Missing identity");
  if (!Buffer.isBuffer(req.body) || req.body.length < 4) return failure(res, 400, "Choose a CLDX export ZIP file");
  try {
    const zip = await JSZip.loadAsync(req.body);
    const entry = zip.file("manifest.json");
    if (!entry || entry._data.uncompressedSize > 64 * 1024 * 1024) return failure(res, 400, "Invalid CLDX archive");
    const manifest = JSON.parse(await entry.async("string"));
    if (manifest.format !== "cldx-cloud-content" || manifest.version !== 1 ||
        !limited(manifest.sourceUserId, 256) || !manifest.sourceUserId ||
        !Array.isArray(manifest.conversations) || manifest.conversations.length > 10000 ||
        !Array.isArray(manifest.messages) || manifest.messages.length > 100000 ||
        !Array.isArray(manifest.includedArtifacts) || manifest.includedArtifacts.length > 1000) {
      return failure(res, 400, "Invalid CLDX archive manifest");
    }
    const sourceIds = new Set();
    for (const row of manifest.conversations) {
      if (!objectId(row.id) || !limited(row.title, 10000) || sourceIds.has(row.id))
        return failure(res, 400, "Invalid conversation in archive");
      sourceIds.add(row.id);
    }
    for (const row of manifest.messages) {
      if (!objectId(row.id) || !sourceIds.has(row.conversationId) ||
          !["user", "assistant"].includes(row.role) || !limited(row.content, 5_000_000) ||
          !Array.isArray(row.images) || !Array.isArray(row.artifacts))
        return failure(res, 400, "Invalid message in archive");
    }
    let totalBytes = 0;
    const renames = new Map();
    if (manifest.externalImages !== undefined &&
        (!Array.isArray(manifest.externalImages) || manifest.externalImages.length > 1000 ||
         manifest.externalImages.some((url) => !limited(url, 4096))))
      return failure(res, 400, "Invalid image references in archive");
    const unavailableImages = new Set(manifest.externalImages || []);
    const artifactFiles = [];
    for (const name of manifest.includedArtifacts) {
      if (!artifactName(name) || renames.has(name)) return failure(res, 400, "Invalid artifact in archive");
      const file = zip.file(`artifacts/${name}`);
      const metadata = zip.file(`metadata/${name}.json`);
      if (!file || !metadata || file._data.uncompressedSize > 25 * 1024 * 1024 ||
          metadata._data.uncompressedSize > 4096) return failure(res, 400, "Incomplete artifact in archive");
      totalBytes += file._data.uncompressedSize;
      if (totalBytes > 256 * 1024 * 1024) return failure(res, 413, "Artifacts exceed 256 MB");
      const meta = JSON.parse(await metadata.async("string"));
      if (!limited(meta.downloadName, 255) || !limited(meta.contentType, 255))
        return failure(res, 400, "Invalid artifact metadata");
      const target = localArtifactName(userId, manifest.sourceUserId, name);
      renames.set(name, target);
      artifactFiles.push({ target, bytes: await file.async("nodebuffer"), meta });
    }
    // Rewrite only links for artifacts actually carried in the archive.
    const rewrite = (value) => typeof value === "string"
      ? [...unavailableImages].reduce((text, url) => text.replaceAll(url, "#unavailable-artifact"), value)
        .replace(/(?:https?:\/\/[^\s)"']+)?\/artifacts\/([a-f0-9]{64}(?:\.[A-Za-z0-9]{1,8})?)/g,
          (_whole, name) => renames.has(name) ? `/artifacts/${renames.get(name)}` : "#unavailable-artifact")
      : value;
    fs.mkdirSync(SOVEREIGN_ARTIFACT_DIR, { recursive: true, mode: 0o700 });
    for (const { target, bytes, meta } of artifactFiles) {
      fs.writeFileSync(path.join(SOVEREIGN_ARTIFACT_DIR, target), bytes, { mode: 0o600 });
      fs.writeFileSync(path.join(SOVEREIGN_ARTIFACT_DIR, `${target}.meta.json`), JSON.stringify({
        downloadName: meta.downloadName, contentType: meta.contentType,
        userId, createdAt: Date.now(), expiresAt: null
      }), { mode: 0o600 });
    }
    const db = mongoose.connection.db;
    const conversations = db.collection("conversations");
    const messages = db.collection("messages");
    for (const row of manifest.conversations) {
      const _id = localId("conversation", userId, manifest.sourceUserId, row.id);
      await conversations.updateOne({ _id }, { $setOnInsert: {
        _id, userId, title: row.title,
        createdAt: new Date(row.createdAt || Date.now()),
        updatedAt: new Date(row.updatedAt || Date.now())
      } }, { upsert: true });
      await redis.del(`conversation:${_id}`);
    }
    for (const row of manifest.messages) {
      const _id = localId("message", userId, manifest.sourceUserId, row.id);
      const conversationId = localId("conversation", userId, manifest.sourceUserId, row.conversationId);
      await messages.updateOne({ _id }, { $setOnInsert: {
        _id, conversationId, role: row.role,
        content: rewrite(row.content),
        images: row.images.map(rewrite),
        artifacts: JSON.parse(JSON.stringify(row.artifacts), (_key, value) => rewrite(value)),
        guest: row.guest === true,
        createdAt: new Date(row.createdAt || Date.now()),
        updatedAt: new Date(row.updatedAt || Date.now())
      } }, { upsert: true });
    }
    res.set("Cache-Control", "private, no-store");
    return res.json({ success: true, conversations: manifest.conversations.length,
      messages: manifest.messages.length, artifacts: artifactFiles.length,
      missingArtifacts: (manifest.missingArtifacts?.length || 0) + unavailableImages.size });
  } catch (error) {
    if (error instanceof SyntaxError || /zip|corrupt|invalid/i.test(error.message))
      return failure(res, 400, "Invalid CLDX archive");
    return next(error);
  }
});

export default router;
