import { describe, it, expect } from 'vitest'
import { diffEvents, isPlanned, PLANNING_WINDOW_HOURS, type LoggedEvent, type TaskEvent } from '../types/events'
import { planProjectDelete, planProjectSave, planTaskDelete, planTaskSave, type Plan } from '../types/operations'
import { createEmptyProject, type Project } from '../types/project'
import { createEmptyTask, type Task } from '../types/task'

const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id, name: id, ...fields })
const project = (id: string, fields: Partial<Project> = {}): Project => ({
  ...createEmptyProject(),
  id,
  name: id,
  ...fields,
})

// The events of a plan that went through
function eventsOf(plan: Plan) {
  if (!plan.ok) throw new Error(`Expected the save to go through, got clashes ${JSON.stringify(plan.clashes)}`)
  return plan.events
}

// [kind, taskId, projectId, oldValue, newValue, deliveryDateAtTime], the parts that differ between tests
const short = (events: TaskEvent[]) =>
  events.map((e) => [e.kind, e.taskId, e.projectId, e.oldValue, e.newValue, e.deliveryDateAtTime])

describe('diffEvents', () => {
  describe('creating', () => {
    it('logs a new task in no project once, with its first due date', () => {
      const events = eventsOf(planTaskSave({ tasks: [], projects: [] }, { task: task('t', { dueDate: '2026-11-05' }) }))

      expect(events).toEqual([
        {
          kind: 'task_created',
          taskId: 't',
          projectId: null,
          oldValue: null,
          newValue: '2026-11-05',
          deliveryDateAtTime: null,
          source: 'app',
          taskSource: 'app',
        },
      ])
    })

    it('logs a new task saved with its projects as created, then added to each', () => {
      const state = { tasks: [], projects: [project('p', { deliveryDate: '2026-12-01' }), project('q')] }

      const events = eventsOf(planTaskSave(state, { task: task('t'), projectIds: ['p', 'q'] }))

      expect(short(events)).toEqual([
        ['task_created', 't', null, null, null, null],
        ['task_added_to_project', 't', 'p', null, null, '2026-12-01'],
        ['task_added_to_project', 't', 'q', null, null, null],
      ])
    })

    it('logs a new project with its delivery date, then each task it starts with', () => {
      const state = { tasks: [task('a'), task('b')], projects: [] }

      const events = eventsOf(planProjectSave(state, { project: project('p', { deliveryDate: '2026-12-01', taskIds: ['b', 'a'] }) }))

      expect(short(events)).toEqual([
        ['project_created', null, 'p', null, '2026-12-01', '2026-12-01'],
        ['task_added_to_project', 'b', 'p', null, null, '2026-12-01'],
        ['task_added_to_project', 'a', 'p', null, null, '2026-12-01'],
      ])
      expect(events[0]!.taskSource).toBeNull()
    })

    it('logs a task created already done as completed too', () => {
      const events = eventsOf(planTaskSave({ tasks: [], projects: [] }, { task: task('t', { completed: true }) }))
      expect(events.map((e) => e.kind)).toEqual(['task_created', 'task_completed'])
    })
  })

  describe('membership', () => {
    it('logs a task moved between projects as removed from one and added to the other', () => {
      const state = { tasks: [task('t')], projects: [project('p', { taskIds: ['t'] }), project('q', { deliveryDate: '2026-12-01' })] }

      const events = eventsOf(planTaskSave(state, { task: state.tasks[0]!, projectIds: ['q'] }))

      expect(short(events)).toEqual([
        ['task_removed_from_project', 't', 'p', null, null, null],
        ['task_added_to_project', 't', 'q', null, null, '2026-12-01'],
      ])
    })

    it("logs changes to a project's tasks from the project side", () => {
      const state = { tasks: [task('a'), task('b'), task('c')], projects: [project('p', { taskIds: ['a', 'b'] })] }

      const events = eventsOf(planProjectSave(state, { project: project('p', { taskIds: ['b', 'c'] }) }))

      expect(short(events)).toEqual([
        ['task_removed_from_project', 'a', 'p', null, null, null],
        ['task_added_to_project', 'c', 'p', null, null, null],
      ])
    })

    it('logs nothing when only the order of a project’s tasks changes', () => {
      const state = { tasks: [task('a'), task('b')], projects: [project('p', { taskIds: ['a', 'b'] })] }
      expect(eventsOf(planProjectSave(state, { project: project('p', { taskIds: ['b', 'a'] }) }))).toEqual([])
    })
  })

  describe('dates', () => {
    it("logs a task save's due date change once for each of its projects, with their delivery dates", () => {
      const state = {
        tasks: [task('t', { dueDate: '2026-11-01' })],
        projects: [project('p', { taskIds: ['t'], deliveryDate: '2026-12-01' }), project('q', { taskIds: ['t'] }), project('r')],
      }

      const events = eventsOf(planTaskSave(state, { task: task('t', { dueDate: '2026-11-08' }) }))

      expect(short(events)).toEqual([
        ['due_date_changed', 't', 'p', '2026-11-01', '2026-11-08', '2026-12-01'],
        ['due_date_changed', 't', 'q', '2026-11-01', '2026-11-08', null],
      ])
    })

    it('logs a due date change on a task in no project once, with no project', () => {
      const state = { tasks: [task('t')], projects: [] }
      const events = eventsOf(planTaskSave(state, { task: task('t', { dueDate: '2026-11-08' }) }))
      expect(short(events)).toEqual([['due_date_changed', 't', null, null, '2026-11-08', null]])
    })

    it("logs due dates moved by a project save's dueDates", () => {
      const state = {
        tasks: [task('a', { dueDate: '2026-12-20' }), task('b', { dueDate: '2026-11-01' })],
        projects: [project('p', { taskIds: ['b'], deliveryDate: '2026-12-01' })],
      }

      // Adding a to p would clash, so the save moves its due date too
      const events = eventsOf(
        planProjectSave(state, { project: { ...state.projects[0]!, taskIds: ['b', 'a'] }, dueDates: { a: '2026-11-30' } }),
      )

      expect(short(events)).toEqual([
        ['task_added_to_project', 'a', 'p', null, null, '2026-12-01'],
        ['due_date_changed', 'a', 'p', '2026-12-20', '2026-11-30', '2026-12-01'],
      ])
    })

    it("logs delivery dates moved by a task save's deliveryDates", () => {
      const state = { tasks: [task('t', { dueDate: '2026-12-20' })], projects: [project('p', { deliveryDate: '2026-12-01' })] }

      const events = eventsOf(
        planTaskSave(state, { task: state.tasks[0]!, projectIds: ['p'], deliveryDates: { p: '2026-12-31' } }),
      )

      expect(short(events)).toEqual([
        ['delivery_date_changed', null, 'p', '2026-12-01', '2026-12-31', '2026-12-31'],
        ['task_added_to_project', 't', 'p', null, null, '2026-12-31'],
      ])
    })
  })

  describe('completion', () => {
    it('logs completing and reopening a task, once for each of its projects', () => {
      const state = { tasks: [task('t'), task('u')], projects: [project('p', { taskIds: ['t', 'u'] }), project('q', { taskIds: ['t'] })] }

      const done = eventsOf(planTaskSave(state, { task: task('t', { completed: true }) }))
      expect(short(done)).toEqual([
        ['task_completed', 't', 'p', null, null, null],
        ['task_completed', 't', 'q', null, null, null],
      ])

      const reopened = eventsOf(
        planTaskSave({ ...state, tasks: [task('t', { completed: true }), task('u')] }, { task: task('t') }),
      )
      expect(reopened.map((e) => [e.kind, e.projectId])).toEqual([
        ['task_reopened', 'p'],
        ['task_reopened', 'q'],
      ])
    })

    it("doesn't log the Archive tag a completed project gets", () => {
      const state = { tasks: [task('t')], projects: [project('p', { taskIds: ['t'] })] }

      const plan = planTaskSave(state, { task: task('t', { completed: true }) })

      expect(plan.ok && plan.changes.projects[0]!.tagIds).toEqual(['archive'])
      expect(eventsOf(plan).map((e) => e.kind)).toEqual(['task_completed'])
    })
  })

  describe('only real changes', () => {
    it('logs nothing for a save that changes nothing, or only untracked fields', () => {
      const state = {
        tasks: [task('t', { dueDate: '2026-11-01' })],
        projects: [project('p', { taskIds: ['t'], deliveryDate: '2026-12-01' })],
      }

      expect(eventsOf(planTaskSave(state, { task: state.tasks[0]!, projectIds: ['p'], deliveryDates: { p: '2026-12-01' } }))).toEqual([])
      expect(eventsOf(planProjectSave(state, { project: state.projects[0]!, dueDates: { t: '2026-11-01' } }))).toEqual([])
      expect(eventsOf(planTaskSave(state, { task: { ...state.tasks[0]!, name: 'Renamed', priority: 'urgent' } }))).toEqual([])
      expect(eventsOf(planProjectSave(state, { project: { ...state.projects[0]!, tagIds: ['work'] } }))).toEqual([])
    })

    it('logs nothing for a save refused for a clash', () => {
      const state = { tasks: [task('t', { dueDate: '2026-12-20' })], projects: [project('p', { deliveryDate: '2026-12-01' })] }

      const plan = planTaskSave(state, { task: state.tasks[0]!, projectIds: ['p'] })

      expect(plan).toEqual({ ok: false, clashes: [expect.objectContaining({ taskId: 't', projectId: 'p' })] })
      expect(plan).not.toHaveProperty('events')
    })
  })

  it('marks events on an imported task as made in the app on a Google task', () => {
    const state = { tasks: [task('t', { googleAccount: 'me@gmail.com' })], projects: [project('p')] }

    const events = eventsOf(planTaskSave(state, { task: state.tasks[0]!, projectIds: ['p'] }))

    expect(events).toMatchObject([{ kind: 'task_added_to_project', source: 'app', taskSource: 'google' }])
  })

  it('takes the source it is given', () => {
    const events = diffEvents({ tasks: [], projects: [] }, { tasks: [task('t')], projects: [] }, 'google')
    expect(events).toMatchObject([{ kind: 'task_created', source: 'google' }])
  })
})

