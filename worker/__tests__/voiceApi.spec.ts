// Integration tests for the API a voice front-end uses (docs/priority-algorithm.md, Stage 5): the
// rankings and forecast exactly as the shared functions give them, partial task updates, preset
// changes, and the settings preview. Each test is signed in to a new account, as in api.spec.ts.
import { env } from 'cloudflare:test'
import { beforeEach, describe, it, expect } from 'vitest'
import type { LoggedEvent } from '../../src/types/events'
import { forecast } from '../../src/types/forecast'
import { prioritise } from '../../src/types/priority'
import type { Project } from '../../src/types/project'
import { applyPreset, DEFAULT_SETTINGS, type UserSettings } from '../../src/types/settings'
import { previewSettings } from '../../src/types/settingsPreview'
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
const listProjects = async (): Promise<Project[]> => (await call('GET', 'projects')).body
const getSettings = async (): Promise<UserSettings> => (await call('GET', 'settings')).body
const saveTask = (task: Task) => call('PUT', `tasks/${task.id}`, { task })
const saveProject = (project: Project) => call('PUT', `projects/${project.id}`, { project })
const patch = (id: string, body: unknown) => call('PATCH', `tasks/${id}`, body)

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

const TODAY = '2026-11-16' // a Monday

// Some work across a project, with a blocker, a pin and a start date to come
async function seed() {
  await saveTask(task('b', { name: 'Review', dueDate: '2026-11-19', effortMinutes: 600 }))
  await saveTask(task('a', { name: 'Draft', effortMinutes: 240, relations: [{ taskId: 'b', type: 'blocks' }] }))
  await saveTask(task('c', { name: 'Book room', pinnedDate: TODAY }))
  await saveTask(task('d', { name: 'Print', startDate: '2026-11-18', priority: 'high' }))
  await saveProject(project('p', { name: 'Thesis', deliveryDate: '2026-11-20', priority: 'high', taskIds: ['a', 'b'] }))
}

describe('GET /api/priorities and /api/forecast', () => {
  beforeEach(seed)

  it('returns exactly what prioritise() gives for the stored tasks, projects and settings', async () => {
    await call('POST', 'settings/preset', { preset: 'blockers' })
    const expected = prioritise(await listTasks(), await listProjects(), await getSettings(), TODAY)
    const response = await call('GET', `priorities?today=${TODAY}`)
    expect(response).toEqual({ status: 200, body: expected })
    expect(response.body.sections.do_now).toEqual(['c'])
    expect(response.body.tasks[0].reason).toEqual({ code: expect.any(String), params: expect.any(Object), text: expect.any(String) })
  })

  it('returns exactly what forecast() gives, with the brief as sentences', async () => {
    const expected = forecast(await listTasks(), await listProjects(), await getSettings(), TODAY)
    const response = await call('GET', `forecast?today=${TODAY}`)
    expect(response).toEqual({ status: 200, body: expected })
    expect(response.body.brief.parts.map((p: { code: string }) => p.code)).toContain('assumptions')
    expect(response.body.projects[0].paceReason.text).toMatch(/^"Thesis" is /)
  })

  it('depends on the today it is given, which only the device knows', async () => {
    const monday = (await call('GET', `priorities?today=${TODAY}`)).body
    const friday = (await call('GET', 'priorities?today=2026-11-20')).body
    expect(monday.today).toBe(TODAY)
    expect(monday.sections.overdue).toEqual([])
    // By Friday, Review (due Thursday) is overdue; it's hidden behind Draft, which holds it up
    expect(friday.sections.overdue).toEqual(['a'])
    expect(friday.tasks.find((t: { taskId: string }) => t.taskId === 'b')).toMatchObject({ tier: 0, hidden: 'blocked' })
  })

  it.each(['priorities', 'forecast'])('refuses /api/%s without a well-formed today, and anything but GET', async (name) => {
    for (const query of ['', '?today=', '?today=16/11/2026', '?today=2026-11-16T00:00:00Z']) {
      const response = await call('GET', `${name}${query}`)
      expect(response.status).toBe(400)
      expect(response.body.error).toContain('today must be a YYYY-MM-DD date')
    }
    expect((await call('POST', `${name}?today=${TODAY}`, {})).status).toBe(405)
    expect((await call('GET', `${name}/x?today=${TODAY}`)).status).toBe(404)
    expect((await helpers.call('GET', `${name}?today=${TODAY}`)).status).toBe(401)
  })

  it("only counts the signed-in account's tasks", async () => {
    const other = await helpers.signUp('other@example.com')
    const response = await helpers.call('GET', `priorities?today=${TODAY}`, undefined, other)
    expect(response.body.tasks).toEqual([])
  })
})

