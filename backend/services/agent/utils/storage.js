import fs from "fs";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();

import { uploadToS3 } from "./uploadToS3.js";
import { getDownloadUrl } from "./getDownloadUrl.js";
import { audit } from "./audit.js";

// A generated report carries the same content as the prompt that produced it,
// so routing the model locally and then putting the finished PDF in an S3
// bucket would leak the document at the last step. In Sovereign Mode artefacts
// stay on a disk the organisation controls and are served back from this
// service instead of a presigned AWS URL.
//
// Three things make that safe, and the first version of this file had none of
// them:
//
//   * The name on disk is random. A download link is followed by the browser,
//     which cannot attach the internal identity header, so the link itself has
//     to be the credential -- exactly how a presigned URL works. It was
//     `pdf-<milliseconds>.pdf`, which anyone who knew roughly when a document
//     was generated could guess in a few thousand tries against a mount that
//     asks for nothing.
//   * It expires. The cloud path hands out a URL good for 24 hours; the
//     sovereign path wrote a file that stayed readable forever, which is the
//     worse outcome for the deployment that cares more.
//   * It is readable only by this service's own user, not by every account on
//     the host.

// Resolved rather than used as given: deployments write `./artifacts` in their
// env file, and a relative path means the artefact directory moves with whatever
// cwd the process happened to start in -- and res.sendFile refuses it outright.
export const SOVEREIGN_ARTIFACT_DIR =
 path.resolve(
  process.env.SOVEREIGN_ARTIFACT_DIR ||
  path.join(process.cwd(), "artifacts")
 );

// Matches the presigned window the cloud path uses, so the two zones make the
// same promise about how long a download link lives.
const TTL_HOURS =
 Number(process.env.SOVEREIGN_ARTIFACT_TTL_HOURS) || 24;

export const ARTIFACT_TTL_MS =
 TTL_HOURS * 60 * 60 * 1000;

// Only the extension is taken from the caller's name. A traversal in it would
// otherwise let a document be written outside the artefact directory, and the
// rest of the name is replaced by a random token anyway.
const extensionOf =
(fileName)=>{

 const ext =
  path.extname(path.basename(String(fileName || "")));

 return /^\.[A-Za-z0-9]{1,8}$/.test(ext) ? ext.toLowerCase() : "";

};

// 32 bytes. The link is the capability, so its strength is the whole access
// control -- this has to be infeasible to guess, not merely non-obvious.
const token =
()=>
 crypto.randomBytes(32).toString("hex");

const metaPath =
(name)=>
 path.join(SOVEREIGN_ARTIFACT_DIR, `${name}.meta.json`);

// 0700: the artefact directory holds documents the organisation declined to
// send to a cloud bucket, so it should not be readable by every other account
// on the host either.
const ensureDir =
()=>{

 fs.mkdirSync(
  SOVEREIGN_ARTIFACT_DIR,
  { recursive:true, mode:0o700 }
 );

 // mkdirSync's mode applies only when it creates the directory, so a
 // deployment that already had an artefact directory -- which is every
 // deployment after the first run -- would keep whatever the umask gave it.
 // Observed as 755 on a directory holding documents that were kept out of S3
 // precisely so fewer parties could read them.
 try{
  fs.chmodSync(SOVEREIGN_ARTIFACT_DIR, 0o700);
 }catch(error){
  console.error(`[storage] could not tighten ${SOVEREIGN_ARTIFACT_DIR}:`, error.message);
 }

};

export const storeArtifact =
async(buffer, fileName, contentType, state = {})=>{

 const sovereign =
  state.sovereign === true;

 if(sovereign){

  ensureDir();

  const name =
   `${token()}${extensionOf(fileName)}`;

  const expiresAt =
   Date.now() + ARTIFACT_TTL_MS;

  fs.writeFileSync(
   path.join(SOVEREIGN_ARTIFACT_DIR, name),
   buffer,
   { mode:0o600 }
  );

  // The human-readable name is kept here rather than in the URL so the browser
  // can still save "pdf-1727..." while the path stays unguessable. Ownership is
  // recorded so a download can be attributed, and so a future revocation of one
  // user's artefacts has something to match on.
  fs.writeFileSync(
   metaPath(name),
   JSON.stringify({
    downloadName: path.basename(String(fileName || "artifact")),
    contentType: contentType || "application/octet-stream",
    userId: state.userId ?? null,
    conversationId: state.conversationId ?? null,
    createdAt: Date.now(),
    expiresAt
   }),
   { mode:0o600 }
  );

  audit({

   userId: state.userId,

   conversationId: state.conversationId,

   agent: state.agent,

   zone: "SOVEREIGN",

   decision: "ALLOW",

   rule: "SOV-004",

   model: null,

   endpoint: SOVEREIGN_ARTIFACT_DIR

  });

  const base =
   process.env.SOVEREIGN_PUBLIC_URL || "";

  return `${base}/artifacts/${name}`;

 }

 await uploadToS3(
  buffer,
  fileName,
  contentType
 );

 return await getDownloadUrl(
  fileName,
  24 * 60 * 60
 );

};

