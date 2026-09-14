import express from "express";
import { createConversation, deleteConversation, getConversations, getMessages, saveMessage, updateConversation } from "../controllers/chat.controller.js";



const router =
express.Router();

router.post("/create-conversation",createConversation);
router.get("/get-conversations",getConversations);
router.post("/update-conversation",updateConversation);
router.post("/save-message",saveMessage);
router.get("/get-messages/:id",getMessages);
router.delete("/delete-conversation/:id",deleteConversation);

export default router;