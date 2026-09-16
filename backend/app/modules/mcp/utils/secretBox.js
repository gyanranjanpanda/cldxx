import crypto from "crypto";

// MCP headers hold bearer tokens and API keys. They have to come back out in
// plaintext for the agent to use, so this is reversible encryption rather than
// hashing -- the point is that a dump of the collection is not a pile of live
// credentials.
const ALGORITHM = "aes-256-gcm";
const PREFIX    = "enc:v1:";

// Falling back to INTERNAL_API_KEY keeps this working on an existing .env.
// Rotating either value makes previously stored secrets undecryptable, which is
// why a failed decrypt returns "" instead of throwing.
const keyMaterial = () =>
  process.env.MCP_SECRET ||
  process.env.INTERNAL_API_KEY ||
  "";

const derivedKey = () =>
  crypto.createHash("sha256").update(keyMaterial()).digest();

export const isEncrypted = (value) =>
  typeof value === "string" && value.startsWith(PREFIX);

export const encryptSecret = (plain) => {

  if (!plain) return "";
  if (isEncrypted(plain)) return plain;

  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, derivedKey(), iv);

  const ciphertext = Buffer.concat([
    cipher.update(String(plain), "utf8"),
    cipher.final()
  ]);

  return PREFIX + [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64")
  ].join(":");

};

export const decryptSecret = (stored) => {

  if (!stored) return "";
  // Anything written before encryption was added is still readable as-is.
  if (!isEncrypted(stored)) return stored;

  try {

    const [ivB64, tagB64, dataB64] = stored.slice(PREFIX.length).split(":");

    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      derivedKey(),
      Buffer.from(ivB64, "base64")
    );

    decipher.setAuthTag(Buffer.from(tagB64, "base64"));

    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final()
    ]).toString("utf8");

  } catch {

    // Wrong key or tampered ciphertext. An empty value fails the MCP call with
    // a clear auth error rather than taking the whole request down.
    return "";

  }

};

export const encryptPairs = (pairs = []) =>
  pairs
    .filter((pair) => pair?.key)
    .map((pair) => ({
      key: String(pair.key).trim(),
      value: encryptSecret(pair.value)
    }));

export const decryptPairs = (pairs = []) =>
  pairs.map((pair) => ({
    key: pair.key,
    value: decryptSecret(pair.value)
  }));

// What the browser is allowed to see: the names of the secrets, never the
// values, plus whether a value is actually set.
export const maskPairs = (pairs = []) =>
  pairs.map((pair) => ({
    key: pair.key,
    hasValue: Boolean(pair.value)
  }));
