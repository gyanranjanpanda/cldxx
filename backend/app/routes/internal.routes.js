import express from "express";

import {
  updatePlan,
  deductCredits,
  refundCredits
} from "../modules/auth/controllers/auth.controllers.js";

import {
  saveMessage,
  getMessages
} from "../modules/chat/controllers/chat.controller.js";

import {
  getServersForAgent,
  saveServerStatus
} from "../modules/mcp/controllers/mcp.controller.js";

import { getKeysForAgent } from "../modules/keys/controllers/keys.controller.js";

// Service-to-service surface. Only the agent process talks to these, and only
// with the shared key — see middlewares/internal.middleware.js. Everything here
// takes userId in the body rather than from a session, so it must stay private.
const router = express.Router();

router.patch("/deduct-credits", deductCredits);
router.patch("/refund-credits", refundCredits);
router.patch("/update-plan", updatePlan);
router.post("/save-message", saveMessage);
router.get("/get-messages/:id", getMessages);

// The agent needs decrypted MCP credentials to open a connection; that is the
// whole reason this surface is key-gated and sessionless.
const cloudOnly = (handler) => (req, res, next) => {
  if (process.env.SOVEREIGN_ONLY === "true") return res.sendStatus(404);
  return handler(req, res, next);
};
router.get("/mcp-servers/:userId", cloudOnly(getServersForAgent));
router.post("/mcp-status", cloudOnly(saveServerStatus));
router.get("/user-keys/:userId", cloudOnly(getKeysForAgent));

export default router;
