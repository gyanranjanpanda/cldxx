import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import Conversation, { conversationSchema } from "../modules/chat/models/conversation.model.js";
import Message,      { messageSchema }      from "../modules/chat/models/message.model.js";

// Where a sovereign conversation is allowed to be written down.
//
// The rule is not "never persist" -- it is "never persist outside the
// boundary". Those look the same in the hosted product, where the only
// database is ours, and they are very different on-premises, where the
// database belongs to the customer and refusing to use it would mean their own
// confidential work vanishes on a page reload for no security benefit.
//
// So the store is a second connection, exactly as vectorStore.js keeps a
// second Qdrant: set SOVEREIGN_MONGODB_URL to a database inside the boundary
// and sovereign conversations live there. Leave it unset and they are not
// written down at all, which is the right default for a cloud deployment.

const SOVEREIGN_MONGODB_URL =
  process.env.SOVEREIGN_MONGODB_URL || "";

export const sovereignStoreConfigured = () =>
  Boolean(SOVEREIGN_MONGODB_URL);

// Title shown in a cloud-visible listing for a conversation whose real title
// is restricted. The first thing a person types is often the most revealing
// line in the conversation, so it is exactly what must not sit in a cloud
// database next to their name.
export const RESTRICTED_TITLE = "Sovereign conversation";

let connection = null;
let models = null;

const connect = () => {

  if (connection) return connection;

  connection = mongoose.createConnection(SOVEREIGN_MONGODB_URL);

  connection.once("connected", () =>
    console.log("✅ Sovereign store connected")
  );

  connection.on("error", (error) =>
    console.error("❌ Sovereign store error:", error.message)
  );

  return connection;

};

/**
 * The models bound to the sovereign store, or null when no store is
 * configured. Null is a meaningful answer -- it means "this deployment does
 * not write sovereign turns down anywhere" -- so callers check it rather than
 * falling back to the cloud models, which would be the leak.
 */
export const sovereignModels = () => {

  if (!sovereignStoreConfigured()) return null;

  if (!models) {

    const conn = connect();

    models = {
      Conversation: conn.model("Conversation", conversationSchema),
      Message:      conn.model("Message", messageSchema)
    };

  }

  return models;

};

/**
 * Which pair of models a turn may write to.
 *
 * @param {boolean} sovereign
 * @returns {{ Conversation, Message } | null} null when a sovereign turn has
 *   nowhere in-boundary to be written, which is not an error.
 */
export const storeFor = (sovereign) =>
  sovereign
    ? sovereignModels()
    : { Conversation, Message };
