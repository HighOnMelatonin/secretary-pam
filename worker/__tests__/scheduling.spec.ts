// Integration tests for the scheduling inputs to prioritisation (docs/priority-algorithm.md): the
// estimate, start and pinned dates on tasks, refusing blocking loops, and GET and PUT
// /api/settings. Each test is signed in to a new account, as in api.spec.ts.
import { env } from 'cloudflare:test'
import { beforeEach, describe, it, expect } from 'vitest'
import { forecast } from '../../src/types/forecast'
import { prioritise } from '../../src/types/priority'
import type { Project } from '../../src/types/project'
import { DEFAULT_SETTINGS, type UserSettings } from '../../src/types/settings'
import type { Task } from '../../src/types/task'
import * as helpers from './helpers'

let session: string

beforeEach(async () => {
  session = await helpers.signUp()
})

const call = async (method: string, path: string, body?: unknown) => {
  const { status, body: reply } = await helpers.call(method, path, body, session)
  return { status, body: reply }
}

const listTasks = async (): Promise<Task[]> => (await call('GET', 'tasks')).body
const saveTask = (task: Task) => call('PUT', `tasks/${task.id}`, { task })
const saveProject = (project: Project) => call('PUT', `projects/${project.id}`, { project })

const task = (id: string, fields: Partial<Task> = {}): Task => ({
  id,
  name: `Task ${id}`,
  description: '',
  dueDate: null,
  relations: [],
  priority: 'medium',
  completed: false,
  ...fields,
})

const project = (id: string, fields: Partial<Project> = {}): Project => ({
  id,
  name: `Project ${id}`,
  description: '',
  deliveryDate: null,
  taskIds: [],
  priority: 'medium',
  links: [],
  tagIds: [],
  ...fields,
})

const count = async (table: string) =>
  (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())!.n

describe('task estimates, start dates and pinned dates', () => {
  const scheduled = task('a', { dueDate: '2026-11-20', effortMinutes: 90, startDate: '2026-11-18', pinnedDate: '2026-11-16' })

  it('saves and reads them back', async () => {
    expect(await saveTask(scheduled)).toEqual({ status: 200, body: { tasks: [scheduled], projects: [] } })
    expect(await listTasks()).toEqual([scheduled])
  })

  it('clears them when left out or sent as null, and leaves them out of what it returns', async () => {
    await saveTask(scheduled)
    expect((await saveTask(task('a', { dueDate: '2026-11-20' }))).status).toBe(200)
    expect(await listTasks()).toEqual([task('a', { dueDate: '2026-11-20' })])

    await saveTask(scheduled)
    const nulls = { ...task('a', { dueDate: '2026-11-20' }), effortMinutes: null, startDate: null, pinnedDate: null }
    expect(await call('PUT', 'tasks/a', { task: nulls })).toEqual({
      status: 200,
      body: { tasks: [task('a', { dueDate: '2026-11-20' })], projects: [] },
    })
    expect(await listTasks()).toEqual([task('a', { dueDate: '2026-11-20' })])
  })

  it('accepts a start date on the due date, or with no due date', async () => {
    expect((await saveTask(task('a', { dueDate: '2026-11-20', startDate: '2026-11-20' }))).status).toBe(200)
    expect((await saveTask(task('b', { startDate: '2026-11-20' }))).status).toBe(200)
  })

  it.each<[string, Record<string, unknown>, string]>([
    ['an estimate of 0', { effortMinutes: 0 }, 'effortMinutes must be'],
    ['a negative estimate', { effortMinutes: -30 }, 'effortMinutes must be'],
    ['an estimate in part minutes', { effortMinutes: 1.5 }, 'effortMinutes must be'],
    ['an estimate as text', { effortMinutes: '60' }, 'effortMinutes must be'],
    ['an estimate over 1,000 hours', { effortMinutes: 60_001 }, 'effortMinutes must be'],
    ['a start date in another format', { startDate: '18/11/2026' }, 'startDate must be'],
    ['a start date that is a number', { startDate: 20261118 }, 'startDate must be'],
    ['a pinned date that is not a date', { pinnedDate: 'today' }, 'pinnedDate must be'],
    ['a start date after the due date', { dueDate: '2026-11-20', startDate: '2026-11-21' }, 'startDate must be on or before dueDate'],
  ])('refuses a task with %s', async (_, fields, message) => {
    const response = await call('PUT', 'tasks/a', { task: { ...task('a'), ...fields } })
    expect(response.status).toBe(400)
    expect(response.body.error).toContain(message)
    expect(await listTasks()).toEqual([])
  })

  it('moves the start date back when a project save moves the due date before it', async () => {
    await saveTask(task('a', { dueDate: '2026-12-10', startDate: '2026-12-05', effortMinutes: 60 }))
    await saveProject(project('p', { taskIds: ['a'], deliveryDate: '2026-12-10' }))

    const moved = task('a', { dueDate: '2026-12-03', startDate: '2026-12-03', effortMinutes: 60 })
    const response = await call('PUT', 'projects/p', {
      project: project('p', { taskIds: ['a'], deliveryDate: '2026-12-03' }),
      dueDates: { a: '2026-12-03' },
    })
    expect(response.status).toBe(200)
    expect(response.body.tasks).toEqual([moved])
    expect(await listTasks()).toEqual([moved])
  })

  it('moves the start date back when an import moves the due date before it', async () => {
    const stored = task('a', { dueDate: '2026-12-10', startDate: '2026-12-05', pinnedDate: '2026-12-01' })
    await saveTask(stored)
    await saveProject(project('p', { taskIds: ['a'] }))

    // As the import dialog sends it: the stored task with the file's fields
    const response = await call('POST', 'projects/p/import', { tasks: [{ ...stored, dueDate: '2026-12-02' }] })
    expect(response.status).toBe(200)
    expect(await listTasks()).toEqual([{ ...stored, dueDate: '2026-12-02', startDate: '2026-12-02' }])
  })
})

