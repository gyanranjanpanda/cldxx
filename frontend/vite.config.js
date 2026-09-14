import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
// https://vite.dev/config/
export default defineConfig({
  plugins: [react(),tailwindcss()],
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
})
