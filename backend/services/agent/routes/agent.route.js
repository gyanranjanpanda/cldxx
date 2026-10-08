import express from "express";
import { chat } from "../controllers/agent.controller.js";
import { health } from "../controllers/mcp.controller.js";
import { generate, status } from "../controllers/image.controller.js";
import multer from "../config/multer.js";
import { requireGateway } from "../middlewares/requireGateway.js";



const router =
express.Router();

// Identity arrives as a header, so every route here has to prove it came
// through the app rather than straight off the network.
router.use(requireGateway);

router.post(
 "/chat",
 multer.single("file"),
 chat
);

// Reached from the browser as /api/agent/mcp/health -- the app proxies this
// path through with the caller's identity headers attached.
router.post(
 "/mcp/health",
 express.json(),
 health
);

// Z-Image Turbo on the user's own ComfyUI. Split in two because a generation
// takes 30-90s on a T4: /generate queues and answers with the prompt id, and
// /status collects the picture once the GPU is done. Neither request waits on
// the GPU, so nothing here can be killed by a proxy or function timeout.
router.post(
 "/image/generate",
 express.json(),
 generate
);

router.get(
 "/image/status/:promptId",
 status
);

export default router;
