import { initializeApp, cert } from "firebase-admin/app";

import serviceAccount from "../serviceAccount.json" with { type: "json" };

let app;
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