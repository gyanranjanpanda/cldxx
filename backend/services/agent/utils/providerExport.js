import { createHash } from "node:crypto";
import { Readable } from "node:stream";

const MAX_JSON_BYTES = 64 * 1024 * 1024;
const CONVERSATION_FILE = /(?:^|\/)conversations(?:[-_.]?\d+)?\.json$/i;

export class ProviderExportError extends Error {}

const stableId = (...parts) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24);

function dateValue(value) {
  const timestamp = typeof value === "number" ? value * 1000 : Date.parse(value);
  return Number.isFinite(timestamp) && Math.abs(timestamp) < 8.64e15 ? timestamp : undefined;
}

function chatGPTMessages(chat) {
  const nodes = new Map(Object.entries(chat.mapping));
  let id = nodes.has(chat.current_node) ? chat.current_node : [...nodes.keys()].at(-1);
  const branch = [];
  while (nodes.has(id)) {
    const nodeId = id;
    const node = nodes.get(id);
    nodes.delete(id);
    id = node?.parent;
    const message = node?.message;
    if (!message || message.metadata?.is_visually_hidden_from_conversation || message.metadata?.is_visually_hidden ||
        (message.recipient && message.recipient !== "all")) continue;
    const content = message.content;
    if (!["text", "multimodal_text"].includes(content?.content_type) || !Array.isArray(content.parts)) continue;
    branch.push({
      id: message.id || nodeId,
      role: message.author?.role,
      text: content.parts.filter((part) => typeof part === "string").join("\n\n"),
      date: message.create_time
    });
  }
  return branch.reverse();
}

function claudeMessages(chat) {
  return chat.chat_messages.map((message) => {
    const blocks = Array.isArray(message?.content) ? message.content : [];
    const text = blocks.filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text).join("\n\n");
    return {
      id: message?.uuid,
      role: message?.sender === "human" ? "user" : message?.sender,
      text: text.trim() ? text : message?.text,
      date: message?.created_at
    };
  });
}

async function* readEntries(body, zip) {
  if (!zip) {
    if (body.length > MAX_JSON_BYTES) throw new ProviderExportError("Conversation JSON exceeds 64 MB.");
    yield body.toString("utf8");
    return;
  }
  const entries = zip.file(CONVERSATION_FILE);
  if (!entries.length) throw new ProviderExportError("No conversation JSON found. Choose a ChatGPT, Claude, or CLDX export.");

  let totalBytes = 0;
  for (const entry of entries) {
    const chunks = [];
    for await (const chunk of Readable.wrap(entry.nodeStream("nodebuffer"))) {
      totalBytes += chunk.length;
      if (totalBytes > MAX_JSON_BYTES) throw new ProviderExportError("Conversation JSON exceeds 64 MB. Import the extracted JSON files separately.");
      chunks.push(chunk);
    }
    yield Buffer.concat(chunks).toString("utf8");
  }
}

export async function readProviderExport(body, zip) {
  const conversations = new Map();
  const messages = new Map();
  let provider;
  for await (const source of readEntries(body, zip)) {
    const data = JSON.parse(source.replace(/^\uFEFF/, ""));
    const chats = Array.isArray(data) ? data : data?.conversations;
    if (!Array.isArray(chats)) throw new ProviderExportError("This JSON is not a supported conversation export.");
    for (const chat of chats) {
      const kind = Array.isArray(chat?.chat_messages) ? "Claude"
        : chat?.mapping && typeof chat.mapping === "object" && !Array.isArray(chat.mapping) ? "ChatGPT" : null;
      if (!kind || (provider && kind !== provider)) throw new ProviderExportError("This file does not contain a consistent ChatGPT or Claude conversation export.");
      provider = kind;
      const chatId = kind === "ChatGPT" ? chat.conversation_id || chat.id : chat.uuid;
      if (typeof chatId !== "string" || !chatId) throw new ProviderExportError("A conversation in the export is missing its ID.");
      const id = stableId(chatId);
      if (conversations.has(id)) continue;
      const sourceMessages = kind === "ChatGPT" ? chatGPTMessages(chat) : claudeMessages(chat);
      const createdAt = dateValue(chat.create_time ?? chat.created_at)
        ?? sourceMessages.map((message) => dateValue(message.date)).find((date) => date !== undefined) ?? 0;
      let lastDate = createdAt - 1;
      for (const [index, message] of sourceMessages.entries()) {
        if (!["user", "assistant"].includes(message.role) || typeof message.text !== "string" || !message.text.trim()) continue;
        if (message.text.length > 5_000_000) throw new ProviderExportError("A message exceeds the 5 million character limit.");
        const messageId = stableId(chatId, message.id ?? index);
        if (messages.has(messageId)) continue;
        // Preserve the displayed transcript order, even when timestamps tie.
        lastDate = Math.max(lastDate + 1, dateValue(message.date) ?? createdAt);
        messages.set(messageId, {
          id: messageId, conversationId: id, role: message.role, content: message.text,
          createdAt: new Date(lastDate), updatedAt: new Date(lastDate), images: [], artifacts: []
        });
        if (messages.size > 100000) throw new ProviderExportError("The archive contains over 100,000 messages.");
      }
      if (lastDate < createdAt) continue;
      const title = chat.title ?? chat.name;
      conversations.set(id, {
        id, title: typeof title === "string" && title.trim() ? title.trim().slice(0, 10000) : `Imported ${kind} chat`,
        titleEdited: true, createdAt: new Date(createdAt),
        updatedAt: new Date(Math.max(lastDate, dateValue(chat.update_time ?? chat.updated_at) ?? createdAt))
      });
      if (conversations.size > 10000) throw new ProviderExportError("The archive contains over 10,000 conversations.");
    }
  }
  if (!messages.size) throw new ProviderExportError("No readable conversation messages were found.");
  return {
    format: "cldx-cloud-content", version: 1, sourceUserId: `provider:${provider}`, provider,
    conversations: [...conversations.values()], messages: [...messages.values()], includedArtifacts: []
  };
}
