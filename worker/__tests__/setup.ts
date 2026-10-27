// Runs before each integration test file: creates the tables from migrations/, then
// empties them before every test so each test starts from an empty database.
import { applyD1Migrations, env } from 'cloudflare:test'
import { beforeEach } from 'vitest'

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)

beforeEach(async () => {
  // Deleting the parent rows cascades to project_tasks, project_links, project_tags and
  // task_relations. This includes the starting tags from migrations/0002 and 0003, so tests only
  // see their own.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM projects'),
    env.DB.prepare('DELETE FROM tasks'),
    env.DB.prepare('DELETE FROM tags'),
  ])
})
