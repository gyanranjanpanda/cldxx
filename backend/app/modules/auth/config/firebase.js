import { initializeApp, cert } from "firebase-admin/app";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let serviceAccount = null;

// Cloud Run: secret is mounted as an env var via --set-secrets.
// This is checked first so the image never needs the file on disk.
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (e) {
    console.warn("⚠️ FIREBASE_SERVICE_ACCOUNT env var is not valid JSON:", e.message);
  }
}

// Local dev fallback: read from the JSON file beside this config.
if (!serviceAccount) {
  try {
    const saPath = path.join(__dirname, "../serviceAccount.json");
    if (fs.existsSync(saPath)) {
      serviceAccount = JSON.parse(fs.readFileSync(saPath, "utf-8"));
    }
  } catch (e) {}
}

let app = null;
try {
  if (serviceAccount?.project_id) {
    app = initializeApp({ credential: cert(serviceAccount) });
  } else {
    console.warn("⚠️ Firebase Admin: no valid service account found (env var or serviceAccount.json).");
  }
} catch (err) {
  console.warn("⚠️ Firebase Admin initialization failed:", err.message);
}

export { app };
