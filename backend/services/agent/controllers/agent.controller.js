import redis from "../../../shared/redis/redis.js";
import { graph } from "../graph/supervisor.graph.js";
import { addMessage } from "../utils/memory.js";
import { internalApi } from "../utils/internalApi.js"

export const chat =
async(req,res,next)=>{

 try{

  const {

   prompt,

   conversationId,

   agent,

   timezone

} = req.body;

console.log(req.body)
console.log(req.file)

await addMessage(
 conversationId,
 "user",
 prompt
);

await internalApi.post(`/save-message`,{
  conversationId,
  role:"user",
  content:prompt
})







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

  return res.json({

 success:true,

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