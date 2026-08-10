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
const port=process.env.PORT

app.use("/",router);

app.use((err, req, res, next) => {

  console.error(err);

  if (err.status) {

    return res
      .status(err.status)
      .json(err.data);

  }

  return res
    .status(500)
    .json({

      success: false,

      message: err.message || "Internal Server Error"

    });

});

app.listen(port, () => {
    connectDB()
  console.log(
    `agent service running on ${port}`
  );
});
