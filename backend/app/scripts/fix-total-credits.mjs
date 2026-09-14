// One-off migration.
//
// Free accounts created before the model's totalCredits default was raised to
// 1000 still carry the old value of 100, so the billing UI divides by 100 and
// reports well over 100% remaining (e.g. "990 / 100").
//
// Paid tiers are left alone -- their totalCredits are real purchased
// allowances, not a stale default.
//
// Run from backend/app:  node scripts/fix-total-credits.mjs

import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

await mongoose.connect(process.env.MONGODB_URL);
const users = mongoose.connection.db.collection("users");

const show = async (label) => {
  console.log(`\n--- ${label} ---`);
  const rows = await users
    .find({}, { projection: { email: 1, plan: 1, credits: 1, totalCredits: 1 } })
    .toArray();
  for (const u of rows) {
    console.log(
      `  ${(u.email || "?").padEnd(52)} plan=${(u.plan || "?").padEnd(8)} ${u.credits}/${u.totalCredits}`
    );
  }
};

await show("BEFORE");

const result = await users.updateMany(
  { plan: "free", totalCredits: 100 },
  { $set: { totalCredits: 1000 } }
);

console.log(`\nmigrated ${result.modifiedCount} free account(s): totalCredits 100 -> 1000`);

await show("AFTER");
await mongoose.disconnect();
