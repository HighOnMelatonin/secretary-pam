// Integration tests for worker/migrate.ts, against the real D1 database that setup.ts
// has already applied migrations/ to with wrangler's own migration code.
import { env, SELF } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import { migrate } from '../migrate'

const TABLES = ['project_links', 'project_tasks', 'task_relations', 'projects', 'tasks', 'tags']

const tableNames = async () =>
  (
    await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${TABLES.map(() => '?').join()})`)
      .bind(...TABLES)
      .all<{ name: string }>()
  ).results
    .map((row) => row.name)
    .sort()

const appliedNames = async () =>
  (await env.DB.prepare('SELECT name FROM d1_migrations ORDER BY id').all<{ name: string }>()).results.map((r) => r.name)

describe('migrate', () => {
  it('creates the tables in a database that has none', async () => {
    // Children first, so nothing references a dropped table
    await env.DB.batch([...TABLES, 'd1_migrations'].map((table) => env.DB.prepare(`DROP TABLE ${table}`)))
    expect(await tableNames()).toEqual([])

    await migrate(env.DB)

    expect(await tableNames()).toEqual([...TABLES].sort())
    expect(await appliedNames()).toEqual(['0001_create_projects_and_tasks.sql', '0002_add_tags.sql'])
    const response = await SELF.fetch('http://localhost/api/projects')
    expect(await response.json()).toEqual([])
  })

  it('starts a new database with the example tags', async () => {
    await env.DB.batch([...TABLES, 'd1_migrations'].map((table) => env.DB.prepare(`DROP TABLE ${table}`)))
    await migrate(env.DB)

    const response = await SELF.fetch('http://localhost/api/tags')
    expect(await response.json()).toEqual([
      { id: 'personal', name: 'Personal' },
      { id: 'school', name: 'School (SUTD)' },
      { id: 'work', name: 'Work' },
    ])
  })

  it('skips migrations that wrangler already applied', async () => {
    const before = await appliedNames()
    // Would fail with "table already exists" if it ran 0001 again
    await migrate(env.DB)
    expect(await appliedNames()).toEqual(before)
  })
})
