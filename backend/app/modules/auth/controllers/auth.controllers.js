import crypto from "crypto";

import { getAuth }
  from "firebase-admin/auth";
import User from "../models/user.model.js";
import redis from "../../../../shared/redis/redis.js";
import { app } from "../config/firebase.js";
import { updateUserPlan, deductUserCredits } from "../auth.service.js";


const isProduction =
  process.env.NODE_ENV === "production";

// Locally the API and the frontend are both on http://localhost, where Secure
// would stop the browser storing the cookie at all. In production they are
// usually different hosts, and a cross-site cookie has to be SameSite=None --
// which browsers only accept together with Secure.
const SESSION_COOKIE = {

  httpOnly: true,

  secure: isProduction,

  sameSite: isProduction ? "none" : "lax",

};


export const login = async (
  req,
  res
) => {

  try {


    const { token } = req.body;

    if (!token) {

      return res.status(400).json({
        message: "No token provided.",
      });

    }

    // This used to fall back to decoding the JWT payload without checking its
    // signature whenever Firebase Admin had not initialised. A JWT payload is
    // just base64 -- anyone could mint one for any email and be signed in as
    // that user. Refusing to authenticate is the only safe response when the
    // verifying credentials are missing.
    if (!app) {

      console.error(
        "Login rejected: Firebase Admin is not initialised (serviceAccount.json missing or invalid)."
      );

      return res.status(503).json({
        title: "Sign-in unavailable",
        message:
          "The server cannot verify sign-ins right now. Please try again later.",
      });

    }

    const decoded =
      await getAuth(app).verifyIdToken(token);

    // Full decoded tokens carry personal data; the uid is enough to trace a login.
    console.log("Login verified for uid:", decoded.uid);


    let user =
      await User.findOne({
        firebaseUid:
          decoded.uid,
      });

    // The same Google account can turn up with a different firebaseUid -- a new
    // Firebase project, or the unverified fallback above. Matching on email
    // links it to the existing record instead of quietly creating a second
    // account with its own separate credits and history.
    if (!user && decoded.email) {

      user =
        await User.findOne({
          email: decoded.email,
        });

      if (user) {

        user.firebaseUid = decoded.uid;

        if (!user.avatar && decoded.picture) {
          user.avatar = decoded.picture;
        }

        await user.save();
      }
    }

    if (!user) {

      user =
        await User.create({

          firebaseUid:
            decoded.uid,

          email:
            decoded.email,

          name:
            decoded.name,

          avatar:
            decoded.picture,

          provider:
            decoded.firebase
              ?.sign_in_provider,
        });
    }

    const sessionId =
      crypto.randomUUID();

    await redis.set(
      `user-session:${user._id}`,
      sessionId,
      "EX",
      60 * 60 * 24 * 7
    );

    await redis.set(

      `session:${sessionId}`,

      JSON.stringify({

        userId:
          user._id,

        email:
          user.email,
        avatar:
          user.avatar,
        name: user.name,
        plan: user.plan,
        credits: user.credits,
        totalCredits: user.totalCredits


      }),

      "EX",

      60 * 60 * 24 * 7
    );

    res.cookie(

      "session",

      sessionId,

      {
        ...SESSION_COOKIE,

        maxAge:
          1000 *
          60 *
          60 *
          24 *
          7,
      }
    );

    return res.json({

      success: true,

      user,
    });

  } catch (error) {

    return res
      .status(401)
      .json({
        message:
          error.message,
      });

  }

};



export const logout =
  async (req, res) => {

    try {

      const sessionId =
        req.cookies?.session;

      if (sessionId) {

        await redis.del(
          `session:${sessionId}`
        );

      }

      // Must match the attributes used when setting it, or the browser keeps
      // the cookie and logout silently does nothing.
      res.clearCookie(
        "session",
        SESSION_COOKIE
      );

      return res.status(200).json({

        success: true,

        message: "Logged out successfully"

      });

    } catch (error) {

      return res.status(500).json({

        success: false,

        message: error.message

      });

    }

  };



export const updatePlan = async (req, res) => {

  try {

    const { userId, plan, credits } = req.body;

    await updateUserPlan({ userId, plan, credits });

    return res.json({ success: true });

  }

  catch (error) {

    return res.status(error.status || 500).json({

      success: false,

      message: error.message

    });

  }

};


export const deductCredits = async (req, res) => {

  try {

    const { userId, agent } = req.body;

    const user = await deductUserCredits({ userId, agent });

    return res.json({

      success: true,

      credits: user.credits

    });

  }

  catch (error) {

    return res.status(error.status || 500).json({

      success: false,

      title: error.title,

      message: error.message

    });

  }

};
