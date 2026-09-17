import fs from "fs";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();

// Every routing decision is recorded, because for a regulated buyer the
// evidence that a request went where policy said it should is worth more than
// the routing itself. Entries are hash-chained: each one carries the hash of
// the one before it, so a deleted or edited line breaks the chain and the
// tampering is detectable even by someone who can write to the file.

const AUDIT_PATH =
 process.env.AUDIT_LOG_PATH ||
 path.join(process.cwd(), "audit", "decisions.log");

// The log sits at a lower protection level than the conversation it describes,
// so it records a hash of the prompt and never the prompt itself. Writing the
// text here would turn the audit trail into its own disclosure.
const digest =
(value)=>
 crypto
  .createHash("sha256")
  .update(String(value ?? ""))
  .digest("hex");

let previousHash = null;

// The chain has to continue across restarts, so the tail of the existing file
// seeds it. Starting from null every boot would silently fork the chain and
// make every earlier entry unverifiable.
const loadTail =
()=>{

 try{

  const lines =
  fs
   .readFileSync(AUDIT_PATH, "utf8")
   .trim()
   .split("\n")
   .filter(Boolean);

  if(!lines.length) return null;

  return JSON.parse(
   lines[lines.length - 1]
  ).hash;

 }catch{

  return null;

 }

};

export const audit =
(entry)=>{

 try{

  if(previousHash === null){

   previousHash = loadTail();

  }

  const body = {

   at: new Date().toISOString(),

   userId: entry.userId ?? null,

   conversationId: entry.conversationId ?? null,

   agent: entry.agent ?? null,

   zone: entry.zone,

   model: entry.model ?? null,

   endpoint: entry.endpoint ?? null,

   decision: entry.decision,

   rule: entry.rule ?? null,

   promptHash: digest(entry.prompt),

   prev: previousHash

  };

  const hash =
  digest(
   JSON.stringify(body)
  );

  const record = { ...body, hash };

  fs.mkdirSync(
   path.dirname(AUDIT_PATH),
   { recursive:true }
  );

  fs.appendFileSync(
   AUDIT_PATH,
   JSON.stringify(record) + "\n"
  );

  previousHash = hash;

 }catch(error){

  // A failed write must not take the turn down with it, but it cannot pass
  // unnoticed either -- an unlogged decision is the one an auditor will ask
  // about.
  console.error("[audit] failed to record decision:", error.message);

 }

};

// Walks the chain and reports the first line whose recorded hash does not match
// its contents. This is what an organisation runs to prove the log is intact;
// without it the chain is just decoration.
export const verifyAuditChain =
(filePath = AUDIT_PATH)=>{

 const lines =
 fs
  .readFileSync(filePath, "utf8")
  .trim()
  .split("\n")
  .filter(Boolean);

 let prev = null;

 for(let i = 0; i < lines.length; i++){

  const { hash, ...body } = JSON.parse(lines[i]);

  if(body.prev !== prev){

   return { ok:false, line:i + 1, reason:"broken link" };

  }

  if(digest(JSON.stringify(body)) !== hash){

   return { ok:false, line:i + 1, reason:"contents altered" };

  }

  prev = hash;

 }

 return { ok:true, entries:lines.length };

};
