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

planExpiresAt:Date
},
{
  timestamps:true
});

const User= mongoose.model("User",userSchema);
export default User