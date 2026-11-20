// Integration tests for history (migrations/0013_history.sql and worker/history.ts): the triggers
// on each table, the sources they log, the list writes that keep unchanged rows out of it, and
// deleting an account with its history. The Google sync's and the bot's sources are tested in
// google.spec.ts and telegram.spec.ts, with their fakes.
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { createEmptyProject, type Project } from '../../src/types/project'
import { createEmptyTask, type Task } from '../../src/types/task'
import { deleteAccountStatements } from '../history'
import { statements } from '../migrate'
import { call, signUp } from './helpers'

interface Row {
  id: number
  table_name: string
  row_key: string
  op: string
  source: string
  data: Record<string, unknown>
  old_data: Record<string, unknown> | null
}

// History logged after the row with id `after`, oldest first, with its JSON parsed
async function logged(after = 0): Promise<Row[]> {
  const { results } = await env.DB.prepare(
    'SELECT id, table_name, row_key, op, source, data, old_data FROM history WHERE id > ?1 ORDER BY id',
  )
    .bind(after)
    .all<Omit<Row, 'data' | 'old_data'> & { data: string; old_data: string | null }>()
  return results.map((r) => ({ ...r, data: JSON.parse(r.data), old_data: r.old_data === null ? null : JSON.parse(r.old_data) }))
}

const lastId = async () => (await env.DB.prepare('SELECT coalesce(max(id), 0) AS id FROM history').first<number>('id'))!
const run = (...sql: string[]) => env.DB.batch(sql.map((s) => env.DB.prepare(s)))
// Just what the tests compare: the table, key, op and source of each row
const summary = (rows: Row[]) => rows.map((r) => [r.table_name, r.row_key, r.op, r.source])

