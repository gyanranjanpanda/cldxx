import express from "express";

import {
  updatePlan,
  deductCredits
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
router.patch("/update-plan", updatePlan);
router.post("/save-message", saveMessage);
router.get("/get-messages/:id", getMessages);

// The agent needs decrypted MCP credentials to open a connection; that is the
// whole reason this surface is key-gated and sessionless.
router.get("/mcp-servers/:userId", getServersForAgent);
router.post("/mcp-status", saveServerStatus);

// Same reasoning for a user's own provider keys: the agent is the process that
// builds the model client, so it is the only thing that needs them decrypted.
router.get("/user-keys/:userId", getKeysForAgent);

export default router;
