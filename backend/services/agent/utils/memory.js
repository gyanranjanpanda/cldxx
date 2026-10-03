import redis from "../../../shared/redis/redis.js";
import { getConversationHistory } from "./getConv.js";

// Incognito threads are minted in the browser as `incognito:<uuid>` and have no
// Conversation row behind them. Recognising them by id keeps every caller
// unchanged: nothing has to thread an extra flag through the graph.
export const isEphemeral = (conversationId) =>
  String(conversationId ?? "").startsWith("incognito:");

// A normal thread's cache is just a fast path in front of Mongo, so a day is
// cheap. An incognito thread's cache IS the thread -- it gets an hour, long
// enough to hold a conversation and short enough to not linger.
const EPHEMERAL_TTL = 3600;
const STANDARD_TTL  = 86400;

const ttlFor = (conversationId) =>
  isEphemeral(conversationId) ? EPHEMERAL_TTL : STANDARD_TTL;

// ── Classification lives in the key ─────────────────────────────────────────
//
// A sovereign turn and a cloud turn in the same conversation are not the same
// kind of data, so they do not share a key. Information may flow one way only:
// a sovereign turn may read what was said in the cloud, and a cloud turn must
// never read what was said in Sovereign Mode.
//
// Addressing rather than filtering is deliberate, and it is the same rule
// vectorStore.js applies to Qdrant collections: a filter is one forgotten `if`
// away from a disclosure, whereas a key a cloud turn never constructs cannot be
// read by one.

const cloudKey     = (conversationId) => `conversation:${conversationId}`;
const sovereignKey = (conversationId) => `conversation:${conversationId}:sov`;

const MAX_MESSAGES = 20;

const readTier = async (key) => {

  const cached = await redis.get(key);

  return cached ? JSON.parse(cached) : null;

};

// Entries written before this file grew tiers carry no timestamp. Treating a
// missing one as 0 sorts them first, which is correct -- they are older than
// anything written since.
const at = (message) => Number(message?.at) || 0;

/**
 * Interleaves two already-ordered tiers. This is the merge step of a merge
 * sort: O(n + m), and it has to be a merge rather than a concatenation because
 * the two tiers are interleaved in time, not stacked.
 */
const mergeByTime = (cloud, restricted) => {

  const merged = [];

  let i = 0;
  let j = 0;

  while (i < cloud.length && j < restricted.length) {
    merged.push(at(cloud[i]) <= at(restricted[j]) ? cloud[i++] : restricted[j++]);
  }

  while (i < cloud.length)      merged.push(cloud[i++]);
  while (j < restricted.length) merged.push(restricted[j++]);

  return merged.slice(-MAX_MESSAGES);

};

/**
 * The history a turn is allowed to see.
 *
 * @param {string} conversationId
 * @param {{ sovereign?: boolean }} [options]
 */
export const getMemory = async (conversationId, { sovereign = false } = {}) => {

  // Each tier is filled from its own store and never from the other. A cache
  // is a copy, so a tier hydrated from the wrong place is the same disclosure
  // as writing there directly -- and it is the easier mistake to make, because
  // it only shows up once the cache has expired.
  const hydrate = async (key, zone) => {

    const cached = await readTier(key);

    if (cached !== null) return cached;

    // Nothing to rehydrate from: an incognito id is not an ObjectId, so asking
    // Mongo for it would 500 rather than return an empty history.
    const fetched = isEphemeral(conversationId)
      ? []
      : await getConversationHistory(conversationId, zone);

    await redis.set(key, JSON.stringify(fetched), "EX", ttlFor(conversationId));

    return fetched;

  };

  const cloud = await hydrate(cloudKey(conversationId), "cloud");

  // A cloud turn never builds the restricted key. There is no filter to forget
  // and no flag to misread -- the data is simply not addressed.
  if (!sovereign) return cloud;

  // Hydrated too, so a sovereign conversation still has its history after the
  // cache expires rather than starting over from nothing.
  const restricted = await hydrate(sovereignKey(conversationId), "sovereign");

  return mergeByTime(cloud, restricted);

};

/** True when this conversation has restricted turns, without revealing them. */
export const hasRestrictedHistory = async (conversationId) =>
  Boolean(await redis.exists(sovereignKey(conversationId)));

/**
 * Appends a turn to the tier it belongs to.
 *
 * @param {{ sovereign?: boolean }} [options]
 */
export const addMessage = async (
  conversationId,
  role,
  content,
  { sovereign = false } = {}
) => {

  // No write down: a sovereign turn only ever touches the restricted tier.
  const key = sovereign
    ? sovereignKey(conversationId)
    : cloudKey(conversationId);

  const messages = (await readTier(key)) || [];

  messages.push({ role, content, at: Date.now() });

  // Trimmed per tier. A sovereign turn cannot push a cloud turn out of the
  // cloud tier, which would be a write-down by eviction.
  while (messages.length > MAX_MESSAGES) messages.shift();

  await redis.set(
    key,
    JSON.stringify(messages),
    "EX",
    ttlFor(conversationId)
  );

};