describe('the triggers', () => {
  beforeEach(async () => {
    await run("INSERT INTO users (id, email) VALUES ('u', 'u@example.com')")
  })

  it('log a task inserted, updated and deleted, with the whole row, and nothing for updated_at or changed_by alone', async () => {
    await run(
      `INSERT INTO tasks (user_id, id, name, due_date, created_at, updated_at, changed_by)
       VALUES ('u', 't', 'Write', '2026-12-01', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 'web-mobile')`,
    )
    const task = {
      id: 't',
      name: 'Write',
      description: '',
      due_date: '2026-12-01',
      priority: 'medium',
      completed: 0,
      effort_minutes: null,
      start_date: null,
      pinned_date: null,
      created_at: '2026-11-01T00:00:00.000Z',
      updated_at: '2026-11-01T00:00:00.000Z',
    }
    expect(await logged()).toMatchObject([{ table_name: 'tasks', row_key: 't', op: 'insert', source: 'web-mobile', data: task, old_data: null }])

    const before = await lastId()
    await run(
      "UPDATE tasks SET updated_at = '2026-11-02T00:00:00.000Z'",
      "UPDATE tasks SET changed_by = 'telegram'",
      "UPDATE tasks SET updated_at = '2026-11-03T00:00:00.000Z', changed_by = 'google'",
    )
    expect(await logged(before)).toEqual([])

    await run("UPDATE tasks SET completed = 1, effort_minutes = 30, changed_by = 'web-desktop'")
    const updated = { ...task, completed: 1, effort_minutes: 30, updated_at: '2026-11-03T00:00:00.000Z' }
    expect(await logged(before)).toMatchObject([
      { op: 'update', source: 'web-desktop', data: updated, old_data: { ...task, updated_at: '2026-11-03T00:00:00.000Z' } },
    ])

    const beforeDelete = await lastId()
    await run("UPDATE tasks SET changed_by = 'telegram'", 'DELETE FROM tasks')
    expect(await logged(beforeDelete)).toMatchObject([{ op: 'delete', source: 'telegram', data: updated, old_data: null }])
  })

  it('compare NULLs as values, so clearing or setting a date is logged', async () => {
    await run("INSERT INTO tasks (user_id, id, name) VALUES ('u', 't', 'Write')")
    const before = await lastId()
    await run("UPDATE tasks SET due_date = '2026-12-01'", 'UPDATE tasks SET due_date = NULL', 'UPDATE tasks SET due_date = NULL')
    const rows = await logged(before)
    expect(rows.map((r) => [r.old_data!.due_date, r.data.due_date])).toEqual([
      [null, '2026-12-01'],
      ['2026-12-01', null],
    ])
  })

  it('log projects and tags the same way', async () => {
    await run(
      "INSERT INTO projects (user_id, id, name, delivery_date, changed_by) VALUES ('u', 'p', 'Thesis', '2027-01-18', 'web-desktop')",
      "INSERT INTO tags (user_id, id, name, color, changed_by) VALUES ('u', 'g', 'Uni', '#112233', 'web-mobile')",
      "UPDATE projects SET updated_at = 'later'",
      "UPDATE tags SET updated_at = 'later'",
      "UPDATE projects SET delivery_date = '2027-02-01'",
      "UPDATE tags SET color = '#445566'",
      'DELETE FROM projects',
      'DELETE FROM tags',
    )
    const rows = await logged()
    expect(summary(rows)).toEqual([
      ['projects', 'p', 'insert', 'web-desktop'],
      ['tags', 'g', 'insert', 'web-mobile'],
      ['projects', 'p', 'update', 'web-desktop'],
      ['tags', 'g', 'update', 'web-mobile'],
      ['projects', 'p', 'delete', 'web-desktop'],
      ['tags', 'g', 'delete', 'web-mobile'],
    ])
    expect(rows[0]!.data).toEqual({
      id: 'p',
      name: 'Thesis',
      description: '',
      delivery_date: '2027-01-18',
      priority: 'medium',
      created_at: expect.any(String),
      updated_at: expect.any(String),
    })
    expect(rows[1]!.data).toEqual({ id: 'g', name: 'Uni', color: '#112233', created_at: expect.any(String), updated_at: expect.any(String) })
    expect([rows[2]!.old_data!.delivery_date, rows[2]!.data.delivery_date]).toEqual(['2027-01-18', '2027-02-01'])
    expect([rows[3]!.old_data!.color, rows[3]!.data.color]).toEqual(['#112233', '#445566'])
  })

  it('log the list tables, taking the source from the row that owns the list, and not a change of position', async () => {
    await run(
      "INSERT INTO tasks (user_id, id, name, changed_by) VALUES ('u', 'a', 'A', 'web-desktop'), ('u', 'b', 'B', 'telegram')",
      "INSERT INTO projects (user_id, id, name, changed_by) VALUES ('u', 'p', 'P', 'web-mobile')",
      "INSERT INTO tags (user_id, id, name, changed_by) VALUES ('u', 'g', 'G', 'google')",
    )
    const before = await lastId()
    await run(
      "INSERT INTO project_tasks (user_id, project_id, task_id, position) VALUES ('u', 'p', 'a', 0)",
      "INSERT INTO project_tags (user_id, project_id, tag_id, position) VALUES ('u', 'p', 'g', 0)",
      "INSERT INTO task_tags (user_id, task_id, tag_id, position) VALUES ('u', 'a', 'g', 0)",
      "INSERT INTO task_relations (user_id, task_id, related_task_id, type, position) VALUES ('u', 'a', 'b', 'blocks', 0)",
      'UPDATE project_tasks SET position = 5',
      'UPDATE project_tags SET position = 5',
      'UPDATE task_tags SET position = 5',
      'UPDATE task_relations SET position = 5',
      "UPDATE task_relations SET type = 'related_to'",
      'DELETE FROM project_tasks',
      'DELETE FROM project_tags',
      'DELETE FROM task_tags',
      'DELETE FROM task_relations',
    )
    const rows = await logged(before)
    expect(summary(rows)).toEqual([
      ['project_tasks', 'p:a', 'insert', 'web-mobile'],
      ['project_tags', 'p:g', 'insert', 'web-mobile'],
      ['task_tags', 'a:g', 'insert', 'web-desktop'],
      ['task_relations', 'a:b', 'insert', 'web-desktop'],
      ['task_relations', 'a:b', 'update', 'web-desktop'],
      ['project_tasks', 'p:a', 'delete', 'web-mobile'],
      ['project_tags', 'p:g', 'delete', 'web-mobile'],
      ['task_tags', 'a:g', 'delete', 'web-desktop'],
      ['task_relations', 'a:b', 'delete', 'web-desktop'],
    ])
    expect(rows[0]!.data).toEqual({ project_id: 'p', task_id: 'a', position: 0 })
    expect(rows[1]!.data).toEqual({ project_id: 'p', tag_id: 'g', position: 0 })
    expect(rows[2]!.data).toEqual({ task_id: 'a', tag_id: 'g', position: 0 })
    expect(rows[3]!.data).toEqual({ task_id: 'a', related_task_id: 'b', type: 'blocks', position: 0 })
    expect(rows[4]).toMatchObject({
      data: { type: 'related_to', position: 5 },
      old_data: { type: 'blocks', position: 5 },
    })
    expect(rows[5]!.data).toEqual({ project_id: 'p', task_id: 'a', position: 5 })
  })

  it('refuse to change a history row, but let one be deleted', async () => {
    await run("INSERT INTO tasks (user_id, id, name) VALUES ('u', 't', 'Write')")
    await expect(env.DB.prepare("UPDATE history SET source = 'google'").run()).rejects.toThrow(/history is append-only/)
    await expect(env.DB.prepare("UPDATE history SET data = '{}' WHERE user_id = 'u'").run()).rejects.toThrow(/append-only/)
    expect((await logged())[0]!.source).toBe('unknown')
    await env.DB.prepare('DELETE FROM history').run()
    expect(await logged()).toEqual([])
  })
})

