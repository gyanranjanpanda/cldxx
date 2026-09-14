import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import connectDB from "./config/db.js";
import { protect } from "./middlewares/auth.middleware.js";
import { injectUser } from "./middlewares/injectUser.js";
import { requireInternalKey } from "./middlewares/internal.middleware.js";
import { getCurrentUser } from "./controllers/user.controller.js";
import { proxyWithUser } from "./utils/proxyWithHeaders.js";

import authRouter from "./modules/auth/routes/auth.routes.js";
import chatRouter from "./modules/chat/routes/chat.routes.js";
import billingRouter from "./modules/billing/routes/billing.routes.js";
import internalRouter from "./routes/internal.routes.js";
import speechRouter from "./modules/speech/routes/speech.routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config();

const AGENT_SERVICE = process.env.AGENT_SERVICE || "http://127.0.0.1:8003";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

const app = express();
const port = Number(process.env.PORT) || 8000;

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(helmet());
app.use(morgan("dev"));
app.use(cookieParser());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// The agent proxy has to see the raw stream, so JSON parsing is mounted per
// route rather than globally — parsing the body here would leave the proxied
// request hanging with nothing left to forward.
const json = express.json();

app.get("/", (req, res) => {
  res.status(200).json({ service: "cldx-app", status: "ok" });
});

app.use("/api/auth", json, authRouter);
app.use("/api/me", protect, getCurrentUser);
app.use("/api/chat", protect, injectUser, json, chatRouter);
app.use("/api/billing", protect, injectUser, json, billingRouter);

// No `json` here: the body is a raw audio blob, parsed inside the route.
app.use("/api/speech", protect, speechRouter);

// Agent stays a separate process: puppeteer, langchain and the exporters have a
// different memory/CPU profile and much slower deploys than the CRUD above.
app.use("/api/agent", protect, proxyWithUser(AGENT_SERVICE));

app.use("/internal", requireInternalKey, json, internalRouter);

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error"
  });
});

const start = async () => {
  try {
    await connectDB();
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error.message);
  }

  app.listen(port, "0.0.0.0", () => {
    console.log(`cldx app running on ${port}`);
  });
};

start();
