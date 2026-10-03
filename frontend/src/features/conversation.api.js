import api from "../utils/axios";


export const getConversations =async()=>{

 const response =await api.get( "/api/chat/get-conversations"
 );

 return response.data;

};
// The zone travels with the call because a title is content: it is the first
// thing the person typed. Without it the server cannot tell a sovereign thread
// from an ordinary one, and the real title lands in the cloud database.
// The server clamps this against the organisation's policy -- a client can ask
// for Sovereign Mode, it cannot ask its way out of it.
export const updateConversations =async(conversationId,title,sovereign=false)=>{

 const response =await api.post( "/api/chat/update-conversation",{
    conversationId,title,sovereign
 }
 );

 return response.data;

};

export const createConversation =async(sovereign=false)=>{

 const response =await api.post("/api/chat/create-conversation",{ sovereign });

 return response.data;

};
export const deleteConversation =async(conversationId)=>{

 const response =await api.delete(`/api/chat/delete-conversation/${conversationId}`);

 return response.data;

};
