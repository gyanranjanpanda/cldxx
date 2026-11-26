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
const cloudMcpOnly = (_req, res, next) => {
  if (process.env.SOVEREIGN_ONLY === "true") return res.sendStatus(404);
  next();
};
router.get("/providers", cloudMcpOnly, listMcpProviders);
router.get("/oauth/:provider/start", cloudMcpOnly, startMcpOAuth);
router.get("/oauth/:provider/callback", cloudMcpOnly, mcpOAuthCallback);

export default router;
