import mongoose from "mongoose";

// Header and env values are secrets (API keys, tokens). They are stored
// encrypted and never travel back to the browser -- see utils/secretBox.js and
// the `toClient` projection in the controller.
const secretSchema = new mongoose.Schema({

  key: {
    type: String,
    required: true,
    trim: true
  },

  value: {
    type: String,
    default: ""
  }

}, { _id: false });

const toolSchema = new mongoose.Schema({

  name: String,

  description: String

}, { _id: false });

const mcpServerSchema = new mongoose.Schema({

  userId: {
    type: String,
    required: true,
    index: true
  },

  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 60
  },

  // "http" is Streamable HTTP, the current remote transport; "sse" is the older
  // one, kept because plenty of deployed servers still only speak it. "stdio"
  // is a local process the agent host spawns.
  transport: {
    type: String,
    enum: ["http", "sse", "stdio"],
    default: "http"
  },

  url: {
    type: String,
    default: "",
    trim: true
  },

  headers: {
    type: [secretSchema],
    default: []
  },

  command: {
    type: String,
    default: "",
    trim: true
  },

  args: {
    type: [String],
    default: []
  },

  env: {
    type: [secretSchema],
    default: []
  },

  // Disabled servers stay configured but are not handed to the model, so a
  // flaky server can be parked without losing its credentials.
  enabled: {
    type: Boolean,
    default: true
  },

  // Written by the health check so the list can show state without reconnecting
  // to every server on each page load.
  status: {

    state: {
      type: String,
      enum: ["unknown", "ok", "error"],
      default: "unknown"
    },

    checkedAt: Date,

    error: String,

    toolCount: {
      type: Number,
      default: 0
    }

  },

  tools: {
    type: [toolSchema],
    default: []
  }

}, { timestamps: true });

// One name per user keeps the tool-name prefixes unambiguous.
mcpServerSchema.index({ userId: 1, name: 1 }, { unique: true });

const McpServer = mongoose.model("McpServer", mcpServerSchema);

export default McpServer;
