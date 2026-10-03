import dotenv from "dotenv";
dotenv.config();

if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {};
}
if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {};
}
if (typeof globalThis.Path2D === 'undefined') {
  globalThis.Path2D = class Path2D {};
}

import express from "express";
import connectDB from "./config/db.js";
import router from "./routes/agent.route.js";
import { readArtifact, startArtifactSweeper } from "./utils/storage.js";
const app = express();
app.use(express.json());
app.get("/", (req, res) => {
  res.status(200).json({ service: "agent", status: "ok" });
});
const port = Number(process.env.PORT) || 8003;

// Sovereign artefacts never reach S3, so this service serves them itself.
// Mounted before the gateway-guarded router because a download is followed by
// the browser, which cannot attach the internal identity header -- which is why
// the unguessable path is the credential, the same bargain a presigned URL
// makes.
//
// A handler rather than express.static: static has no notion of a retention
// window, and would keep serving a document long after the deployment promised
// it was gone.
app.get("/artifacts/:name", (req, res) => {

  // Set by the gateway's proxy decorator, which strips any client-supplied
  // copy first. Its absence means the request did not come through the
  // gateway, so there is no identity to check the artefact against -- refused
  // rather than served, because the alternative is that anyone who can reach
  // this port downloads anything they have a link to.
  const requester = req.headers["x-user-id"];

  const found = readArtifact(req.params.name);

  if (found.ok && found.userId && found.userId !== requester) {

    // 404 rather than 403: a 403 would confirm that this exact artefact exists,
    // which is the one thing the random name is meant not to reveal.
    return res.status(404).json({ message: "Not found" });

  }

  if (!found.ok) {

    return res
      .status(found.status)
      .json({
        message: found.status === 410
          ? "This artefact has passed its retention window and is no longer available."
          : "Not found"
      });

  }

  // no-store because a shared proxy caching a sovereign document would put a
  // copy outside the boundary, which is the whole thing this path avoids.
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Content-Type", found.contentType);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${found.downloadName.replace(/["\\]/g, "")}"`
  );

  res.sendFile(found.file);

});

app.use("/",router);

app.use((err, req, res, next) => {

  console.error(err);

  // A policy refusal is a decision, not a fault. 403 keeps it out of the error
  // budget and tells the browser it is safe to show the reason verbatim.
  if (err.isPolicyDenial) {

    return res
      .status(403)
      .json({
        success: false,
        policy: true,
        rule: err.rule,
        message: err.message
      });

  }

  if (err.status) {

    // Axios rejections carry a `status` but no `data` in the shape the credit
    // errors use, so this used to answer with an empty body -- the browser saw
    // a failed request it could not explain. Always send something readable.
    return res
      .status(err.status)
      .json(err.data ?? {
        success: false,
        message: err.message || "Request failed"
      });

  }

  return res
    .status(500)
    .json({

      success: false,

      message: err.message || "Internal Server Error"

    });

});

import { warmProvenance } from "./utils/provenance.js";

// Awaited before the port opens, not inside the listen callback. getModel is
// synchronous and reads this cache, so a request that arrived while the read was
// still in flight would be audited with a null digest -- and if a digest is
// pinned it would be refused outright under SOV-008. Milliseconds at startup buy
// the guarantee that neither can happen.
await warmProvenance();

console.log("Agent starting on port:", port);
app.listen(port, "0.0.0.0", () => {
  connectDB();
  // Read once, at startup, so the digest of the weights that answer is already
  // known when a turn needs to record it -- getModel is synchronous and cannot
  // wait on the runtime mid-request.
  // Retention is a promise, so something has to enforce it whether or not
  // anyone asks for the file again.
  startArtifactSweeper();
  console.log(
    `agent service running on ${port}`
  );
});
