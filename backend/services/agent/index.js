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
import { SOVEREIGN_ARTIFACT_DIR } from "./utils/storage.js";
const app = express();
app.use(express.json());
app.get("/", (req, res) => {
  res.status(200).json({ service: "agent", status: "ok" });
});
const port = Number(process.env.PORT) || 8003;

// Sovereign artefacts never reach S3, so this service serves them itself.
// Mounted before the gateway-guarded router because a download is followed by
// the browser, which cannot attach the internal identity header.
app.use(
  "/artifacts",
  express.static(SOVEREIGN_ARTIFACT_DIR)
);

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

console.log("Agent starting on port:", port);
app.listen(port, "0.0.0.0", () => {
  connectDB();
  console.log(
    `agent service running on ${port}`
  );
});
