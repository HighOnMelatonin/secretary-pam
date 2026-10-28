// Integration tests for worker/migrate.ts, against the real D1 database that setup.ts
// has already applied migrations/ to with wrangler's own migration code.
import { applyD1Migrations, env } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import { migrate } from '../migrate'
import { call, signUp } from './helpers'

// Children first, so nothing references a dropped table
const TABLES = [
  'project_links',
  'project_tasks',
  'project_tags',
  'task_relations',
  'projects',
  'tasks',
  'tags',
  'sessions',
  'login_failures',
  'users',
]

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

const dropEverything = () =>
  env.DB.batch([...TABLES, 'd1_migrations'].map((table) => env.DB.prepare(`DROP TABLE IF EXISTS ${table}`)))

// A database as it was before the migration at `index` (0 is 0001), from wrangler's own code
async function databaseBefore(index: number) {
  await dropEverything()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(0, index))
}

describe('migrate', () => {
  it('creates the tables in a database that has none', async () => {
    await dropEverything()
    expect(await tableNames()).toEqual([])

    await migrate(env.DB)

    expect(await tableNames()).toEqual([...TABLES].sort())
    expect(await appliedNames()).toEqual([
      '0001_create_projects_and_tasks.sql',
      '0002_add_tags.sql',
      '0003_project_tags_and_archive.sql',
      '0004_users.sql',
    ])
    expect((await call('GET', 'projects', undefined, await signUp())).body).toEqual([])
  })

  it('starts a new database with the example tags and the Archive tag, for the first account', async () => {
    await dropEverything()
    await migrate(env.DB)

    expect((await call('GET', 'tags', undefined, await signUp())).body).toEqual([
      { id: 'archive', name: 'Archive' },
      { id: 'personal', name: 'Personal' },
      { id: 'school', name: 'School (SUTD)' },
      { id: 'work', name: 'Work' },
    ])
  })

  it("moves each project's tag to project_tags and archives completed projects (0003)", async () => {
    // Before 0003, with a tag already called Archive
    await databaseBefore(2)
    await env.DB.batch([
      env.DB.prepare("INSERT INTO tags (id, name) VALUES ('mine', 'archive')"),
      env.DB.prepare("INSERT INTO tasks (id, name, completed) VALUES ('done', 'Done', 1), ('open', 'Open', 0)"),
      env.DB.prepare(
        `INSERT INTO projects (id, name, tag_id, created_at) VALUES
           ('finished', 'Finished', 'school', '1'), ('ongoing', 'Ongoing', 'school', '2'),
           ('empty', 'Empty', NULL, '3'), ('untagged', 'Untagged', NULL, '4')`,
      ),
      env.DB.prepare(
        `INSERT INTO project_tasks (project_id, task_id, position) VALUES
           ('finished', 'done', 0), ('ongoing', 'done', 0), ('ongoing', 'open', 1), ('untagged', 'done', 0)`,
      ),
    ])

    await migrate(env.DB)

    const session = await signUp()
    const projects: { id: string; tagIds: string[] }[] = (await call('GET', 'projects', undefined, session)).body
    expect(projects.map((p) => [p.id, p.tagIds])).toEqual([
      ['finished', ['school', 'archive']],
      ['ongoing', ['school']],
      ['empty', []],
      ['untagged', ['archive']],
    ])
    expect((await call('GET', 'tags', undefined, session)).body).toContainEqual({ id: 'archive', name: 'Archive (completed)' })
  })

  it('keeps every field and array of the data from before accounts, for the first account (0004)', async () => {
    await databaseBefore(3)
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO tasks (id, name, description, due_date, priority, completed, created_at) VALUES
           ('a', 'A', 'First', '2026-11-02', 'high', 1, '1'), ('b', 'B', '', NULL, 'low', 0, '2')`,
      ),
      env.DB.prepare("INSERT INTO task_relations (task_id, related_task_id, type, position) VALUES ('a', 'b', 'blocks', 0)"),
      env.DB.prepare(
        "INSERT INTO projects (id, name, description, delivery_date, priority) VALUES ('p', 'Thesis', 'Final year', '2027-01-18', 'urgent')",
      ),
      env.DB.prepare("INSERT INTO project_tasks (project_id, task_id, position) VALUES ('p', 'b', 0), ('p', 'a', 1)"),
      env.DB.prepare("INSERT INTO project_links (project_id, position, label, url) VALUES ('p', 0, 'Repo', 'https://example.com/repo')"),
      env.DB.prepare("INSERT INTO project_tags (project_id, tag_id, position) VALUES ('p', 'work', 0), ('p', 'school', 1)"),
    ])

    await migrate(env.DB)

    const session = await signUp()
    expect((await call('GET', 'tasks', undefined, session)).body).toEqual([
      { id: 'a', name: 'A', description: 'First', dueDate: '2026-11-02', relations: [{ taskId: 'b', type: 'blocks' }], priority: 'high', completed: true },
      { id: 'b', name: 'B', description: '', dueDate: null, relations: [], priority: 'low', completed: false },
    ])
    expect((await call('GET', 'projects', undefined, session)).body).toEqual([
      {
        id: 'p',
        name: 'Thesis',
        description: 'Final year',
        deliveryDate: '2027-01-18',
        taskIds: ['b', 'a'],
        priority: 'urgent',
        links: [{ label: 'Repo', url: 'https://example.com/repo' }],
        tagIds: ['work', 'school'],
      },
    ])
    expect((await call('GET', 'tags', undefined, session)).body.map((t: { id: string }) => t.id)).toEqual([
      'archive',
      'personal',
      'school',
      'work',
    ])
    expect((await call('GET', 'tasks', undefined, await signUp('other@example.com'))).body).toEqual([])
  })

  it('skips migrations that wrangler already applied', async () => {
    const before = await appliedNames()
    // Would fail with "table already exists" if it ran 0001 again
    await migrate(env.DB)
    expect(await appliedNames()).toEqual(before)
  })
})