describe('deleting', () => {
  it('logs a deleted task once for each project it was in, then its removal from each', () => {
    const state = {
      tasks: [task('t'), task('u')],
      projects: [project('p', { taskIds: ['t', 'u'], deliveryDate: '2026-12-01' }), project('q', { taskIds: ['t'] })],
    }

    expect(short(planTaskDelete(state, 't'))).toEqual([
      ['task_deleted', 't', 'p', null, null, '2026-12-01'],
      ['task_deleted', 't', 'q', null, null, null],
      ['task_removed_from_project', 't', 'p', null, null, '2026-12-01'],
      ['task_removed_from_project', 't', 'q', null, null, null],
    ])
  })

  it('logs a deleted task in no project once, with no project', () => {
    expect(short(planTaskDelete({ tasks: [task('t')], projects: [] }, 't'))).toEqual([['task_deleted', 't', null, null, null, null]])
  })

  it("logs a deleted project, then each of its tasks' removal, keeping the tasks", () => {
    const state = { tasks: [task('a'), task('b')], projects: [project('p', { taskIds: ['a', 'b'], deliveryDate: '2026-12-01' })] }

    expect(short(planProjectDelete(state, 'p'))).toEqual([
      ['project_deleted', null, 'p', null, null, '2026-12-01'],
      ['task_removed_from_project', 'a', 'p', null, null, '2026-12-01'],
      ['task_removed_from_project', 'b', 'p', null, null, '2026-12-01'],
    ])
  })

  it('logs nothing for an id that does not exist', () => {
    const state = { tasks: [task('t')], projects: [project('p', { taskIds: ['t'] })] }
    expect(planTaskDelete(state, 'missing')).toEqual([])
    expect(planProjectDelete(state, 'missing')).toEqual([])
  })
})

