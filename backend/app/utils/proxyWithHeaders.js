import proxy from "express-http-proxy";
import { cloudRunIdentityToken } from "./cloudRunIdentity.js";

// express-http-proxy defaults to a 1 MB body limit. That silently rejected
// multipart uploads before they could reach Multer, whose limit is larger.
// Keep the gateway slightly above the file limit for multipart boundaries and
// the text fields that accompany the file.
export const proxyWithUser =
(serviceUrl, { preservePath = false } = {})=>{

 const maxUploadMb = Number(process.env.MAX_UPLOAD_MB) || 20;

 const proxyMiddleware = proxy(
  serviceUrl,
  {

   limit: `${maxUploadMb + 2}mb`,

   // Express removes the mounted prefix from req.url. Agent RPCs expect that,
   // but artifact downloads are mounted under the same path on both services.
   ...(preservePath ? { proxyReqPathResolver: (req) => req.originalUrl } : {}),

   proxyReqOptDecorator:
   (proxyReqOpts, srcReq)=>{

    delete proxyReqOpts.headers["x-serverless-authorization"];

    // Proves to the agent that this request came through the app, which is
    // what makes the x-user-id below trustworthy. Without it anyone able to
    // reach the agent's port could claim to be any user.
    if(process.env.INTERNAL_API_KEY){

      proxyReqOpts.headers[
       "x-internal-key"
      ] =
      process.env.INTERNAL_API_KEY;

    }

    if (srcReq.cloudRunIdentityToken) {
      proxyReqOpts.headers["x-serverless-authorization"] =
        `Bearer ${srcReq.cloudRunIdentityToken}`;
    }

    // A client-supplied identity header must never survive the proxy; the
    // values below are the only ones the agent may see. The policy header is
    // in this list for the same reason and a stronger one -- a client that
    // could set its own sovereign policy would be setting its own security
    // classification.
    delete proxyReqOpts.headers["x-user-id"];
    delete proxyReqOpts.headers["x-user-email"];
    delete proxyReqOpts.headers["x-user-avatar"];
    delete proxyReqOpts.headers["x-sovereign-policy"];

    if(srcReq.sovereignPolicy){

      proxyReqOpts.headers[
       "x-sovereign-policy"
      ] =
      srcReq.sovereignPolicy;

    }

    if(srcReq.user){

      proxyReqOpts.headers[
       "x-user-id"
      ] =
      srcReq.user.userId;

      proxyReqOpts.headers[
       "x-user-email"
      ] =
      srcReq.user.email;
      proxyReqOpts.headers[
       "x-user-avatar"
      ] =
      srcReq.user.avatar || "";

    }

    return proxyReqOpts;

   }

  }
 );

 return async (req, res, next) => {
   if (process.env.AGENT_CLOUD_RUN_AUTH === "true") {
     try {
       req.cloudRunIdentityToken = await cloudRunIdentityToken(serviceUrl);
     } catch (error) {
       console.error("[agent proxy] Cloud Run identity unavailable:", error.message);
       return res.status(503).json({ message: "Agent service is unavailable" });
     }
   }
   return proxyMiddleware(req, res, next);
 };

}
