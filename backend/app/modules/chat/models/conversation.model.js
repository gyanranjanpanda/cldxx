import mongoose from "mongoose";

const conversationSchema =new mongoose.Schema({

 userId:{
  type:String,
  required:true
 },

 title:{
  type:String,
  default:"New Chat"
 }

},{
 timestamps:true
});

// Exported so a second connection -- the on-prem store used in Sovereign Mode
// -- can build the same model without redeclaring the shape.
export { conversationSchema };

const Conversation= mongoose.model("Conversation",conversationSchema);
export default Conversation