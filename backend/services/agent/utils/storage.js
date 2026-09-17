import fs from "fs";
import path from "path";
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

export const SOVEREIGN_ARTIFACT_DIR =
 process.env.SOVEREIGN_ARTIFACT_DIR ||
 path.join(process.cwd(), "artifacts");

// Callers pass a generated name, but a traversal in it would let a document be
// written outside the artefact directory. Only the basename is ever used.
const safeName =
(fileName)=>
 path.basename(String(fileName));

export const storeArtifact =
async(buffer, fileName, contentType, state = {})=>{

 const sovereign =
  state.sovereign === true;

 if(sovereign){

  const name = safeName(fileName);

  fs.mkdirSync(
   SOVEREIGN_ARTIFACT_DIR,
   { recursive:true }
  );

  fs.writeFileSync(
   path.join(SOVEREIGN_ARTIFACT_DIR, name),
   buffer
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

  return `${base}/artifacts/${encodeURIComponent(name)}`;

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
