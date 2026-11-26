import express from "express";
import { createConversation, deleteConversation, getConversations, getOwnedMessages, renameConversation, saveMessage, searchSavedChats, updateConversation } from "../controllers/chat.controller.js";



const router =
express.Router();

router.post("/create-conversation",createConversation);
router.get("/get-conversations",getConversations);
router.post("/search-saved-chats", searchSavedChats);
router.post("/update-conversation",updateConversation);
router.patch("/conversations/:id/title", renameConversation);
router.post("/save-message",saveMessage);
router.get("/get-messages/:id",getOwnedMessages);
router.delete("/delete-conversation/:id",deleteConversation);

export default router;
