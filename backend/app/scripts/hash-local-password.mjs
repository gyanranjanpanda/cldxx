import { hashLocalPassword } from "../modules/auth/localPassword.js";

const password = process.env.LOCAL_AUTH_NEW_PASSWORD;
if (!password) {
  console.error("Set LOCAL_AUTH_NEW_PASSWORD before running this script");
  process.exit(1);
}
console.log(hashLocalPassword(password));