describe('blocking loops', () => {
  beforeEach(async () => {
    // Draft blocks Review, and Print is blocked by Review: Draft -> Review -> Print
    // A relation can only name a task that exists, so Review is saved first
    expect((await saveTask(task('b', { name: 'Review' }))).status).toBe(200)
    expect((await saveTask(task('a', { name: 'Draft', relations: [{ taskId: 'b', type: 'blocks' }] }))).status).toBe(200)
    expect((await saveTask(task('c', { name: 'Print', relations: [{ taskId: 'b', type: 'blocked_by' }] }))).status).toBe(200)
  })

  it('refuses a save that closes a loop, naming the tasks in it, and saves nothing', async () => {
    const before = await listTasks()
    const closing = task('c', { name: 'Print again', relations: [{ taskId: 'b', type: 'blocked_by' }, { taskId: 'a', type: 'blocks' }] })

    expect(await saveTask(closing)).toEqual({
      status: 400,
      body: {
        error: 'This would make a loop of blocking tasks: "Print again" blocks "Draft", which blocks "Review", which blocks "Print again"',
        loop: ['c', 'a', 'b'],
      },
    })
    expect(await listTasks()).toEqual(before)
  })

  it('refuses a loop of two made from the other side', async () => {
    const response = await saveTask(task('b', { name: 'Review', relations: [{ taskId: 'a', type: 'blocks' }] }))
    expect(response.status).toBe(400)
    expect(response.body.loop).toEqual(['b', 'a'])
  })

  it('refuses a new task that closes a loop, and accepts ones that only add to the chain', async () => {
    // Print -> Task d -> Draft -> Review -> Print
    const response = await saveTask(task('d', { relations: [{ taskId: 'a', type: 'blocks' }, { taskId: 'c', type: 'blocked_by' }] }))
    expect(response.status).toBe(400)
    expect((await saveTask(task('d', { relations: [{ taskId: 'a', type: 'blocks' }] }))).status).toBe(200)
    expect((await saveTask(task('e', { relations: [{ taskId: 'c', type: 'blocked_by' }] }))).status).toBe(200)
  })

  it('lets saves through that leave a loop already in the data alone', async () => {
    // Made before loops were refused: Review blocks Draft as well
    const { id: userId } = (await env.DB.prepare('SELECT id FROM users').first<{ id: string }>())!
    await env.DB.prepare(
      "INSERT INTO task_relations (user_id, task_id, related_task_id, type, position) VALUES (?1, 'b', 'a', 'blocks', 0)",
    )
      .bind(userId)
      .run()

    const done = task('a', { name: 'Draft', completed: true, relations: [{ taskId: 'b', type: 'blocks' }] })
    expect((await saveTask(done)).status).toBe(200)
  })
})

