// Integration tests for errands (src/types/errand.ts, migrations/0014_errands.sql): tasks with kind
// 'errand', which are in no project and have no relations, are planned for today when saved without
// a planned day, and make their next one in the same batch when a recurring one is completed. Each
// test is signed in to a new account, as in api.spec.ts.
import { env } from 'cloudflare:test'
import { beforeEach, describe, it, expect } from 'vitest'
import type { TaskPatch } from '../../src/types/operations'
import type { Project } from '../../src/types/project'
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
const saveTask = (task: Task, extra: Record<string, unknown> = {}) => call('PUT', `tasks/${task.id}`, { task, ...extra })
const patchTask = (id: string, task: TaskPatch) => call('PATCH', `tasks/${id}`, { task })

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
const errand = (id: string, fields: Partial<Task> = {}): Task => task(id, { kind: 'errand', pinnedDate: '2026-11-16', ...fields })

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

const count = async (table: string) => (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())!.n

describe('saving errands', () => {
  it('saves and reads back kind, recurrence and the checklist, and leaves a project task as it was', async () => {
    const shopping = errand('e', {
      recurrence: 'weekly:MON,SAT',
      checklist: [
        { text: 'Milk', done: false },
        { text: 'Eggs', done: true },
      ],
    })
    expect(await saveTask(shopping)).toEqual({ status: 200, body: { tasks: [shopping], projects: [] } })
    expect(await saveTask(task('t'))).toEqual({ status: 200, body: { tasks: [task('t')], projects: [] } })
    expect(await listTasks()).toEqual([shopping, task('t')])
    expect(await env.DB.prepare("SELECT kind FROM tasks WHERE id = 't'").first('kind')).toBe('task')
  })

  it("plans an errand saved with no planned day for the user's today, at the default priority", async () => {
    const { status, body } = await saveTask(task('e', { kind: 'errand', priority: 'urgent' }), { today: '2026-11-20' })
    expect(status).toBe(200)
    expect(body.tasks).toEqual([task('e', { kind: 'errand', pinnedDate: '2026-11-20' })])
  })

  it('refuses an errand with no planned day and no today to plan it for', async () => {
    const { status, body } = await saveTask(task('e', { kind: 'errand' }))
    expect(status).toBe(409)
    expect(body).toMatchObject({ code: 'errand_unplanned', params: { taskId: 'e', task: 'Task e' } })
    expect(await listTasks()).toEqual([])
  })

  it('refuses an errand planned after it is due', async () => {
    const { status, body } = await saveTask(errand('e', { pinnedDate: '2026-11-21', dueDate: '2026-11-20' }))
    expect(status).toBe(409)
    expect(body).toEqual({
      error: '"Task e" is planned for 2026-11-21, after it\'s due (2026-11-20)',
      code: 'errand_planned_after_due',
      params: { taskId: 'e', task: 'Task e', pinnedDate: '2026-11-21', dueDate: '2026-11-20' },
      text: '"Task e" is planned for 2026-11-21, after it\'s due (2026-11-20)',
    })
  })

  it('refuses to put an errand in a project, from the task or from the project', async () => {
    await call('PUT', 'projects/p', { project: project('p', { name: 'Thesis' }) })
    const fromTask = await saveTask(errand('e'), { projectIds: ['p'] })
    expect(fromTask.status).toBe(409)
    expect(fromTask.body).toMatchObject({ code: 'errand_in_project', params: { taskId: 'e', projectId: 'p', project: 'Thesis' } })
    expect(await listTasks()).toEqual([])

    await saveTask(errand('e'))
    const fromProject = await call('PUT', 'projects/p', { project: project('p', { name: 'Thesis', taskIds: ['e'] }) })
    expect(fromProject.status).toBe(409)
    expect(fromProject.body).toMatchObject({ code: 'errand_in_project' })
    expect(await count('project_tasks')).toBe(0)

    // Nor can a project task in a project become an errand
    await saveTask(task('t'), { projectIds: ['p'] })
    expect((await patchTask('t', { kind: 'errand', pinnedDate: '2026-11-16' })).status).toBe(409)
  })

  it('refuses relations to and from an errand', async () => {
    await saveTask(task('t'))
    await saveTask(errand('e'))
    const from = await saveTask(errand('e', { relations: [{ taskId: 't', type: 'blocks' }] }))
    expect(from.status).toBe(409)
    expect(from.body).toMatchObject({ code: 'errand_related', params: { taskId: 'e', relatedTaskId: 't' } })
    const to = await saveTask(task('t', { relations: [{ taskId: 'e', type: 'related_to' }] }))
    expect(to.status).toBe(409)
    expect(to.body).toMatchObject({ code: 'errand_related', params: { taskId: 'e', relatedTaskId: 't' } })
    expect(await count('task_relations')).toBe(0)
  })

  it.each([
    [{ kind: 'chore' }, 'kind must be'],
    [{ kind: 'errand', recurrence: 'weekly:MON,MON' }, 'recurrence must be'],
    [{ kind: 'errand', recurrence: 'every:0d' }, 'recurrence must be'],
    [{ recurrence: 'daily' }, 'recurrence is only for errands'],
    [{ checklist: [{ text: 'Milk', done: false }] }, 'checklist is only for errands'],
    [{ kind: 'errand', checklist: [{ text: ' ', done: false }] }, 'checklist must be'],
    [{ kind: 'errand', checklist: [{ text: 'Milk' }] }, 'checklist must be'],
  ])('refuses %j with 400', async (fields, message) => {
    const { status, body } = await saveTask(task('e', { pinnedDate: '2026-11-16', ...(fields as Partial<Task>) }))
    expect(status).toBe(400)
    expect(body.error).toContain(message)
  })

  it('saves ticking one checklist item, and shortening the list, as changes to its rows', async () => {
    const items = [
      { text: 'Milk', done: false },
      { text: 'Eggs', done: false },
      { text: 'Bread', done: false },
    ]
    await saveTask(errand('e', { checklist: items }))
    await patchTask('e', { checklist: [items[0]!, { text: 'Eggs', done: true }, items[2]!] })
    expect((await listTasks())[0]!.checklist).toEqual([items[0], { text: 'Eggs', done: true }, items[2]])
    await patchTask('e', { checklist: [items[0]!] })
    expect((await listTasks())[0]!.checklist).toEqual([items[0]])
    await patchTask('e', { checklist: null })
    expect(await listTasks()).toEqual([errand('e')])
    expect(await count('task_checklist_items')).toBe(0)
  })

  it('turns an errand back into a project task, dropping its recurrence and checklist', async () => {
    await saveTask(errand('e', { recurrence: 'daily' }))
    expect((await patchTask('e', { kind: 'task', recurrence: null })).status).toBe(200)
    expect(await listTasks()).toEqual([task('e', { pinnedDate: '2026-11-16' })])
  })
})

