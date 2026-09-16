import proxy from "express-http-proxy";

export const proxyWithUser =
(serviceUrl)=>{

 return proxy(
  serviceUrl,
  {

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
    // values below are the only ones the agent may see.
    delete proxyReqOpts.headers["x-user-id"];
    delete proxyReqOpts.headers["x-user-email"];
    delete proxyReqOpts.headers["x-user-avatar"];

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