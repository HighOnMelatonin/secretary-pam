// Types for tests that run in the Workers runtime: the `cloudflare:test` module, and
// the migrations that vitest.config.ts passes in as a binding.
/// <reference types="@cloudflare/vitest-plugin/types" />

declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[]
  }
}
