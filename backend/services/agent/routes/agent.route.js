import express from "express";
import { chat } from "../controllers/agent.controller.js";
import { health } from "../controllers/mcp.controller.js";
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

export default router;