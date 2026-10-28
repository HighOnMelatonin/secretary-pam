// Runs before each integration test file: creates the tables from migrations/, then
// empties them before every test so each test starts from an empty database.
import { applyD1Migrations, env } from 'cloudflare:test'
import { beforeEach } from 'vitest'

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)

beforeEach(async () => {
  // Deleting the users cascades to their sessions, projects, tasks and tags, and from those to
  // the tables holding their arrays. This includes the 'original' account from migrations/0004,
  // so a test's first sign-up makes a new account rather than taking that one over.
  await env.DB.batch([env.DB.prepare('DELETE FROM users'), env.DB.prepare('DELETE FROM login_failures')])
})
