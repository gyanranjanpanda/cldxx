import proxy from "express-http-proxy";

// express-http-proxy defaults to a 1 MB body limit. That silently rejected
// multipart uploads before they could reach Multer, whose limit is larger.
// Keep the gateway slightly above the file limit for multipart boundaries and
// the text fields that accompany the file.
export const proxyWithUser =
(serviceUrl)=>{

 const maxUploadMb = Number(process.env.MAX_UPLOAD_MB) || 20;

 return proxy(
  serviceUrl,
  {

   limit: `${maxUploadMb + 2}mb`,

   proxyReqOptDecorator:
   (proxyReqOpts, srcReq)=>{

    // Proves to the agent that this request came through the app, which is
    // what makes the x-user-id below trustworthy. Without it anyone able to
    // reach the agent's port could claim to be any user.
    if(process.env.INTERNAL_API_KEY){

      proxyReqOpts.headers[
       "x-internal-key"
      ] =
      process.env.INTERNAL_API_KEY;

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
      srcReq.user.avatar

    }

    return proxyReqOpts;

   }

  }
 );

}
