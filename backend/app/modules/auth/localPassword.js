import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const hashLocalPassword = (password) => {
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("Local password must contain at least 8 characters");
  }
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
};

export const verifyLocalPassword = (password, encoded) => {
  if (typeof password !== "string" || typeof encoded !== "string") return false;
  const [salt, hex, extra] = encoded.split(":");
  if (extra || !/^[a-f0-9]{32}$/.test(salt || "") || !/^[a-f0-9]{128}$/.test(hex || "")) return false;
  const actual = scryptSync(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(hex, "hex"));
};