describe('quick actions', () => {
  const act = (id: string, body: unknown) => call('POST', `tasks/${id}/action`, body)
  const stored = task('a', { name: 'Draft', dueDate: '2026-11-20', effortMinutes: 90 })

  beforeEach(async () => {
    await saveTask(stored)
    await saveProject(project('p', { taskIds: ['a'] }))
  })

  it.each<[string, Record<string, unknown>, Partial<Task>]>([
    ['pins it to today', { action: 'do_today', today: '2026-11-16' }, { pinnedDate: '2026-11-16' }],
    ['starts it tomorrow', { action: 'not_today', today: '2026-11-16' }, { startDate: '2026-11-17' }],
    ['raises its priority', { action: 'importance', direction: 'up' }, { priority: 'high' }],
    ['lowers its priority', { action: 'importance', direction: 'down' }, { priority: 'low' }],
    ['sets its estimate', { action: 'estimate', effortMinutes: 240 }, { effortMinutes: 240 }],
  ])('%s, changing nothing else, and returns the changes', async (_, body, change) => {
    const changed = { ...stored, ...change }
    expect(await act('a', body)).toEqual({ status: 200, body: { tasks: [changed], projects: [] } })
    expect(await listTasks()).toEqual([changed])
  })

  it('unpins it and clears its estimate', async () => {
    await act('a', { action: 'do_today', today: '2026-11-16' })
    await act('a', { action: 'unpin' })
    await act('a', { action: 'estimate', effortMinutes: null })
    expect(await listTasks()).toEqual([task('a', { name: 'Draft', dueDate: '2026-11-20' })])
  })

  it('refuses Not today for a task due today, and a priority past the top, saving nothing', async () => {
    expect(await act('a', { action: 'not_today', today: '2026-11-20' })).toEqual({
      status: 400,
      body: {
        error: `"Draft": It's due today, so it can't wait until tomorrow`,
        code: 'due_today',
        params: { taskId: 'a', task: 'Draft', dueDate: '2026-11-20' },
        text: `"Draft": It's due today, so it can't wait until tomorrow`,
      },
    })
    await act('a', { action: 'importance', direction: 'up' })
    await act('a', { action: 'importance', direction: 'up' })
    expect(await act('a', { action: 'importance', direction: 'up' })).toEqual({
      status: 400,
      body: {
        error: '"Draft" is already urgent priority',
        code: 'priority_at_top',
        params: { taskId: 'a', task: 'Draft', priority: 'urgent' },
        text: '"Draft" is already urgent priority',
      },
    })
    expect(await listTasks()).toEqual([{ ...stored, priority: 'urgent' }])
  })

  it.each<[string, unknown]>([
    ['an unknown action', { action: 'snooze' }],
    ['no action', {}],
    ['a list', [{ action: 'unpin' }]],
    ['do today without a date', { action: 'do_today' }],
    ['not today with a malformed date', { action: 'not_today', today: '16/11/2026' }],
    ['an unknown direction', { action: 'importance', direction: 'sideways' }],
    ['an estimate of 0', { action: 'estimate', effortMinutes: 0 }],
    ['an estimate in part minutes', { action: 'estimate', effortMinutes: 1.5 }],
    ['an estimate left out', { action: 'estimate' }],
  ])('refuses %s', async (_, body) => {
    const response = await act('a', body)
    expect(response.status).toBe(400)
    expect(response.body.error).toEqual(expect.any(String))
    expect(await listTasks()).toEqual([stored])
  })

  it("answers 404 for a task that doesn't exist, including another account's", async () => {
    expect((await act('missing', { action: 'unpin' })).status).toBe(404)
    const other = await helpers.signUp('other@example.com')
    expect((await helpers.call('POST', 'tasks/a/action', { action: 'unpin' }, other)).status).toBe(404)
  })

  it('only answers POST, and needs a signed-in user', async () => {
    expect((await call('GET', 'tasks/a/action')).status).toBe(405)
    expect((await call('POST', 'tasks/a/other', { action: 'unpin' })).status).toBe(404)
    expect((await helpers.call('POST', 'tasks/a/action', { action: 'unpin' })).status).toBe(401)
  })
})

