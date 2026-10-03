import { getSovereignPolicy } from "../utils/sovereignPolicy.js";

export const getCurrentUser =
async(req,res)=>{

 try{

  // The session holds whatever was cached at login, so the policy is read
  // fresh and merged on. It is sent so the client can stop offering a choice
  // the server is going to override anyway -- a toggle that silently does
  // nothing is worse than no toggle.
  const sovereignPolicy =
  await getSovereignPolicy(
   req.user?.userId
  );

  return res.status(200).json({

   success:true,

   user:{
    ...req.user,
    sovereignPolicy
   }

  });

 }catch(error){

  return res.status(500).json({

   success:false,

   message:error.message

  });

 }

}