describe('recurring errands', () => {
  const groceries = (recurrence: string, fields: Partial<Task> = {}) =>
    errand('e', {
      name: 'Groceries',
      recurrence,
      effortMinutes: 45,
      checklist: [
        { text: 'Milk', done: true },
        { text: 'Eggs', done: false },
      ],
      ...fields,
    })

  // Completes it, and returns the errand made for the next time
  async function complete(recurring: Task) {
    await saveTask(recurring)
    const { status, body } = await patchTask(recurring.id, { completed: true })
    expect(status).toBe(200)
    expect(body.tasks).toHaveLength(2)
    const [done, next] = body.tasks as Task[]
    expect(done).toEqual({ ...recurring, completed: true })
    return next!
  }

  it.each([
    // [recurrence, planned day, due date, next planned day, next due date]
    ['daily', '2026-11-30', null, '2026-12-01', null],
    ['every:3d', '2026-11-30', '2026-12-01', '2026-12-03', '2026-12-04'],
    ['every:10d', '2026-12-25', '2026-12-31', '2027-01-04', '2027-01-10'],
    // 2026-11-30 is a Monday
    ['weekly:MON,SAT', '2026-11-30', '2026-11-30', '2026-12-05', '2026-12-05'],
    ['weekly:MON', '2026-12-28', null, '2027-01-04', null],
  ])('%s from %s makes the next one on %s, with its due date moved by the same gap', async (recurrence, planned, due, nextPlanned, nextDue) => {
    const next = await complete(groceries(recurrence, { pinnedDate: planned, dueDate: due }))
    expect(next).toEqual({
      id: next.id,
      name: 'Groceries',
      description: '',
      dueDate: nextDue,
      relations: [],
      priority: 'medium',
      completed: false,
      kind: 'errand',
      recurrence,
      pinnedDate: nextPlanned,
      effortMinutes: 45,
      checklist: [
        { text: 'Milk', done: false },
        { text: 'Eggs', done: false },
      ],
    })
    expect(next.id).not.toBe('e')
    expect(await listTasks()).toEqual([{ ...groceries(recurrence, { pinnedDate: planned, dueDate: due }), completed: true }, next])
  })

  it('makes no second one when the completed one is reopened and completed again, and keeps the first', async () => {
    const next = await complete(groceries('daily'))
    expect((await patchTask('e', { completed: false })).body.tasks).toHaveLength(1)
    expect((await patchTask('e', { completed: true })).body.tasks).toHaveLength(1)
    expect((await listTasks()).map((t) => t.id)).toEqual(['e', next.id])
    // Dropping the next one doesn't make the completed one repeat again
    await call('DELETE', `tasks/${encodeURIComponent(next.id)}`)
    await patchTask('e', { completed: false })
    expect((await patchTask('e', { completed: true })).body.tasks).toHaveLength(1)
  })

  it('never returns which errand came next, though it stores it', async () => {
    const next = await complete(groceries('daily'))
    expect(await env.DB.prepare("SELECT next_occurrence_id FROM tasks WHERE id = 'e'").first('next_occurrence_id')).toBe(next.id)
    expect(JSON.stringify(await listTasks())).not.toContain('nextOccurrenceId')
  })

  it('logs the next one to history, with its kind', async () => {
    const next = await complete(groceries('daily'))
    const row = await env.DB.prepare("SELECT data FROM history WHERE row_key = ?1 AND op = 'insert'").bind(next.id).first<string>('data')
    expect(JSON.parse(row!)).toMatchObject({ kind: 'errand', recurrence: 'daily', pinned_date: '2026-11-17' })
  })

  it("doesn't repeat an errand completed with no recurrence", async () => {
    await saveTask(errand('e'))
    expect((await patchTask('e', { completed: true })).body.tasks).toHaveLength(1)
  })
})

describe('errands in the planning routes', () => {
  it('leaves errands out of the priorities, and takes their hours out of their day in the forecast', async () => {
    await saveTask(task('t', { effortMinutes: 600 }))
    await saveTask(errand('e', { pinnedDate: '2026-11-13', effortMinutes: 90 }))
    const priorities = (await call('GET', 'priorities?today=2026-11-16')).body
    expect(priorities.tasks.map((t: { taskId: string }) => t.taskId)).toEqual(['t'])
    const forecast = (await call('GET', 'forecast?today=2026-11-16')).body
    expect(forecast.days[0]).toMatchObject({ plannedHours: 6.5, errandHours: 1.5 })
    expect(forecast.todayErrands).toEqual([{ taskId: 'e', name: 'Task e', hours: 1.5, carriedDays: 3 }])
  })
})