describe('PATCH /api/tasks/:id', () => {
  const stored = task('a', {
    name: 'Draft',
    description: 'Chapter 3',
    dueDate: '2026-11-20',
    effortMinutes: 90,
    startDate: '2026-11-18',
    pinnedDate: TODAY,
  })

  beforeEach(async () => {
    await saveTask(task('b', { name: 'Review' }))
    await saveTask(stored)
    await saveProject(project('p', { name: 'Thesis', deliveryDate: '2026-11-25', taskIds: ['a'] }))
  })

  it('changes only the fields it names, keeping the rest, and returns the changes', async () => {
    const changed = { ...stored, priority: 'high' as const, name: 'Final draft' }
    expect(await patch('a', { task: { priority: 'high', name: 'Final draft' } })).toEqual({
      status: 200,
      body: { tasks: [changed], projects: [] },
    })
    expect((await listTasks()).find((t) => t.id === 'a')).toEqual(changed)
  })

  it('clears the due date and the optional fields with null', async () => {
    await patch('a', { task: { dueDate: null, effortMinutes: null, startDate: null, pinnedDate: null } })
    expect((await listTasks()).find((t) => t.id === 'a')).toEqual(task('a', { name: 'Draft', description: 'Chapter 3' }))
  })

  it('applies the rules of a save: archiving, membership, clashes, loops and change tracking', async () => {
    const done = await patch('a', { task: { completed: true } })
    expect(done.body.projects).toEqual([project('p', { name: 'Thesis', deliveryDate: '2026-11-25', taskIds: ['a'], tagIds: ['archive'] })])
    const events: LoggedEvent[] = (await call('GET', 'events')).body
    expect(events.at(-1)).toMatchObject({ kind: 'task_completed', taskId: 'a', projectId: 'p' })

    expect((await patch('b', { task: {}, projectIds: ['p'] })).body.projects[0].taskIds).toEqual(['a', 'b'])

    const late = await patch('a', { task: { dueDate: '2026-11-30' } })
    expect(late.status).toBe(409)
    expect(late.body.clashes).toEqual([{ taskId: 'a', projectId: 'p', dueDate: '2026-11-30', deliveryDate: '2026-11-25' }])

    await patch('a', { task: { relations: [{ taskId: 'b', type: 'blocks' }] } })
    const loop = await patch('b', { task: { relations: [{ taskId: 'a', type: 'blocks' }] } })
    expect(loop).toMatchObject({ status: 400, body: { loop: ['b', 'a'] } })
  })

  it('checks the patched task as a whole, refusing a start date after the due date', async () => {
    const response = await patch('a', { task: { dueDate: '2026-11-17' } })
    expect(response).toEqual({ status: 400, body: { error: 'startDate must be on or before dueDate' } })
    expect((await listTasks()).find((t) => t.id === 'a')).toEqual(stored)
  })

  it.each<[string, unknown]>([
    ['a field it can not change', { task: { googleAccount: 'me@example.com' } }],
    ['an unknown field', { task: { colour: 'red' } }],
    ['another id', { task: { id: 'b' } }],
    ['a blank name', { task: { name: ' ' } }],
    ['a name cleared with null', { task: { name: null } }],
    ['an estimate in part minutes', { task: { effortMinutes: 1.5 } }],
    ['a malformed date', { task: { pinnedDate: 'today' } }],
    ['no task', { completed: true }],
    ['a task that is not an object', { task: [] }],
    ['malformed projectIds', { task: {}, projectIds: 'p' }],
  ])('refuses %s, changing nothing', async (_, body) => {
    const response = await patch('a', body)
    expect(response.status).toBe(400)
    expect(response.body.error).toEqual(expect.any(String))
    expect((await listTasks()).find((t) => t.id === 'a')).toEqual(stored)
  })

  it('keeps the Google account a task was imported from', async () => {
    const { id: userId } = (await env.DB.prepare("SELECT id FROM users WHERE email = 'me@example.com'").first<{ id: string }>())!
    await env.DB.prepare(
      `INSERT INTO google_events (user_id, task_id, account_email, calendar_id, event_id, starts_at, ends_at)
       VALUES (?1, 'a', 'me@gmail.example', 'primary', 'e1', '2026-11-20T00:00:00Z', '2026-11-21T00:00:00Z')`,
    )
      .bind(userId)
      .run()
    const response = await patch('a', { task: { priority: 'urgent' } })
    expect(response.body.tasks[0]).toMatchObject({ priority: 'urgent', googleAccount: 'me@gmail.example' })
  })

  it("answers 404 for a task that doesn't exist, including another account's", async () => {
    expect((await patch('missing', { task: { completed: true } })).status).toBe(404)
    const other = await helpers.signUp('other@example.com')
    expect((await helpers.call('PATCH', 'tasks/a', { task: { completed: true } }, other)).status).toBe(404)
    expect((await helpers.call('PATCH', 'tasks/a', { task: { completed: true } })).status).toBe(401)
  })
})

