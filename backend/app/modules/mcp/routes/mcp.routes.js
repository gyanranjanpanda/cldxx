import express from "express";
import {
  listServers,
  createServer,
  updateServer,
  toggleServer,
  deleteServer
} from "../controllers/mcp.controller.js";

const router = express.Router();

router.get("/servers", listServers);
router.post("/servers", createServer);
router.put("/servers/:id", updateServer);
router.patch("/servers/:id/toggle", toggleServer);
router.delete("/servers/:id", deleteServer);

export default router;
