import express from "express";
import { transcribe } from "../controllers/speech.controller.js";

const router = express.Router();

// Raw body rather than multer: the browser posts a single audio blob with no
// other fields, so there is no multipart to parse and no dependency to add.
router.post(
  "/transcribe",
  express.raw({ type: ["audio/*", "video/webm"], limit: "25mb" }),
  transcribe
);

export default router;