describe('isPlanned', () => {
  const HOUR = 60 * 60 * 1000
  const CREATED = Date.parse('2026-11-01T09:00:00.000Z')
  let nextId = 1
  // An event `hours` after the project was created
  const at = (hours: number, kind: TaskEvent['kind'], fields: Partial<LoggedEvent> = {}): LoggedEvent => ({
    id: nextId++,
    at: new Date(CREATED + Math.round(hours * HOUR)).toISOString(),
    kind,
    taskId: null,
    projectId: 'p',
    oldValue: null,
    newValue: null,
    deliveryDateAtTime: null,
    source: 'app',
    taskSource: null,
    ...fields,
  })
  const created = at(0, 'project_created')
  const added = (hours: number, taskId = 't', projectId = 'p') => at(hours, 'task_added_to_project', { taskId, projectId })

  it('counts a task added when the project was created as planned', () => {
    expect(isPlanned([created, added(0)], 'p', 't')).toBe(true)
  })

  it('counts a task added just inside the window as planned, and just outside as added later', () => {
    const ms = 1 / HOUR
    expect(isPlanned([created, added(PLANNING_WINDOW_HOURS - ms)], 'p', 't')).toBe(true)
    expect(isPlanned([created, added(PLANNING_WINDOW_HOURS)], 'p', 't')).toBe(true)
    expect(isPlanned([created, added(PLANNING_WINDOW_HOURS + ms)], 'p', 't')).toBe(false)
  })

  it('goes by when the task was first added, when it was removed and added again later', () => {
    const removed = at(2, 'task_removed_from_project', { taskId: 't' })
    expect(isPlanned([created, added(1), removed, added(100)], 'p', 't')).toBe(true)
    // In any order
    expect(isPlanned([added(100), removed, added(1), created], 'p', 't')).toBe(true)
  })

  it('classifies a task in two projects for each project on its own', () => {
    const q = at(-200, 'project_created', { projectId: 'q' })
    const events = [q, created, added(1, 't', 'p'), added(1, 't', 'q')]
    expect(isPlanned(events, 'p', 't')).toBe(true)
    expect(isPlanned(events, 'q', 't')).toBe(false)
  })

  it('takes another window', () => {
    expect(isPlanned([created, added(30)], 'p', 't', 48)).toBe(true)
    expect(isPlanned([created, added(30)], 'p', 't', 12)).toBe(false)
  })

  it("can't tell for a project whose creation wasn't logged, or a task never added to it", () => {
    const backfilled = added(0)
    backfilled.source = 'backfill'
    expect(isPlanned([backfilled], 'p', 't')).toBeUndefined()
    expect(isPlanned([at(0, 'project_created', { source: 'backfill' }), backfilled], 'p', 't')).toBeUndefined()
    expect(isPlanned([created], 'p', 't')).toBeUndefined()
  })
})
