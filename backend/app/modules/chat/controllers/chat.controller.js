import Conversation
from "../models/conversation.model.js";

export const createConversation =async(req,res)=>{

 try{
 const userId =req.headers["x-user-id"];
 console.log("userId",userId)
  const conversation =await Conversation.create({
   userId:userId
  });

  res.json(
   conversation
  );

 }catch(error){

  res.status(500).json({
   message:error.message
  });

 }

}


export const getConversations =async(req,res)=>{

 try{
 const userId =req.headers["x-user-id"];
  const conversations =await Conversation.find({

   userId:userId

  })
  .sort({
   updatedAt:-1
  });

  res.json(
   conversations
  );

 }catch(error){

  res.status(500).json({
   message:error.message
  });

 }

}

import Message
from "../models/message.model.js";

export const saveMessage =async(req,res)=>{

 try{

  const {
   conversationId,
   role,
   content,
   images,
  artifacts
  } = req.body;

  const message =await Message.create({

   conversationId,

   role,
  images,
   content,
   artifacts:
  artifacts || []

  });

  res.json(
   message
  );

 }catch(error){

  res.status(500).json({
   message:error.message
  });

 }

}



export const getMessages =async(req,res)=>{

 try{

  const messages =await Message.find({

   conversationId:
   req.params.id

  })
  .sort({
   createdAt:1
  });

  res.json(
   messages
  );

 }catch(error){

  res.status(500).json({
   message:error.message
  });

 }

}


export const updateConversation=async (req,res)=>{
try {
    const {conversationId,title}=req.body
    const conversation=await Conversation.findByIdAndUpdate( conversationId,{
        title
    })
     res.json(
   conversation
  );

 }catch(error){

  res.status(500).json({
   message:error.message
  });

}
}

export const deleteConversation = async (req, res) => {

 try{
  const userId = req.headers["x-user-id"];
  const { id } = req.params;

  // Scoped by userId as well as _id: matching on the id alone would let any
  // signed-in user delete somebody else's conversation by guessing it.
  const conversation = await Conversation.findOneAndDelete({
   _id: id,
   userId: userId
  });

  if(!conversation){
   return res.status(404).json({
    message:"Conversation not found"
   });
  }

  // Otherwise the messages stay behind as orphans and keep growing the collection.
  await Message.deleteMany({
   conversationId: id
  });

  res.json({
   _id: id,
   deleted: true
  });

 }catch(error){

  res.status(500).json({
   message:error.message
  });

 }

}