describe('prioritisation in the Worker', () => {
  it('scores the stored tasks with the stored settings, inside the Workers runtime', async () => {
    await saveTask(task('b', { name: 'Review', dueDate: '2026-11-20', effortMinutes: 960 }))
    await saveTask(task('a', { name: 'Draft', relations: [{ taskId: 'b', type: 'blocks' }] }))
    await call('POST', 'settings/preset', { preset: 'deadline' }) // k 0.5

    const tasks = await listTasks()
    const projects = (await call('GET', 'projects')).body
    const settings = (await call('GET', 'settings')).body
    const result = prioritise(tasks, projects, settings, '2026-11-16')

    expect(result.sections).toEqual({ overdue: [], do_now: [], do_next: ['a'] })
    expect(result.hidden).toEqual({ blocked: 1, notStarted: 0 })
    expect(result.tasks.find((t) => t.taskId === 'a')).toMatchObject({ effectiveDeadline: '2026-11-18', factors: { boost: 1.4444 } }) // 1 + 0.5 x 16 / 18

    // The forecast runs there too: Draft's 2 hours, then Review's 16 from Monday's last 6 hours
    const plan = forecast(tasks, projects, settings, '2026-11-16', result)
    expect(plan.tasks.map((t) => [t.taskId, t.finish])).toEqual([
      ['a', '2026-11-16'],
      ['b', '2026-11-18'],
    ])
  })
})

