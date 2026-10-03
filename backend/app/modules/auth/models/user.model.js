import mongoose from "mongoose";

const userSchema =new mongoose.Schema({
  firebaseUid:{
    type:String,
    unique:true
  },

  name:String,

  email:String,

  avatar:String,

  provider:String,
  plan:{

    type:String,

    default:"free"

},

credits:{

    type:Number,

    default:1000

},

totalCredits:{

    type:Number,

    default:1000

},

planExpiresAt:Date,

// Who decides whether a turn is answered locally. Sovereign Mode is a security
// control, so for an organisation it cannot be the person being controlled --
// a client that sends `sovereign:false` must not be able to route confidential
// work to a cloud provider. An administrator sets this; the request may only
// narrow it, never widen it.
//
//   user_choice       the per-turn toggle decides (right for an individual)
//   sovereign_default local unless the client explicitly opts out, and the
//                     opt-out is written to the audit log
//   sovereign_only    every turn is local; the toggle is not offered
sovereignPolicy:{

  type:String,

  enum:["user_choice","sovereign_default","sovereign_only"],

  default:"user_choice"

}
},
{
  timestamps:true
});

const User= mongoose.model("User",userSchema);
export default User