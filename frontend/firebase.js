// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GithubAuthProvider, GoogleAuthProvider } from "firebase/auth";
export { getRedirectResult, signInWithRedirect } from "firebase/auth";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || `${import.meta.env.VITE_FIREBASE_PROJECT_ID || 'cldxx-app'}.firebaseapp.com`,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Local Sovereign installations use their own account and have no Firebase key.
// Avoid creating Auth in that build: getAuth() throws auth/invalid-api-key even
// when the Google sign-in button is hidden.
const app = import.meta.env.VITE_LOCAL_AUTH_ENABLED === "true"
  ? null
  : getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

export const auth=app ? getAuth(app) : null
export const googleProvider =
  app ? new GoogleAuthProvider() : null;

export const githubProvider =
  app ? new GithubAuthProvider() : null;
