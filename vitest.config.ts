import { fileURLToPath } from 'node:url'
import { defineConfig, defineProject, mergeConfig } from 'vitest/config'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import viteConfig from './vite.config'

const root = fileURLToPath(new URL('./', import.meta.url))
const migrations = await readD1Migrations(fileURLToPath(new URL('./migrations', import.meta.url)))

export default defineConfig({
  test: {
    projects: [
      // Components, stores, models and the API client, in a simulated browser with fetch stubbed
      mergeConfig(
        viteConfig({ mode: 'test', command: 'serve' }),
        defineProject({
          test: {
            name: 'unit',
            environment: 'jsdom',
            root,
            include: ['src/**/__tests__/*.spec.ts'],
          },
        }),
      ),
      // The Worker API against a real D1 database, inside the Workers runtime
      defineProject({
        plugins: [
          cloudflareTest({
            wrangler: { configPath: fileURLToPath(new URL('./wrangler.jsonc', import.meta.url)) },
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: migrations,
                // Stand-ins for the secrets; the tests replace fetch, so nothing reaches Google
                GOOGLE_CLIENT_ID: 'test-client-id',
                GOOGLE_CLIENT_SECRET: 'test-client-secret',
              },
            },
          }),
        ],
        test: {
          name: 'integration',
          root,
          include: ['worker/__tests__/*.spec.ts'],
          setupFiles: ['./worker/__tests__/setup.ts'],
        },
      }),
    ],
  },
})
