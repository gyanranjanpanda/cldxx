import express from "express";

import {
 login,
 localLogin,
 logout
}
from "../controllers/auth.controllers.js";

const router =
express.Router();

router.post("/login",login);
router.post("/local-login", localLogin);
router.get("/logout",logout);

// update-plan / deduct-credits moved to app/routes/internal.routes.js —
// they mutate plans and credits and must never be reachable from the browser.

export default router;
