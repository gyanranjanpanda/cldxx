import mongoose from "mongoose";

import Conversation from "../models/conversation.model.js";
import Message from "../models/message.model.js";

import {
  storeFor,
  sovereignModels,
  sovereignStoreConfigured,
  RESTRICTED_TITLE
} from "../../../db/sovereignStore.js";

import { resolveSovereign } from "../../../../shared/zone/zone.js";

// A conversation lives in exactly one store: the cloud database, or the
// on-premises one when the turn that created it was sovereign and a sovereign
// store is configured. Reads therefore look in both and merge; writes pick one
// and never the other.
//
// req.sovereignPolicy is put there by withSovereignPolicy, from the user's
// record -- so a client cannot talk its way into the wrong store by sending a
// flag, any more than it can choose which model answers.

const zoneOf = (req) =>
  resolveSovereign(
    req.sovereignPolicy,
    req.body?.sovereign ?? req.query?.sovereign
  ).sovereign;

export const createConversation = async (req, res) => {

  try {

    const userId    = req.headers["x-user-id"];
    const sovereign = zoneOf(req);

    const store = storeFor(sovereign);

    // A sovereign turn with nowhere in-boundary to write is not an error: the
    // conversation is simply not persisted and lives for the session only.
    // Handing back an id anyway keeps every caller identical either way.
    if (!store) {

      return res.json({
        _id: new Conversation()._id,
        userId,
        title: RESTRICTED_TITLE,
        ephemeral: true,
        sovereign: true
      });

    }

    const conversation = await store.Conversation.create({ userId });

    res.json({ ...conversation.toObject(), sovereign });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

};

export const getConversations = async (req, res) => {

  try {

    const userId = req.headers["x-user-id"];

    const cloud = await Conversation.find({ userId })
      .sort({ updatedAt: -1 })
      .lean();

    const restricted = sovereignStoreConfigured()
      ? await sovereignModels().Conversation.find({ userId })
          .sort({ updatedAt: -1 })
          .lean()
      : [];

    // Merged rather than concatenated: the two stores interleave in time, and
    // the sidebar is ordered by recency, not by where a row happens to live.
    const conversations = [
      ...cloud,
      ...restricted.map((c) => ({ ...c, sovereign: true }))
    ].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    res.json(conversations);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

};

export const saveMessage = async (req, res) => {

  try {

    const {
      conversationId,
      role,
      content,
      images,
      artifacts,
      // Sent by the agent, the only caller of this route and the one process
      // that knows which zone the turn actually ran in. Never read from a
      // browser request.
      sovereign
    } = req.body;

    const store = storeFor(sovereign === true);

    // Nowhere in-boundary to write it, so it is not written. The agent has
    // already kept it in the restricted Redis tier, so the conversation still
    // works for the rest of the session.
    if (!store) {
      return res.json({ persisted: false, reason: "no sovereign store configured" });
    }

    const message = await store.Message.create({
      conversationId,
      role,
      images,
      content,
      artifacts: artifacts || []
    });

    // Keeps the sidebar ordered by real activity rather than by creation.
    await store.Conversation.findByIdAndUpdate(conversationId, { updatedAt: new Date() });

    res.json(message);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

};

/**
 * Two very different callers share this handler, and they are allowed to see
 * different things:
 *
 *   zone=cloud      only the cloud store. This is what the agent uses to warm
 *                   the cloud half of its conversation cache, and it must not
 *                   return restricted turns -- a cloud model would then read
 *                   them as context.
 *   zone=sovereign  only the sovereign store, for the restricted half.
 *   (absent)        both, merged. The browser display path: the user reading
 *                   their own conversation on their own device.
 *
 * Defaulting to merged is deliberate -- the browser sends no zone -- but it is
 * exactly why the agent has to ask for one. It did not, once, and a cold cache
 * pulled restricted turns into the cloud tier.
 */
export const getMessages = async (req, res) => {

  try {

    const id   = req.params.id;
    const zone = req.query?.zone;

    // A malformed id makes the driver throw rather than return nothing, and
    // that 500 travels back through the agent's history fetch and takes the
    // whole turn down. An id that cannot name a conversation simply has no
    // history.
    if (!mongoose.isValidObjectId(id)) return res.json([]);

    const cloud = zone === "sovereign"
      ? []
      : await Message.find({ conversationId: id }).sort({ createdAt: 1 }).lean();

    if (zone === "cloud" || !sovereignStoreConfigured()) return res.json(cloud);

    // Merged, not "cloud else sovereign": a thread that began in Cloud Mode
    // and continued in Sovereign Mode has halves in both stores, and returning
    // only the cloud half would show the user a transcript with their own
    // sovereign turns silently missing.
    //
    // This is a display path, reading the user's own data on the user's own
    // device. It is not the model's context -- what a cloud *model* may read
    // is decided separately, by the Redis tiering in the agent.
    const restricted = await sovereignModels()
      .Message.find({ conversationId: id })
      .sort({ createdAt: 1 })
      .lean();

    const merged = [...cloud, ...restricted].sort(
      (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
    );

    res.json(merged);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

};

export const updateConversation = async (req, res) => {

  try {

    const { conversationId, title } = req.body;

    const sovereign = zoneOf(req);

    // A title is the first thing a person typed, which is routinely the most
    // revealing line in the conversation -- "Q3 acquisition of ..." in a cloud
    // database next to their name is exactly the disclosure this mode exists
    // to prevent. On a sovereign turn the real title goes to the on-premises
    // store, and any cloud row left over from a thread that began in Cloud
    // Mode is relabelled rather than told the truth.
    if (sovereign) {

      const store = sovereignModels();

      if (store) {

        await store.Conversation.findByIdAndUpdate(
          conversationId,
          { title, userId: req.headers["x-user-id"] },
          { upsert: true, setDefaultsOnInsert: true }
        );

      }

      const cloudRow = await Conversation.findById(conversationId);

      if (cloudRow) {
        await Conversation.findByIdAndUpdate(conversationId, { title: RESTRICTED_TITLE });
      }

      return res.json({ _id: conversationId, title, sovereign: true });

    }

    const conversation = await Conversation.findByIdAndUpdate(
      conversationId,
      { title },
      { new: true }
    );

    res.json(conversation);

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

};

export const deleteConversation = async (req, res) => {

  try {

    const userId = req.headers["x-user-id"];
    const { id } = req.params;

    let deleted = false;

    // Both stores are tried because the caller does not say which one holds
    // it, and a delete that silently missed would leave restricted content
    // behind after the user believed it gone.
    const stores = [{ Conversation, Message }, sovereignModels()].filter(Boolean);

    for (const store of stores) {

      // Scoped by userId as well as _id: matching on the id alone would let
      // any signed-in user delete somebody else's conversation by guessing it.
      const conversation = await store.Conversation.findOneAndDelete({ _id: id, userId });

      if (conversation) {
        deleted = true;
        // Otherwise the messages stay behind as orphans and keep growing the
        // collection.
        await store.Message.deleteMany({ conversationId: id });
      }

    }

    if (!deleted) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    res.json({ _id: id, deleted: true });

  } catch (error) {

    res.status(500).json({ message: error.message });

  }

};
