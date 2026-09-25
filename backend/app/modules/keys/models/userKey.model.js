import mongoose from "mongoose";

// A user's own provider key. The secret is stored encrypted and never travels
// back to the browser -- see modules/mcp/utils/secretBox.js and the `toClient`
// projection in the controller. Only the agent service ever reads it back in
// plaintext, over the key-gated internal surface.

// Which providers a user may bring a key for, and what a real key looks like.
// The shape check is a courtesy, not a security control: it catches the paste
// that grabbed the wrong clipboard entry before the user waits for a request to
// fail, and it keeps an obviously-wrong value out of the database.
export const PROVIDERS = {

  groq: {
    label:   "Groq",
    envVar:  "GROQ_API_KEY",
    pattern: /^gsk_[A-Za-z0-9]{20,}$/,
    hint:    "Starts with gsk_ — console.groq.com/keys"
  },

  deepseek: {
    label:   "DeepSeek",
    envVar:  "DEEPSEEK_API_KEY",
    pattern: /^sk-[A-Za-z0-9]{24,}$/,
    hint:    "Starts with sk- — platform.deepseek.com/api_keys"
  },

  google: {
    label:   "Google Gemini",
    envVar:  "GOOGLE_API_KEY",
    pattern: /^AIza[A-Za-z0-9_-]{30,}$/,
    hint:    "Starts with AIza — aistudio.google.com/apikey"
  },

  tavily: {
    label:   "Tavily",
    envVar:  "TAVILY_API_KEY",
    pattern: /^tvly-[A-Za-z0-9_-]{16,}$/,
    hint:    "Starts with tvly- — app.tavily.com"
  }

};

export const isProvider = (value) =>
  Object.prototype.hasOwnProperty.call(PROVIDERS, String(value ?? ""));

const userKeySchema = new mongoose.Schema({

  userId: {
    type: String,
    required: true,
    index: true
  },

  provider: {
    type: String,
    required: true,
    enum: Object.keys(PROVIDERS)
  },

  // Ciphertext, always. A plaintext value here is a bug, so the controller
  // encrypts on the way in rather than trusting the caller.
  key: {
    type: String,
    required: true
  },

  // The last four characters, kept in the clear so the browser can show the
  // user which key is stored without the server ever sending the key back.
  last4: {
    type: String,
    default: ""
  },

  enabled: {
    type: Boolean,
    default: true
  },

  // Result of the most recent live check, so the UI can show "verified" rather
  // than making the user discover a bad key mid-conversation.
  status: {
    state:     { type: String, enum: ["unknown", "ok", "error"], default: "unknown" },
    checkedAt: { type: Date, default: null },
    error:     { type: String, default: "" }
  }

}, { timestamps: true });

// One key per provider per user: pasting a second Groq key replaces the first
// rather than leaving two and making "which one is live?" a coin toss.
userKeySchema.index({ userId: 1, provider: 1 }, { unique: true });

export default mongoose.model("UserKey", userKeySchema);
