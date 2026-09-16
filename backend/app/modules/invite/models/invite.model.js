import mongoose from "mongoose";

// A share link to ONE conversation. The link is the credential, so what is
// stored is a hash of it: a dump of this collection must not hand anyone
// access to the conversations it describes.
const inviteSchema = new mongoose.Schema({

  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Conversation",
    required: true,
    index: true
  },

  ownerId: {
    type: String,
    required: true,
    index: true
  },

  // sha256 of the raw token. The raw value is returned once, at creation, and
  // never again -- there is nothing to leak later.
  tokenHash: {
    type: String,
    required: true,
    unique: true
  },

  // Shown in the owner's list so a link is recognisable without the token.
  label: {
    type: String,
    default: ""
  },

  // "read" is the default because a reply spends the owner's credits.
  mode: {
    type: String,
    enum: ["read", "reply"],
    default: "read"
  },

  expiresAt: {
    type: Date,
    required: true
  },

  revokedAt: Date,

  // A guest who can reply can spend the owner's credits, so every link carries
  // its own budget. Reaching it stops replies; reading still works.
  maxGuestMessages: {
    type: Number,
    default: 20,
    min: 0,
    max: 200
  },

  guestMessageCount: {
    type: Number,
    default: 0
  },

  lastUsedAt: Date,

  useCount: {
    type: Number,
    default: 0
  }

}, { timestamps: true });

// Mongo drops expired invites on its own, so a forgotten link cannot sit
// around being valid because nothing swept it.
inviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

inviteSchema.methods.isUsable = function isUsable() {

  if (this.revokedAt) return "revoked";
  if (this.expiresAt.getTime() <= Date.now()) return "expired";

  return null;

};

const Invite = mongoose.model("Invite", inviteSchema);

export default Invite;
