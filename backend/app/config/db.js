import mongoose from "mongoose";

// One connection for the whole app. auth, chat and billing each used to open
// their own to the same MONGODB_URL, which bought four connection pools and no
// isolation at all.
const connectDB = async () => {

  if (!process.env.MONGODB_URL || !process.env.MONGODB_URL.startsWith("mongodb")) {
    console.warn("⚠️ MONGODB_URL is not configured with a valid MongoDB URI.");
    return;
  }

  await mongoose.connect(process.env.MONGODB_URL);
  console.log("✅ MongoDB connected");
};

export default connectDB;
