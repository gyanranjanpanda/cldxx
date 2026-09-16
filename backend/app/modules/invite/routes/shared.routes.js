import express from "express";
import {
  getSharedConversation,
  postSharedMessage
} from "../controllers/invite.controller.js";
import { guestRateLimit } from "../../../middlewares/guestRateLimit.js";

// Guest surface: no session, no cookies, no account. The token in the path is
// the entire credential, so these routes stay deliberately tiny -- read one
// conversation, and (if the link allows) add one message to it.
const router = express.Router();

router.get("/:token", guestRateLimit("read", 60), getSharedConversation);
router.post("/:token/message", guestRateLimit("write", 10), postSharedMessage);

export default router;
