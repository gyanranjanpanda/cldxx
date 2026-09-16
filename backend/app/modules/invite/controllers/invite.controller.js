import crypto from "crypto";
import axios from "axios";
import Invite from "../models/invite.model.js";
import Conversation from "../../chat/models/conversation.model.js";
import Message from "../../chat/models/message.model.js";

const AGENT_SERVICE = () => process.env.AGENT_SERVICE || "http://127.0.0.1:8003";

const MAX_TTL_HOURS = 24 * 30;
const MAX_LINKS_PER_CONVERSATION = 10;

// 32 bytes of randomness, url-safe: the link is the only credential, so it has
// to be unguessable rather than merely unique.
const mintToken = () => crypto.randomBytes(32).toString("base64url");

const hashToken = (token) =>
  crypto.createHash("sha256").update(String(token)).digest("hex");

// What the owner sees. Never includes the token -- that exists once, in the
// creation response, and is not recoverable afterwards.
const toOwnerView = (invite) => ({
  _id:               invite._id,
  conversationId:    invite.conversationId,
  label:             invite.label,
  mode:              invite.mode,
  expiresAt:         invite.expiresAt,
  revokedAt:         invite.revokedAt,
  maxGuestMessages:  invite.maxGuestMessages,
  guestMessageCount: invite.guestMessageCount,
  useCount:          invite.useCount,
  lastUsedAt:        invite.lastUsedAt,
  createdAt:         invite.createdAt,
  active:            !invite.revokedAt && invite.expiresAt.getTime() > Date.now()
});

/* ── Owner side ──────────────────────────────────────────────────────────── */

export const createInvite = async (req, res) => {

  try {

    const ownerId = req.headers["x-user-id"];
    const { conversationId, mode = "read", ttlHours = 24, maxGuestMessages = 20, label = "" } = req.body;

    // Ownership is checked here rather than trusting the id in the body --
    // otherwise anyone could mint a link to someone else's conversation.
    const conversation = await Conversation.findOne({ _id: conversationId, userId: ownerId });

    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    if (!["read", "reply"].includes(mode)) {
      return res.status(400).json({ success: false, message: "Unknown share mode" });
    }

    const hours = Number(ttlHours);

    if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_TTL_HOURS) {
      return res.status(400).json({ success: false, message: "Choose an expiry between 1 hour and 30 days" });
    }

    const live = await Invite.countDocuments({
      conversationId,
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date() }
    });

    if (live >= MAX_LINKS_PER_CONVERSATION) {
      return res.status(400).json({
        success: false,
        message: `This conversation already has ${MAX_LINKS_PER_CONVERSATION} active links. Revoke one first.`
      });
    }

    const token = mintToken();

    const invite = await Invite.create({
      conversationId,
      ownerId,
      tokenHash: hashToken(token),
      label: String(label).slice(0, 60),
      mode,
      expiresAt: new Date(Date.now() + hours * 3600_000),
      maxGuestMessages: mode === "reply" ? Math.max(0, Math.min(200, Number(maxGuestMessages) || 0)) : 0
    });

    res.json({
      success: true,
      invite: toOwnerView(invite),
      // Shown once. There is no endpoint that returns it again.
      token
    });

  } catch (error) {

    res.status(500).json({ success: false, message: error.message });

  }

};

export const listInvites = async (req, res) => {

  try {

    const ownerId = req.headers["x-user-id"];

    const invites = await Invite
      .find({ conversationId: req.params.conversationId, ownerId })
      .sort({ createdAt: -1 });

    res.json({ success: true, invites: invites.map(toOwnerView) });

  } catch (error) {

    res.status(500).json({ success: false, message: error.message });

  }

};

export const revokeInvite = async (req, res) => {

  try {

    const ownerId = req.headers["x-user-id"];

    const invite = await Invite.findOneAndUpdate(
      { _id: req.params.id, ownerId },
      { revokedAt: new Date() },
      { new: true }
    );

    if (!invite) {
      return res.status(404).json({ success: false, message: "Link not found" });
    }

    res.json({ success: true, invite: toOwnerView(invite) });

  } catch (error) {

    res.status(500).json({ success: false, message: error.message });

  }

};

/* ── Guest side: no session, the token in the URL is the whole credential ── */

