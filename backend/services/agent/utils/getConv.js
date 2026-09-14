import { internalApi } from "./internalApi.js";

export const getConversationHistory =
async(conversationId)=>{

 const response =
 await internalApi.get(

 `/get-messages/${conversationId}`

 );

 return response.data;

};