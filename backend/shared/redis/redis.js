import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const redis = new Redis(redisUrl.replace("localhost", "127.0.0.1"), {
  retryStrategy: (times) => Math.min(times * 50, 1000),
  maxRetriesPerRequest: null,
  enableOfflineQueue: true
});

redis.on("connect", () => {
  console.log("✅ Redis Connected");
});

redis.on("error", (err) => {
  console.error("❌ Redis Error:", err.message);
});


export default redis;