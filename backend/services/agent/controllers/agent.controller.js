import redis from "../../../shared/redis/redis.js";
import { graph } from "../graph/supervisor.graph.js";
import { addMessage, isEphemeral } from "../utils/memory.js";
import { internalApi } from "../utils/internalApi.js"

export const chat =
async(req,res,next)=>{

 try{

  const {

   prompt,

   conversationId,

   agent,

   timezone,

   incognito

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

// Redis still gets the turn either way -- that is what makes the *next* message
// in this session aware of this one. For incognito it expires on its own.
await addMessage(
 conversationId,
 "user",
 prompt
);

if(!isIncognito){

 await internalApi.post(`/save-message`,{
   conversationId,
   role:"user",
   content:prompt
 })

}







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
   file:req.file

  });


  console.log("after res",result)

  // Credit / rate-limit failures are transient, not part of the conversation.
  // Persisting them left "Insufficient Credits" in the history for good, and
  // fed the failure back to the model as context on every later turn.
  if(!result.isError){

   await addMessage(
    conversationId,
    "assistant",
    result.response
   );

   if(!isIncognito){

    await internalApi.post(
     `/save-message`,
     {
      conversationId,
      role:"assistant",
      content:result.response,
      images:result.images,
      artifacts:
      result.artifacts || []
     }
    )

   }

  }

  return res.json({

 success:true,

 incognito:isIncognito,

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