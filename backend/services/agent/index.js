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
const app = express();
app.use(express.json());
app.get("/", (req, res) => {
  res.status(200).json({ service: "agent", status: "ok" });
});
const port = Number(process.env.PORT) || 8003;

app.use("/",router);

app.use((err, req, res, next) => {

  console.error(err);

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
