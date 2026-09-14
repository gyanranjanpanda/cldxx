import { initializeApp, cert } from "firebase-admin/app";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let serviceAccount = null;
try {
  const saPath = path.join(__dirname, "../serviceAccount.json");
  if (fs.existsSync(saPath)) {
    serviceAccount = JSON.parse(fs.readFileSync(saPath, "utf-8"));
  }
} catch (e) {}

let app = null;
try {
  if (serviceAccount && serviceAccount.project_id) {
    app = initializeApp({
      credential: cert(serviceAccount),
    });
  } else {
    console.warn("⚠️ Firebase serviceAccount.json is not configured with a valid project_id.");
  }
} catch (err) {
  console.warn("⚠️ Firebase Admin initialization failed:", err.message);
}

export { app };