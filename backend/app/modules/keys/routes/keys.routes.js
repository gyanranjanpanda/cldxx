import express from "express";

import {
  listProviders,
  listKeys,
  saveKey,
  toggleKey,
  deleteKey
} from "../controllers/keys.controller.js";

const router = express.Router();

router.get("/providers", listProviders);
router.get("/", listKeys);
router.put("/:provider", saveKey);
router.patch("/:provider/toggle", toggleKey);
router.delete("/:provider", deleteKey);

export default router;