describe('saves through the API', () => {
  let session: string
  const mobile: Record<string, string> = { 'X-Pam-Client': 'web-mobile' }
  const desktop: Record<string, string> = { 'X-Pam-Client': 'web-desktop' }

  beforeEach(async () => {
    session = await signUp()
  })

  const task = (name: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id: name.toLowerCase(), name, ...fields })
  const project = (name: string, fields: Partial<Project> = {}): Project => ({
    ...createEmptyProject(),
    id: name.toLowerCase(),
    name,
    ...fields,
  })
  const saveTask = async (t: Task, headers = desktop) => expect((await call('PUT', `tasks/${t.id}`, { task: t }, session, headers)).status).toBe(200)
  const saveProject = async (p: Project, headers = desktop) =>
    expect((await call('PUT', `projects/${p.id}`, { project: p }, session, headers)).status).toBe(200)
  const taskIdsOf = async (id: string) =>
    ((await call('GET', 'projects', undefined, session)).body as Project[]).find((p) => p.id === id)!.taskIds

  it('log who saved, from X-Pam-Client, and unknown without it', async () => {
    const before = await lastId()
    await saveTask(task('A'), desktop)
    await saveTask(task('B'), mobile)
    await saveTask(task('C'), {})
    await saveTask(task('D'), { 'X-Pam-Client': 'fridge' })
    await saveTask(task('A', { priority: 'high' }), mobile)
    expect(summary(await logged(before))).toEqual([
      ['tasks', 'a', 'insert', 'web-desktop'],
      ['tasks', 'b', 'insert', 'web-mobile'],
      ['tasks', 'c', 'insert', 'unknown'],
      ['tasks', 'd', 'insert', 'unknown'],
      ['tasks', 'a', 'update', 'web-mobile'],
    ])
  })

  it("never returns changed_by", async () => {
    await saveTask(task('A'))
    await saveProject(project('P'))
    const tasks = (await call('GET', 'tasks', undefined, session)).body
    const projects = (await call('GET', 'projects', undefined, session)).body
    const tags = (await call('GET', 'tags', undefined, session)).body
    expect(JSON.stringify([tasks, projects, tags])).not.toContain('changed_by')
    expect(JSON.stringify([tasks, projects, tags])).not.toContain('changedBy')
  })

  it('logs nothing for a project saved unchanged, and one insert for one task added to it', async () => {
    for (const name of ['A', 'B', 'C', 'D']) await saveTask(task(name))
    const p = project('P', { taskIds: ['a', 'b', 'c'], tagIds: ['work', 'school'], links: [{ label: 'Repo', url: 'https://example.com' }] })
    await saveProject(p)

    let before = await lastId()
    await saveProject(p)
    expect(await logged(before)).toEqual([])

    before = await lastId()
    await saveProject({ ...p, taskIds: ['a', 'b', 'c', 'd'] })
    expect(summary(await logged(before))).toEqual([['project_tasks', 'p:d', 'insert', 'web-desktop']])
    expect(await taskIdsOf('p')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('logs only the rows that came or went, and nothing for a new order, which is still kept', async () => {
    for (const name of ['A', 'B', 'C', 'D']) await saveTask(task(name))
    await saveProject(project('P', { taskIds: ['a', 'b', 'c'], tagIds: ['work'] }))

    let before = await lastId()
    await saveProject(project('P', { taskIds: ['c', 'a', 'b'], tagIds: ['work'] }))
    expect(await logged(before)).toEqual([])
    expect(await taskIdsOf('p')).toEqual(['c', 'a', 'b'])

    before = await lastId()
    await saveProject(project('P', { taskIds: ['b', 'd', 'c'], tagIds: ['school', 'work'] }), mobile)
    expect(summary(await logged(before))).toEqual([
      ['project_tasks', 'p:a', 'delete', 'web-mobile'],
      ['project_tasks', 'p:d', 'insert', 'web-mobile'],
      ['project_tags', 'p:school', 'insert', 'web-mobile'],
    ])
    expect(await taskIdsOf('p')).toEqual(['b', 'd', 'c'])
    const tags = ((await call('GET', 'projects', undefined, session)).body as Project[])[0]!.tagIds
    expect(tags).toEqual(['school', 'work'])
  })

  it('keeps the order right after a delete leaves a gap in the positions', async () => {
    for (const name of ['A', 'B', 'C', 'D']) await saveTask(task(name))
    await saveProject(project('P', { taskIds: ['a', 'b', 'c'] }))
    expect((await call('DELETE', 'tasks/b', undefined, session)).status).toBe(204) // c keeps position 2

    // c stays second in the list, so only its position in the table says it's after the new d
    await saveProject(project('P', { taskIds: ['a', 'c', 'd'] }))
    expect(await taskIdsOf('p')).toEqual(['a', 'c', 'd'])
    await saveProject(project('P', { taskIds: ['d', 'a', 'c'] }))
    expect(await taskIdsOf('p')).toEqual(['d', 'a', 'c'])
  })

  it("logs a relation's type change as an update, and task tags as they come and go", async () => {
    await saveTask(task('B'))
    await saveTask(task('C'))
    await saveTask(task('A', { relations: [{ taskId: 'b', type: 'blocks' }], tagIds: ['work'] }))

    let before = await lastId()
    await saveTask(task('A', { relations: [{ taskId: 'b', type: 'blocks' }], tagIds: ['work'] }))
    expect(await logged(before)).toEqual([])

    before = await lastId()
    await saveTask(
      task('A', { relations: [{ taskId: 'c', type: 'related_to' }, { taskId: 'b', type: 'related_to' }], tagIds: ['school'] }),
      mobile,
    )
    const rows = await logged(before)
    expect(summary(rows)).toEqual([
      ['task_relations', 'a:c', 'insert', 'web-mobile'],
      ['task_relations', 'a:b', 'update', 'web-mobile'],
      ['task_tags', 'a:work', 'delete', 'web-mobile'],
      ['task_tags', 'a:school', 'insert', 'web-mobile'],
    ])
    expect(rows[1]).toMatchObject({ old_data: { type: 'blocks' }, data: { type: 'related_to' } })
    const saved = ((await call('GET', 'tasks', undefined, session)).body as Task[]).find((t) => t.id === 'a')!
    expect(saved.relations).toEqual([
      { taskId: 'c', type: 'related_to' },
      { taskId: 'b', type: 'related_to' },
    ])
  })

  it("logs a task's delete, and its removal from each project, relation and tag, as from whoever deleted it", async () => {
    await saveTask(task('B'))
    await saveTask(task('A', { relations: [{ taskId: 'b', type: 'blocks' }], tagIds: ['work'] }))
    await saveTask(task('C', { relations: [{ taskId: 'a', type: 'related_to' }] }))
    await saveProject(project('P', { taskIds: ['a', 'b'] }))
    await saveProject(project('Q', { taskIds: ['a'] }))

    const before = await lastId()
    expect((await call('DELETE', 'tasks/a', undefined, session, mobile)).status).toBe(204)
    const rows = await logged(before)
    expect(rows.every((r) => r.source === 'web-mobile')).toBe(true)
    expect(rows.filter((r) => r.table_name === 'tasks')).toMatchObject([{ row_key: 'a', op: 'delete', data: { name: 'A' } }])
    expect(
      rows
        .filter((r) => r.table_name !== 'tasks')
        .map((r) => [r.table_name, r.row_key, r.op])
        .sort(),
    ).toEqual([
      ['project_tasks', 'p:a', 'delete'],
      ['project_tasks', 'q:a', 'delete'],
      ['task_relations', 'a:b', 'delete'],
      ['task_relations', 'c:a', 'delete'],
      ['task_tags', 'a:work', 'delete'],
    ])
  })

  it("logs a project's and a tag's deletes the same way", async () => {
    await saveTask(task('A', { tagIds: ['work'] }))
    await saveProject(project('P', { taskIds: ['a'], tagIds: ['work'] }))
    await saveProject(project('Q', { tagIds: ['work'] }))

    let before = await lastId()
    expect((await call('DELETE', 'projects/p', undefined, session, mobile)).status).toBe(204)
    expect(summary(await logged(before)).sort()).toEqual([
      ['project_tags', 'p:work', 'delete', 'web-mobile'],
      ['project_tasks', 'p:a', 'delete', 'web-mobile'],
      ['projects', 'p', 'delete', 'web-mobile'],
    ])

    before = await lastId()
    expect((await call('DELETE', 'tags/work', undefined, session, mobile)).status).toBe(204)
    expect(summary(await logged(before)).sort()).toEqual([
      ['project_tags', 'q:work', 'delete', 'web-mobile'],
      ['tags', 'work', 'delete', 'web-mobile'],
      ['task_tags', 'a:work', 'delete', 'web-mobile'],
    ])
  })

  it('logs the starting tags of a new account as made from the client it signed up on', async () => {
    const before = await lastId()
    await call('POST', 'auth/signup', { email: 'new@example.com', password: 'correct horse battery' }, undefined, mobile)
    expect(summary(await logged(before))).toEqual([
      ['tags', 'school', 'insert', 'web-mobile'],
      ['tags', 'work', 'insert', 'web-mobile'],
      ['tags', 'personal', 'insert', 'web-mobile'],
      ['tags', 'archive', 'insert', 'web-mobile'],
    ])
  })

  it('logs nothing for a refused save', async () => {
    await saveProject(project('P', { deliveryDate: '2026-12-01' }))
    const before = await lastId()
    const late = task('A', { dueDate: '2026-12-10' })
    const response = await call('PUT', 'tasks/a', { task: late, projectIds: ['p'] }, session, desktop)
    expect(response.status).toBe(409)
    expect(await logged(before)).toEqual([])
  })
})

describe('deleting an account', () => {
  it("deletes the account and all of its history, and leaves other accounts' alone", async () => {
    const mine = await signUp('me@example.com')
    const other = await signUp('other@example.com')
    for (const session of [mine, other]) {
      const t = { ...createEmptyTask(), id: 't', name: 'T' }
      await call('PUT', 'tasks/t', { task: t }, session)
      await call('PUT', 'projects/p', { project: { ...createEmptyProject(), id: 'p', name: 'P', taskIds: ['t'] } }, session)
    }
    const userId = (email: string) => env.DB.prepare('SELECT id FROM users WHERE email = ?1').bind(email).first<string>('id')
    const me = (await userId('me@example.com'))!
    const them = (await userId('other@example.com'))!
    await env.DB.prepare("INSERT INTO usage_counts VALUES (?1, '2026-11-20', 3, 'web-mobile', 'task_create', 2)").bind(me).run()
    const count = async (table: string, user: string) =>
      (await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id = ?1`).bind(user).first<number>('n'))!
    const theirs = await count('history', them)

    await env.DB.batch(deleteAccountStatements(env.DB, me))

    expect(await userId('me@example.com')).toBeNull()
    expect(await count('history', me)).toBe(0)
    expect(await count('usage_counts', me)).toBe(0)
    expect(await count('tasks', me)).toBe(0)
    expect(await count('history', them)).toBe(theirs)
  })
})

describe("migrate.ts's statement splitter", () => {
  it('keeps a trigger whole, with the statements in its body', () => {
    const sql = [
      '-- A comment; with a semicolon',
      'CREATE TABLE a (x);',
      '',
      '-- The trigger',
      'CREATE TRIGGER t AFTER INSERT ON a',
      'BEGIN',
      "  INSERT INTO a VALUES (CASE WHEN NEW.x > 1 THEN 1 ELSE 2 END);",
      '  INSERT INTO a VALUES (3);',
      'END;',
      'CREATE INDEX i ON a (x);',
    ].join('\n')
    const split = statements(sql).map((s) => s.trim())
    expect(split).toHaveLength(3)
    expect(split[0]).toMatch(/CREATE TABLE a \(x\)$/)
    expect(split[1]).toMatch(/^-- The trigger\nCREATE TRIGGER t[\s\S]*\(3\);\nEND$/)
    expect(split[1]).toContain('END);\n')
    expect(split[2]).toBe('CREATE INDEX i ON a (x)')
  })

  it('splits every migration as wrangler does', () => {
    for (const migration of env.TEST_MIGRATIONS) {
      const sql = migration.queries.join(';\n') + ';\n'
      expect(statements(sql).length, migration.name).toBe(migration.queries.length)
    }
  })
})
