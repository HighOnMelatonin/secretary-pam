// Integration tests for worker/migrate.ts, against the real D1 database that setup.ts
// has already applied migrations/ to with wrangler's own migration code.
import { applyD1Migrations, env } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import type { LoggedEvent } from '../../src/types/events'
import type { Tag } from '../../src/types/tag'
import { migrate } from '../migrate'
import { call, signUp } from './helpers'

// Children first, so nothing references a dropped table
const TABLES = [
  'task_events',
  'google_events',
  'google_auth_states',
  'google_accounts',
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
      '0005_tag_colors.sql',
      '0006_google_calendar.sql',
      '0007_task_events.sql',
    ])
    expect((await call('GET', 'projects', undefined, await signUp())).body).toEqual([])
  })

  it('starts a new database with the example tags and the Archive tag, for the first account', async () => {
    await dropEverything()
    await migrate(env.DB)

    expect((await call('GET', 'tags', undefined, await signUp())).body).toEqual([
      { id: 'archive', name: 'Archive', color: '#343ca6' },
      { id: 'personal', name: 'Personal', color: '#343ca6' },
      { id: 'school', name: 'School (SUTD)', color: '#343ca6' },
      { id: 'work', name: 'Work', color: '#343ca6' },
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
    expect((await call('GET', 'tags', undefined, session)).body).toContainEqual({ id: 'archive', name: 'Archive (completed)', color: '#343ca6' })
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

  it('makes every existing tag indigo, the colour tags had before (0005)', async () => {
    await databaseBefore(4)
    await env.DB.prepare("INSERT INTO tags (user_id, id, name) VALUES ('original', 'mine', 'Mine')").run()

    await migrate(env.DB)

    const tags: Tag[] = (await call('GET', 'tags', undefined, await signUp())).body
    expect(tags.map((t) => [t.id, t.color])).toEqual([
      ['archive', '#343ca6'],
      ['mine', '#343ca6'],
      ['personal', '#343ca6'],
      ['school', '#343ca6'],
      ['work', '#343ca6'],
    ])
  })

  it("logs each task's creation and project memberships as backfilled, at the time the task was made (0007)", async () => {
    await databaseBefore(6)
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO tasks (user_id, id, name, due_date, created_at) VALUES
           ('original', 'b', 'B', NULL, '2026-02-01T00:00:00.000Z'),
           ('original', 'a', 'A', '2026-03-01', '2026-01-01T00:00:00.000Z'),
           ('original', 'g', 'Imported', '2026-04-01', '2026-01-15T00:00:00.000Z')`,
      ),
      env.DB.prepare(
        `INSERT INTO projects (user_id, id, name, delivery_date, created_at) VALUES
           ('original', 'p', 'P', '2026-06-01', '2025-12-01T00:00:00.000Z'), ('original', 'q', 'Q', NULL, '2025-12-02T00:00:00.000Z')`,
      ),
      env.DB.prepare(
        `INSERT INTO project_tasks (user_id, project_id, task_id, position) VALUES
           ('original', 'p', 'a', 0), ('original', 'q', 'a', 0), ('original', 'p', 'g', 1)`,
      ),
      env.DB.prepare(
        `INSERT INTO google_events (user_id, task_id, account_email, calendar_id, event_id, starts_at, ends_at)
         VALUES ('original', 'g', 'me@gmail.com', 'primary', 'e', '2026-04-01T00:00:00Z', '2026-04-02T00:00:00Z')`,
      ),
    ])

    await migrate(env.DB)

    const events: LoggedEvent[] = (await call('GET', 'events', undefined, await signUp())).body
    expect(events.map((e) => [e.at.slice(0, 10), e.kind, e.taskId, e.projectId, e.newValue, e.deliveryDateAtTime, e.taskSource])).toEqual([
      ['2026-01-01', 'task_created', 'a', null, '2026-03-01', null, 'app'],
      ['2026-01-01', 'task_added_to_project', 'a', 'p', null, '2026-06-01', 'app'],
      ['2026-01-01', 'task_added_to_project', 'a', 'q', null, null, 'app'],
      ['2026-01-15', 'task_created', 'g', null, '2026-04-01', null, 'google'],
      ['2026-01-15', 'task_added_to_project', 'g', 'p', null, '2026-06-01', 'google'],
      ['2026-02-01', 'task_created', 'b', null, null, null, 'app'],
    ])
    expect(events.every((e) => e.source === 'backfill' && e.oldValue === null)).toBe(true)
  })

  it('skips migrations that wrangler already applied', async () => {
    const before = await appliedNames()
    // Would fail with "table already exists" if it ran 0001 again
    await migrate(env.DB)
    expect(await appliedNames()).toEqual(before)
  })
})
