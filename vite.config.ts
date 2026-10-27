import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { cloudflare } from '@cloudflare/vite-plugin'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    vue(),
    vueDevTools(),
    // Runs worker/index.ts (the /api routes) in the Workers runtime during dev and
    // preview, and builds it alongside the app. Unit tests don't need it.
    // `--mode e2e` keeps end-to-end test data in its own local database.
    ...(process.env.VITEST
      ? []
      : [cloudflare({ persistState: mode === 'e2e' ? { path: '.wrangler/e2e-state' } : true })]),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
}))
