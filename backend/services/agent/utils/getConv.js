import { internalApi } from "./internalApi.js";

// The zone is required, not optional. This call fills one tier of the
// conversation cache, and a tier filled from the wrong store is a disclosure:
// hydrating the cloud tier from a merged result puts restricted turns where a
// cloud model reads them.
export const getConversationHistory =
async(conversationId, zone = "cloud")=>{

 const response =
 await internalApi.get(

 `/get-messages/${conversationId}?zone=${encodeURIComponent(zone)}`

 );

 return response.data;

};