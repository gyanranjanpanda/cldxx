import express from "express";
import {
  listServers,
  createServer,
  updateServer,
  toggleServer,
  deleteServer,
  listMcpProviders,
  startMcpOAuth,
  mcpOAuthCallback
} from "../controllers/mcp.controller.js";

const router = express.Router();

router.get("/servers", listServers);
router.post("/servers", createServer);
router.put("/servers/:id", updateServer);
router.patch("/servers/:id/toggle", toggleServer);
router.delete("/servers/:id", deleteServer);
router.get("/providers", listMcpProviders);
router.get("/oauth/:provider/start", startMcpOAuth);
router.get("/oauth/:provider/callback", mcpOAuthCallback);

export default router;
