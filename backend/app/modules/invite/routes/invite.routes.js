import express from "express";
import {
  createInvite,
  listInvites,
  revokeInvite
} from "../controllers/invite.controller.js";

// Owner-only. Mounted behind the session guard.
const router = express.Router();

router.post("/", createInvite);
router.get("/conversation/:conversationId", listInvites);
router.delete("/:id", revokeInvite);

export default router;
