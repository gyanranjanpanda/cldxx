import mongoose from "mongoose";

const connectDB = async () => {
  try {
    if (!process.env.MONGODB_URL || !process.env.MONGODB_URL.startsWith("mongodb")) {
      throw new Error("MONGODB_URL is not configured with a valid MongoDB URI");
    }
    await mongoose.connect(process.env.MONGODB_URL);
    console.log("DB Connected");
  } catch (error) {
    console.log("Db Error", error.message);
    throw error;
  }
};

export default connectDB