// Every guest route resolves the token the same way, so expiry and revocation
// cannot be enforced in one place and forgotten in another.
const resolveInvite = async (token) => {

  if (!token || token.length < 20) return { error: "invalid" };

  const invite = await Invite.findOne({ tokenHash: hashToken(token) });

  if (!invite) return { error: "invalid" };

  const problem = invite.isUsable();

  if (problem) return { error: problem, invite };

  return { invite };

};

const guestError = (res, reason) => {

  const messages = {
    invalid: "This link is not valid.",
    expired: "This link has expired.",
    revoked: "This link was revoked by its owner."
  };

  return res.status(reason === "invalid" ? 404 : 410).json({
    success: false,
    reason,
    message: messages[reason] || messages.invalid
  });

};

export const getSharedConversation = async (req, res) => {

  try {

    const { invite, error } = await resolveInvite(req.params.token);

    if (error) return guestError(res, error);

    const conversation = await Conversation.findById(invite.conversationId);

    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation no longer exists" });
    }

    const messages = await Message
      .find({ conversationId: invite.conversationId })
      .sort({ createdAt: 1 });

    invite.useCount += 1;
    invite.lastUsedAt = new Date();
    await invite.save();

    res.json({
      success: true,
      // Deliberately narrow: the title and the turns of this one conversation.
      // No owner identity, no other conversations, no account state.
      conversation: {
        _id:   conversation._id,
        title: conversation.title
      },
      messages: messages.map((message) => ({
        role:      message.role,
        content:   message.content,
        images:    message.images,
        artifacts: message.artifacts,
        guest:     message.guest || false,
        createdAt: message.createdAt
      })),
      access: {
        mode:      invite.mode,
        expiresAt: invite.expiresAt,
        repliesLeft: invite.mode === "reply"
          ? Math.max(0, invite.maxGuestMessages - invite.guestMessageCount)
          : 0
      }
    });

  } catch (error) {

    res.status(500).json({ success: false, message: error.message });

  }

};

export const postSharedMessage = async (req, res) => {

  try {

    const { invite, error } = await resolveInvite(req.params.token);

    if (error) return guestError(res, error);

    if (invite.mode !== "reply") {
      return res.status(403).json({ success: false, message: "This link is read-only." });
    }

    const prompt = String(req.body?.prompt || "").trim();

    if (!prompt) {
      return res.status(400).json({ success: false, message: "Write a message first" });
    }

    if (prompt.length > 4000) {
      return res.status(400).json({ success: false, message: "Message is too long" });
    }

    if (invite.guestMessageCount >= invite.maxGuestMessages) {
      return res.status(429).json({
        success: false,
        message: "This link has used up its reply allowance."
      });
    }

    // Counted before the call, not after: two guests pressing send at the same
    // moment would otherwise both pass the check and both spend credits.
    const claimed = await Invite.findOneAndUpdate(
      {
        _id: invite._id,
        revokedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
        $expr: { $lt: ["$guestMessageCount", "$maxGuestMessages"] }
      },
      { $inc: { guestMessageCount: 1 }, lastUsedAt: new Date() },
      { new: true }
    );

    if (!claimed) {
      return res.status(429).json({ success: false, message: "This link has used up its reply allowance." });
    }

    // The agent bills whoever owns the conversation. A guest never has an
    // account, so the owner's credits pay for the link they handed out -- which
    // is why the allowance above exists.
    const { data } = await axios.post(
      `${AGENT_SERVICE()}/chat`,
      {
        conversationId: String(invite.conversationId),
        prompt,
        // Guests get plain chat only. The heavy agents -- image, pdf, ppt,
        // coding -- are the expensive ones, and a share link is not the place
        // to spend someone's balance on them.
        agent: "chat",
        timezone: req.body?.timezone || "UTC",
        guest: true
      },
      {
        headers: {
          "x-user-id": invite.ownerId,
          "x-internal-key": process.env.INTERNAL_API_KEY || ""
        },
        timeout: 120_000
      }
    );

    // The guest's own turn is marked so the owner can see who said what.
    await Message.findOneAndUpdate(
      { conversationId: invite.conversationId, role: "user", content: prompt },
      { guest: true },
      { sort: { createdAt: -1 } }
    );

    res.json({
      success: true,
      answer: data?.answer,
      images: data?.images || [],
      artifacts: data?.artifacts || [],
      repliesLeft: Math.max(0, claimed.maxGuestMessages - claimed.guestMessageCount)
    });

  } catch (error) {

    const status = error.response?.status || 500;

    res.status(status).json({
      success: false,
      message: error.response?.data?.message || error.message
    });

  }

};
