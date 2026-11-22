import Razorpay from "razorpay";
import dotenv from "dotenv";

dotenv.config();

// A deployment with billing disabled must start without Razorpay credentials.
const razorpay = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
  ? new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    })
  : null;

export default razorpay;
