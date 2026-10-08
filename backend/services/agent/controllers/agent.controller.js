import redis from "../../../shared/redis/redis.js";
import { graph } from "../graph/supervisor.graph.js";
import { addMessage, isEphemeral } from "../utils/memory.js";
import { internalApi } from "../utils/internalApi.js"
import { resolveSovereign } from "../utils/sovereign.js";
import { audit } from "../utils/audit.js";
import { fetchUserKeys } from "../utils/userKeys.js";

export const chat =
async(req,res,next)=>{

 try{

  const {

   prompt,

   conversationId,

   agent,

   timezone,

   incognito,

   sovereign

} = req.body;

console.log(req.body)
console.log(req.file)

// Incognito turns are answered normally but never written to Mongo. The id is
// checked too, so a forged `incognito:false` on an ephemeral id cannot talk the
// server into creating history for a conversation that does not exist.
const isIncognito =
 isEphemeral(conversationId) ||
 incognito === true ||
 incognito === "true";

// Sovereign Mode is decided per turn, but not by the turn alone: the
// organisation's policy arrives on a header the gateway sets and the client
// cannot, and it outranks the request. A user may ask for Sovereign Mode; only
// an administrator may require it.
const zone =
 resolveSovereign(
  req.headers["x-sovereign-policy"],
  sovereign
 );

const isSovereignTurn =
 zone.sovereign;

// Worth a line in the audit log in both directions: a turn that ran locally
// because policy said so, and a turn that policy would have run locally had
// the user not declined, are the two questions a reviewer asks later.
if(zone.forced || zone.optedOut){

 audit({

  userId: req.headers["x-user-id"],

  conversationId,

  agent,

  zone:
  zone.sovereign ? "SOVEREIGN" : "CLOUD",

  decision:
  zone.forced ? "FORCED" : "ALLOW",

  rule: "SOV-007",

  model: null,

  endpoint: zone.policy

 });

}

// Redis still gets the turn either way -- that is what makes the *next* message
// in this session aware of this one. For incognito it expires on its own. The
// zone decides which tier it lands in; a sovereign turn is never written where
// a cloud turn could read it.
await addMessage(
 conversationId,
 "user",
 prompt,
 { sovereign:isSovereignTurn }
);

// The zone travels with the message and the gateway decides where it may be
// written: the on-premises store when one is configured, nowhere at all when
// there is not. The rule is "never persist outside the boundary", not "never
// persist" -- on-premises the database belongs to the customer, and refusing
// to use it would lose their own work for no security gain.
if(!isIncognito){

 await internalApi.post(`/save-message`,{
   conversationId,
   role:"user",
   content:prompt,
   sovereign:isSovereignTurn
 })

}







  // Resolved once per turn rather than per model construction: getModel is
  // synchronous, so the lookup cannot live inside it. Sovereign turns never
  // reach a cloud provider, so there is no key to bring.
  const keys =
  isSovereignTurn
  ? {}
  : await fetchUserKeys(
     req.headers["x-user-id"]
    );

  const result =
  await graph.invoke({

   prompt,

   conversationId,

   userId:
   req.headers[
    "x-user-id"
   ],
   agent,
   timezone,
   file:req.file,
   sovereign:isSovereignTurn,
   keys

  });


  console.log("after res",result)

  // Credit / rate-limit failures are transient, not part of the conversation.
  // Persisting them left "Insufficient Credits" in the history for good, and
  // fed the failure back to the model as context on every later turn.
  if(!result.isError){

   await addMessage(
    conversationId,
    "assistant",
    result.response,
    { sovereign:isSovereignTurn }
   );

   // Same rule for the answer as for the prompt: it carries the same content.
   if(!isIncognito){

    await internalApi.post(
     `/save-message`,
     {
      conversationId,
      role:"assistant",
      content:result.response,
      images:result.images,
      artifacts:
      result.artifacts || [],
      sovereign:isSovereignTurn
     }
    )

   }

  }

  return res.json({

 success:true,

 incognito:isIncognito,

 zone:
 isSovereignTurn ? "SOVEREIGN" : "CLOUD",

 answer:
 result.response,
 images:result.images,
 artifacts:
 result.artifacts || []

});

 }catch(error){

  next(error)

 }

}