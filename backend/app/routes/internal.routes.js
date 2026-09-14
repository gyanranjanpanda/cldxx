import express from "express";

import {
  updatePlan,
  deductCredits
} from "../modules/auth/controllers/auth.controllers.js";

import {
  saveMessage,
  getMessages
} from "../modules/chat/controllers/chat.controller.js";

// Service-to-service surface. Only the agent process talks to these, and only
// with the shared key — see middlewares/internal.middleware.js. Everything here
// takes userId in the body rather than from a session, so it must stay private.
const router = express.Router();

router.patch("/deduct-credits", deductCredits);
router.patch("/update-plan", updatePlan);
router.post("/save-message", saveMessage);
router.get("/get-messages/:id", getMessages);

export default router;
