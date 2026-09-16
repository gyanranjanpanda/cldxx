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


export const getMemory =
async(conversationId)=>{

 const key =
 `conversation:${conversationId}`;

 const cached =
 await redis.get(key);

 if(cached){

  return JSON.parse(
   cached
  );

 }

 // Nothing to rehydrate from: an incognito id is not an ObjectId, so asking
 // Mongo for it would 500 rather than return an empty history.
 if(isEphemeral(conversationId)){

  return [];

 }

 const messages =
 await getConversationHistory(
  conversationId
 );

 await redis.set(

  key,

  JSON.stringify(
   messages
  ),

  "EX",

  ttlFor(conversationId)

 );

 return messages;

};


export const addMessage =
async(
 conversationId,
 role,
 content
)=>{

 const key =
 `conversation:${conversationId}`;

 const existing =
 await redis.get(key);

 const messages =
 existing
 ? JSON.parse(existing)
 : [];

 messages.push({
  role,
  content
 });

 if(messages.length > 20){

  messages.shift();

 }

 await redis.set(

  key,

  JSON.stringify(
   messages
  ),

  "EX",

  ttlFor(conversationId)

 );

}