describe('preset changes', () => {
  it("switches to a preset's weights, keeping the capacity and buffer", async () => {
    const mine = { ...DEFAULT_SETTINGS, buffer: 1.5, capacityMinutes: { ...DEFAULT_SETTINGS.capacityMinutes, sat: 120 } }
    await call('PUT', 'settings', mine)
    const expected = applyPreset(mine, 'importance')
    expect(await call('POST', 'settings/preset', { preset: 'importance' })).toEqual({ status: 200, body: expected })
    expect(await getSettings()).toEqual(expected)
  })

  it.each<[string, unknown]>([
    ['an unknown preset', { preset: 'custom' }],
    ['no preset', {}],
    ['weights besides the preset', { preset: 'balanced', k: 3 }],
  ])('refuses %s', async (_, body) => {
    expect((await call('POST', 'settings/preset', body)).status).toBe(400)
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it("refuses a PUT whose weights aren't the named preset's", async () => {
    const response = await call('PUT', 'settings', { ...DEFAULT_SETTINGS, k: 0 })
    expect(response.status).toBe(400)
    expect(response.body.error).toContain("wU, k and horizonDays must be the preset's")
    expect((await call('PUT', 'settings', applyPreset(DEFAULT_SETTINGS, 'blockers'))).status).toBe(200)
  })

  it('only answers POST, and nothing else under /api/settings', async () => {
    expect((await call('GET', 'settings/preset')).status).toBe(405)
    expect((await call('POST', 'settings/other', {})).status).toBe(404)
    expect((await call('GET', 'settings/preset/x')).status).toBe(404)
  })
})

describe('POST /api/settings/preview', () => {
  beforeEach(seed)

  it('returns what previewSettings() gives for the changes, without saving them', async () => {
    const current = await getSettings()
    const candidate = applyPreset({ ...current, buffer: 1.5 }, 'deadline')
    const expected = previewSettings(await listTasks(), await listProjects(), current, candidate, TODAY)

    const response = await call('POST', 'settings/preview', { today: TODAY, preset: 'deadline', buffer: 1.5 })
    expect(response).toEqual({ status: 200, body: expected })
    expect(response.body.summary.parts[0]).toEqual({
      code: 'preset',
      params: { from: 'balanced', to: 'deadline' },
      text: 'Switching from Balanced to Deadline-driven.',
    })
    expect(await getSettings()).toEqual(current)
  })

  it('previews capacity on its own, keeping the preset', async () => {
    const capacityMinutes = { ...DEFAULT_SETTINGS.capacityMinutes, mon: 0 }
    const response = await call('POST', 'settings/preview', { today: TODAY, capacityMinutes })
    expect(response.body.candidate).toEqual({ ...DEFAULT_SETTINGS, capacityMinutes })
  })

  it.each<[string, unknown]>([
    ['no today', { preset: 'deadline' }],
    ['an unknown preset', { today: TODAY, preset: 'custom' }],
    ['a buffer out of range', { today: TODAY, buffer: 9 }],
    ['capacity with no time', { today: TODAY, capacityMinutes: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 } }],
    ['weights besides the preset', { today: TODAY, wU: 3 }],
  ])('refuses %s', async (_, body) => {
    const response = await call('POST', 'settings/preview', body)
    expect(response.status).toBe(400)
    expect(response.body.error).toEqual(expect.any(String))
  })
})

describe('refused quick actions', () => {
  it('come with a code and their values as well as the sentence', async () => {
    await saveTask(task('a', { name: 'Draft', dueDate: '2026-11-13' }))
    expect(await call('POST', 'tasks/a/action', { action: 'not_today', today: TODAY })).toEqual({
      status: 400,
      body: {
        error: `"Draft": It's overdue, so it can't wait until tomorrow`,
        code: 'overdue',
        params: { taskId: 'a', task: 'Draft', dueDate: '2026-11-13' },
        text: `"Draft": It's overdue, so it can't wait until tomorrow`,
      },
    })
  })
})