describe('settings', () => {
  const mine: UserSettings = {
    capacityMinutes: { mon: 240, tue: 240, wed: 0, thu: 480, fri: 300, sat: 60, sun: 0 },
    buffer: 1.25,
    wU: 2,
    k: 0.5,
    horizonDays: 3,
    preset: 'deadline',
  }

  it('answers with the defaults until the user saves their own, without writing a row', async () => {
    expect(await call('GET', 'settings')).toEqual({ status: 200, body: DEFAULT_SETTINGS })
    expect(await count('user_settings')).toBe(0)
  })

  it('saves the settings and returns them, and saves over them the next time', async () => {
    expect(await call('PUT', 'settings', mine)).toEqual({ status: 200, body: mine })
    expect((await call('GET', 'settings')).body).toEqual(mine)

    const balanced = { ...mine, wU: 1, k: 1, horizonDays: 2, preset: 'balanced' }
    expect((await call('PUT', 'settings', balanced)).body).toEqual(balanced)
    expect((await call('GET', 'settings')).body).toEqual(balanced)
    expect(await count('user_settings')).toBe(1)
  })

  it('keeps each account to its own settings, and deletes them with the account', async () => {
    await call('PUT', 'settings', mine)
    const other = await helpers.signUp('other@example.com')
    expect((await helpers.call('GET', 'settings', undefined, other)).body).toEqual(DEFAULT_SETTINGS)
    expect((await call('GET', 'settings')).body).toEqual(mine)

    await env.DB.prepare('DELETE FROM users').run()
    expect(await count('user_settings')).toBe(0)
  })

  it.each<[string, Record<string, unknown>]>([
    ['no capacity', { capacityMinutes: undefined }],
    ['a weekday missing', { capacityMinutes: { mon: 480, tue: 480, wed: 480, thu: 480, fri: 480, sat: 0 } }],
    ['an extra day', { capacityMinutes: { ...DEFAULT_SETTINGS.capacityMinutes, holiday: 0 } }],
    ['more than a day of capacity', { capacityMinutes: { ...DEFAULT_SETTINGS.capacityMinutes, mon: 1441 } }],
    ['negative capacity', { capacityMinutes: { ...DEFAULT_SETTINGS.capacityMinutes, mon: -1 } }],
    ['capacity in part minutes', { capacityMinutes: { ...DEFAULT_SETTINGS.capacityMinutes, mon: 60.5 } }],
    ['no time on any day', { capacityMinutes: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 } }],
    ['a buffer under 0.5', { buffer: 0.4 }],
    ['a buffer over 5', { buffer: 5.5 }],
    ['a buffer as text', { buffer: '1' }],
    ['a negative wU', { wU: -1 }],
    ['a k over 10', { k: 11 }],
    ['a horizon of 0 days', { horizonDays: 0 }],
    ['a horizon in part days', { horizonDays: 1.5 }],
    ['an unknown preset', { preset: 'custom' }],
  ])('refuses settings with %s', async (_, fields) => {
    const response = await call('PUT', 'settings', { ...mine, ...fields })
    expect(response.status).toBe(400)
    expect(response.body.error).toEqual(expect.any(String))
    expect(await count('user_settings')).toBe(0)
  })

  it('refuses a body that is not an object', async () => {
    expect((await call('PUT', 'settings', [mine])).status).toBe(400)
  })

  it('needs a signed-in user, and only answers GET and PUT at /api/settings', async () => {
    expect((await helpers.call('GET', 'settings')).status).toBe(401)
    expect((await helpers.call('PUT', 'settings', mine)).status).toBe(401)
    expect((await call('DELETE', 'settings')).status).toBe(405)
    expect((await call('GET', 'settings/mine')).status).toBe(404)
  })
})

describe('schema constraints', () => {
  // Straight to D1, as in api.spec.ts, to check the database protects itself without the Worker
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, email) VALUES ('u1', 'u1@example.com')"),
      env.DB.prepare("INSERT INTO tasks (user_id, id, name, due_date, start_date) VALUES ('u1', 't', 'T', '2026-11-20', '2026-11-18')"),
    ])
  })

  it.each([
    ['an estimate of 0', "INSERT INTO tasks (user_id, id, name, effort_minutes) VALUES ('u1', 'a', 'A', 0)"],
    ['a start date after the due date', "INSERT INTO tasks (user_id, id, name, due_date, start_date) VALUES ('u1', 'a', 'A', '2026-11-20', '2026-11-21')"],
    ['a due date moved before the start date', "UPDATE tasks SET due_date = '2026-11-17' WHERE id = 't'"],
    ['settings for a missing user', "INSERT INTO user_settings (user_id) VALUES ('missing')"],
    ['more than a day of capacity', "INSERT INTO user_settings (user_id, capacity_mon) VALUES ('u1', 1441)"],
    ['a buffer of 0', "INSERT INTO user_settings (user_id, buffer) VALUES ('u1', 0)"],
    ['a horizon of 0 days', "INSERT INTO user_settings (user_id, horizon_days) VALUES ('u1', 0)"],
    ['an unknown preset', "INSERT INTO user_settings (user_id, preset) VALUES ('u1', 'custom')"],
  ])('refuses %s', async (_, sql) => {
    await expect(env.DB.prepare(sql).run()).rejects.toThrow()
  })

  it('fills in the default settings', async () => {
    await env.DB.prepare("INSERT INTO user_settings (user_id) VALUES ('u1')").run()
    const row = await env.DB.prepare("SELECT * FROM user_settings WHERE user_id = 'u1'").first()
    expect(row).toMatchObject({
      capacity_mon: 480,
      capacity_fri: 480,
      capacity_sat: 0,
      capacity_sun: 0,
      buffer: 1,
      w_u: 1,
      k: 1,
      horizon_days: 2,
      preset: 'balanced',
    })
  })
})