/**
 * Resolves a requested artefact name to a file on disk, or explains why not.
 *
 * Kept here rather than in the route so the name rules and the expiry rule are
 * stated once, next to the code that writes them.
 */
export const readArtifact =
(requested)=>{

 // The name is generated by this module, so it can be validated exactly rather
 // than sanitised -- anything that is not a token is not ours, and that alone
 // rules out traversal.
 const name =
  String(requested || "");

 if(!/^[a-f0-9]{64}(\.[A-Za-z0-9]{1,8})?$/.test(name)){
  return { ok:false, status:404 };
 }

 const file =
  path.join(SOVEREIGN_ARTIFACT_DIR, name);

 if(!fs.existsSync(file)){
  return { ok:false, status:404 };
 }

 let meta = {};

 try{
  meta = JSON.parse(fs.readFileSync(metaPath(name), "utf8"));
 }catch{
  // An artefact whose metadata is unreadable cannot have its expiry checked,
  // and serving it would mean serving something with no known retention. That
  // is the case to refuse rather than to guess at.
  return { ok:false, status:404 };
 }

 if(typeof meta.expiresAt === "number" && Date.now() > meta.expiresAt){

  // Checked on read as well as swept on a timer: a sweep that had not run yet,
  // or a process that was restarted, must not turn into an artefact that
  // outlives its retention window.
  return { ok:false, status:410 };

 }

 return {
  ok: true,
  file,
  downloadName: meta.downloadName || name,
  contentType: meta.contentType || "application/octet-stream",
  // Returned so the route can refuse a download to anyone other than the user
  // the artefact was generated for. The unguessable name stops a stranger
  // guessing a URL; this stops a signed-in colleague who was sent one.
  userId: meta.userId ?? null
 };

};

/**
 * Deletes artefacts past their retention window.
 *
 * Retention is a promise to the organisation, so it is enforced by something
 * that runs whether or not anyone asks for the file again.
 */
export const sweepArtifacts =
()=>{

 if(!fs.existsSync(SOVEREIGN_ARTIFACT_DIR)) return { removed:0 };

 let removed = 0;

 for(const entry of fs.readdirSync(SOVEREIGN_ARTIFACT_DIR)){

  if(entry.endsWith(".meta.json")) continue;

  let meta;

  try{
   meta = JSON.parse(fs.readFileSync(metaPath(entry), "utf8"));
  }catch{
   // No metadata means no known expiry. Left in place rather than deleted --
   // this sweep runs unattended, and deleting a file it cannot account for is
   // the more destructive guess of the two.
   continue;
  }

  if(typeof meta.expiresAt !== "number" || Date.now() <= meta.expiresAt) continue;

  try{

   fs.rmSync(path.join(SOVEREIGN_ARTIFACT_DIR, entry), { force:true });
   fs.rmSync(metaPath(entry), { force:true });

   removed++;

   // Written to the same chain as the decision that created it, so retention is
   // demonstrable rather than asserted: the log shows the artefact arriving and
   // the artefact going.
   audit({

    userId: meta.userId,

    conversationId: meta.conversationId,

    agent: "storage",

    zone: "SOVEREIGN",

    decision: "EXPIRE",

    rule: "SOV-004",

    model: null,

    endpoint: SOVEREIGN_ARTIFACT_DIR

   });

  }catch(error){

   console.error(`[storage] could not expire ${entry}:`, error.message);

  }

 }

 if(removed) console.log(`[storage] expired ${removed} sovereign artefact(s)`);

 return { removed };

};

const SWEEP_INTERVAL_MS =
 15 * 60 * 1000;

/** Started by the service. Separate from the sweep so tests can call it directly. */
export const startArtifactSweeper =
()=>{

 sweepArtifacts();

 const timer =
  setInterval(sweepArtifacts, SWEEP_INTERVAL_MS);

 // Otherwise this keeps the event loop alive and the process will not exit.
 timer.unref();

 return timer;

};
