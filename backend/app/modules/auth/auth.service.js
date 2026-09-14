import User from "./models/user.model.js";
import redis from "../../../shared/redis/redis.js";

// Credit cost per agent. Mirrors billing/config/credits.js.
export const CREDIT_COST = {
  chat: 1,
  search: 5,
  coding: 10,
  pdf: 10,
  ppt: 10,
  image: 10,
  // A cold scan downloads a repo and embeds every file, so it costs far more
  // than a single-document agent. Cached repeat questions still pay this.
  github: 25
};

class AuthError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

// The gateway reads the session blob straight out of redis on every request,
// so any change to a user's plan/credits has to be written back there too or
// the change is invisible until the user logs in again.
const refreshSession = async (user) => {
  const sessionId = await redis.get(`user-session:${user._id}`);

  if (!sessionId) return;

  await redis.set(
    `session:${sessionId}`,
    JSON.stringify({
      userId: user._id,
      email: user.email,
      avatar: user.avatar,
      name: user.name,
      plan: user.plan,
      credits: user.credits,
      totalCredits: user.totalCredits
    }),
    "EX",
    60 * 60 * 24 * 7
  );
};

export const updateUserPlan = async ({ userId, plan, credits }) => {
  const user = await User.findById(userId);

  if (!user) throw new AuthError(404, "User not found");

  user.plan = plan;
  user.credits += credits;
  user.totalCredits += credits;
  user.planExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await user.save();
  await refreshSession(user);

  return user;
};

export const deductUserCredits = async ({ userId, agent }) => {
  const user = await User.findById(userId);

  if (!user) throw new AuthError(404, "User not found");

  const requiredCredits = CREDIT_COST[agent] || 1;

  if (user.credits < requiredCredits) {
    throw new AuthError(400, "Not enough credits.", {
      title: "Insufficient Credits"
    });
  }

  user.credits -= requiredCredits;

  await user.save();
  await refreshSession(user);

  return user;
};
