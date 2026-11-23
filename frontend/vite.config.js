import { defineConfig, loadEnv } from 'vite'
import process from 'node:process'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_FIREBASE_')
  return {
  plugins: [react(), tailwindcss(), {
    name: 'firebase-auth-init',
    generateBundle() {
      if (!env.VITE_FIREBASE_API_KEY || !env.VITE_FIREBASE_PROJECT_ID) return
      const config = {
        apiKey: env.VITE_FIREBASE_API_KEY,
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || `${env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
        projectId: env.VITE_FIREBASE_PROJECT_ID,
        appId: env.VITE_FIREBASE_APP_ID,
        messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
      }
      this.emitFile({ type: 'asset', fileName: '__/firebase/init.json', source: JSON.stringify(config) })
    },
  }],
  server: {
    // This machine's fsevents watcher fires phantom change events for .env and
    // vite.config.js, and each one restarts the server mid dependency pre-bundle,
    // so the deps cache never finishes. Ignoring them keeps the optimizer alive.
    watch: {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/.env',
        '**/.env.*',
        '**/vite.config.*',
      ],
    },
  },
  }
})
