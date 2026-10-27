// Integration tests for worker/migrate.ts, against the real D1 database that setup.ts
// has already applied migrations/ to with wrangler's own migration code.
import { env, SELF } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import { migrate } from '../migrate'

const TABLES = ['project_links', 'project_tasks', 'project_tags', 'task_relations', 'projects', 'tasks', 'tags']

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
    expect(await appliedNames()).toEqual([
      '0001_create_projects_and_tasks.sql',
      '0002_add_tags.sql',
      '0003_project_tags_and_archive.sql',
    ])
    const response = await SELF.fetch('http://localhost/api/projects')
    expect(await response.json()).toEqual([])
  })

  it('starts a new database with the example tags and the Archive tag', async () => {
    await env.DB.batch([...TABLES, 'd1_migrations'].map((table) => env.DB.prepare(`DROP TABLE ${table}`)))
    await migrate(env.DB)

    const response = await SELF.fetch('http://localhost/api/tags')
    expect(await response.json()).toEqual([
      { id: 'archive', name: 'Archive' },
      { id: 'personal', name: 'Personal' },
      { id: 'school', name: 'School (SUTD)' },
      { id: 'work', name: 'Work' },
    ])
  })

  it("moves each project's tag to project_tags and archives completed projects (0003)", async () => {
    // Back to the database as it was before 0003, with a tag already called Archive
    await env.DB.batch([
      env.DB.prepare('DROP TABLE project_tags'),
      env.DB.prepare("DELETE FROM d1_migrations WHERE name = '0003_project_tags_and_archive.sql'"),
      env.DB.prepare("INSERT INTO tags (id, name) VALUES ('school', 'School'), ('mine', 'archive')"),
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

    const projects: { id: string; tagIds: string[] }[] = await (await SELF.fetch('http://localhost/api/projects')).json()
    expect(projects.map((p) => [p.id, p.tagIds])).toEqual([
      ['finished', ['school', 'archive']],
      ['ongoing', ['school']],
      ['empty', []],
      ['untagged', ['archive']],
    ])
    const tags = await (await SELF.fetch('http://localhost/api/tags')).json()
    expect(tags).toContainEqual({ id: 'archive', name: 'Archive (completed)' })
  })

  it('skips migrations that wrangler already applied', async () => {
    const before = await appliedNames()
    // Would fail with "table already exists" if it ran 0001 again
    await migrate(env.DB)
    expect(await appliedNames()).toEqual(before)
  })
})
