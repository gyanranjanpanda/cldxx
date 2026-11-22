import redis from "../../shared/redis/redis.js";


export const protect =
async(req,res,next)=>{

 try{

   const sessionId =
   req?.cookies?.session;

   if(!sessionId){

     return res.status(401).json({
       message:"Unauthorized"
     });

   }

   const session =
   await redis.get(
    `session:${sessionId}`
   );

   if(!session){

     return res.status(401).json({
       message:"Session Expired"
     });

   }

   req.user =
   JSON.parse(session);

   const allowedEmails = (process.env.AUTH_ALLOWED_EMAILS || "")
     .split(",")
     .map((email) => email.trim().toLowerCase())
     .filter(Boolean);
   if (allowedEmails.length && !allowedEmails.includes(req.user.email?.toLowerCase())) {
     return res.status(403).json({ message: "This account is not invited to this deployment." });
   }

   next();

 }catch(error){

   return res.status(500).json({
    message:error.message
   });

 }

}
