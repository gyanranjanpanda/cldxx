import mongoose from "mongoose";

const connectDB = async () => {
  try {
    if (!process.env.MONGODB_URL || !process.env.MONGODB_URL.startsWith("mongodb")) {
      console.warn("⚠️ MONGODB_URL is not configured with a valid MongoDB URI.");
      return;
    }
    await mongoose.connect(process.env.MONGODB_URL);
    console.log("DB Connected");
  } catch (error) {
    console.log("Db Error", error.message);
  }
};

export default connectDB