import { describe, it, expect } from 'vitest'
import {
  ActionRefused,
  applyTaskPatch,
  BlockLoop,
  planProjectSave,
  planTaskAction,
  planTaskPatch,
  planTaskSave,
  planTasksImport,
  UnknownReference,
  type Plan,
  type State,
  type TaskAction,
} from '../types/operations'
import { createEmptyProject, type Project } from '../types/project'
import { ARCHIVE_TAG_ID } from '../types/tag'
import { createEmptyTask, type Task } from '../types/task'

const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id, name: id, ...fields })
const project = (id: string, fields: Partial<Project> = {}): Project => ({
  ...createEmptyProject(),
  id,
  name: id,
  ...fields,
})

// The changes of a plan that went through
function changesOf(plan: Plan) {
  if (!plan.ok) throw new Error(`Expected the save to go through, got clashes ${JSON.stringify(plan.clashes)}`)
  return plan.changes
}

const ids = (items: { id: string }[]) => items.map((i) => i.id)

describe('planTaskSave', () => {
  describe('archiving', () => {
    it('archives the projects the change completes, keeping their other tags', () => {
      const state = {
        tasks: [task('t'), task('u')],
        projects: [project('p', { taskIds: ['t'], tagIds: ['work'] }), project('q', { taskIds: ['t', 'u'] }), project('r')],
      }
      const done = task('t', { completed: true })

      const changes = changesOf(planTaskSave(state, { task: done }))

      expect(changes.tasks).toEqual([done])
      expect(changes.projects).toEqual([{ ...state.projects[0], tagIds: ['work', ARCHIVE_TAG_ID] }])
    })

    it('leaves a completed project that was taken out of the archive alone', () => {
      const state = { tasks: [task('t', { completed: true })], projects: [project('p', { taskIds: ['t'] })] }
      const renamed = task('t', { name: 'Renamed', completed: true })

      expect(changesOf(planTaskSave(state, { task: renamed }))).toEqual({ tasks: [renamed], projects: [] })
    })

    it('archives only the project the save completes when the task is in two', () => {
      const state = {
        tasks: [task('t'), task('u')],
        projects: [project('solo', { taskIds: ['t'] }), project('shared', { taskIds: ['t', 'u'] })],
      }

      const changes = changesOf(planTaskSave(state, { task: task('t', { completed: true }) }))

      expect(changes.projects.map((p) => [p.id, p.tagIds])).toEqual([['solo', [ARCHIVE_TAG_ID]]])
    })

    it('archives a project the task joins when that completes it', () => {
      const state = { tasks: [task('t', { completed: true })], projects: [project('p')] }

      const changes = changesOf(planTaskSave(state, { task: state.tasks[0]!, projectIds: ['p'] }))

      expect(changes.projects).toEqual([{ ...state.projects[0], taskIds: ['t'], tagIds: [ARCHIVE_TAG_ID] }])
    })
  })

  describe('membership', () => {
    it('changes only the projects whose membership changes', () => {
      const state = { tasks: [task('t1')], projects: [project('p1', { taskIds: ['t1'] }), project('p2'), project('p3')] }

      const changes = changesOf(planTaskSave(state, { task: state.tasks[0]!, projectIds: ['p2'] }))

      expect(changes.projects.map((p) => [p.id, p.taskIds])).toEqual([
        ['p1', []],
        ['p2', ['t1']],
      ])
    })

    it("adds a new task after the project's existing tasks", () => {
      const state = { tasks: [task('a'), task('b')], projects: [project('p', { taskIds: ['a', 'b'] })] }
      const added = task('c')

      const changes = changesOf(planTaskSave(state, { task: added, projectIds: ['p'] }))

      expect(changes.tasks).toEqual([added])
      expect(changes.projects[0]!.taskIds).toEqual(['a', 'b', 'c'])
    })

    it('changes no project when the assignment is unchanged', () => {
      const state = { tasks: [task('t')], projects: [project('p1', { taskIds: ['t'] }), project('p2')] }

      expect(changesOf(planTaskSave(state, { task: state.tasks[0]!, projectIds: ['p1'] })).projects).toEqual([])
    })

    it('leaves membership alone when projectIds is omitted', () => {
      const state = { tasks: [task('t')], projects: [project('p', { taskIds: ['t'] })] }

      expect(changesOf(planTaskSave(state, { task: task('t', { name: 'Renamed' }) })).projects).toEqual([])
    })
  })

  describe('clashes', () => {
    // t is already due after p's delivery date in the stored data
    const clashing = () => ({
      tasks: [task('t', { dueDate: '2026-11-05' }), task('u')],
      projects: [project('p', { deliveryDate: '2026-11-01', taskIds: ['t', 'u'] })],
    })

    it('lets a completion toggle through despite a clash already stored', () => {
      const state = clashing()
      const done = task('t', { dueDate: '2026-11-05', completed: true })

      expect(changesOf(planTaskSave(state, { task: done })).tasks).toEqual([done])
    })

    it('refuses a due date that clashes and lists the clash, archiving nothing', () => {
      const state = {
        tasks: [task('t', { dueDate: '2026-10-30' })],
        projects: [project('p', { deliveryDate: '2026-11-01', taskIds: ['t'] })],
      }

      const plan = planTaskSave(state, { task: task('t', { dueDate: '2026-11-03', completed: true }) })

      expect(plan).toEqual({
        ok: false,
        clashes: [{ taskId: 't', projectId: 'p', dueDate: '2026-11-03', deliveryDate: '2026-11-01' }],
      })
    })

    it('refuses joining a project whose delivery date the task is due after', () => {
      const state = { tasks: [task('t', { dueDate: '2026-11-03' })], projects: [project('p', { deliveryDate: '2026-11-01' })] }

      const plan = planTaskSave(state, { task: state.tasks[0]!, projectIds: ['p'] })

      expect(plan.ok).toBe(false)
    })

    it('refuses moving the due date of a task that already clashes to another clashing date', () => {
      const plan = planTaskSave(clashing(), { task: task('t', { dueDate: '2026-11-06' }) })

      expect(plan.ok).toBe(false)
    })

    it('accepts a clashing due date when deliveryDates moves the project to match', () => {
      const state = clashing()
      const later = task('t', { dueDate: '2026-11-08' })

      const changes = changesOf(planTaskSave(state, { task: later, deliveryDates: { p: '2026-11-08' } }))

      expect(changes).toEqual({ tasks: [later], projects: [{ ...state.projects[0], deliveryDate: '2026-11-08' }] })
    })
  })

  describe('changes', () => {
    it('leaves out every entity the save does not change', () => {
      const state = {
        tasks: [task('t'), task('u', { dueDate: '2026-11-05' })],
        projects: [
          project('p', { deliveryDate: '2026-11-01', taskIds: ['t', 'u'] }),
          project('q', { deliveryDate: '2026-12-01', taskIds: ['t'] }),
          project('r'),
        ],
      }
      const renamed = task('t', { name: 'Renamed' })

      // Re-sends q's own delivery date and p's membership, neither of which changes anything
      const changes = changesOf(
        planTaskSave(state, { task: renamed, projectIds: ['p', 'q'], deliveryDates: { q: '2026-12-01' } }),
      )

      expect(changes).toEqual({ tasks: [renamed], projects: [] })
    })

    it('leaves the given state unchanged', () => {
      const state = { tasks: [task('t')], projects: [project('p', { taskIds: ['t'] }), project('q')] }
      const copy = structuredClone(state)

      planTaskSave(state, { task: task('t', { completed: true }), projectIds: ['q'], deliveryDates: { p: '2026-11-01' } })

      expect(state).toEqual(copy)
    })
  })

  it('throws UnknownReference for a project id it does not know', () => {
    const state = { tasks: [task('t')], projects: [project('p')] }

    expect(() => planTaskSave(state, { task: state.tasks[0]!, projectIds: ['p', 'gone'] })).toThrow(UnknownReference)
    expect(() => planTaskSave(state, { task: state.tasks[0]!, deliveryDates: { gone: '2026-11-01' } })).toThrow(
      UnknownReference,
    )
  })
})

describe('planProjectSave', () => {
  it('changes only the saved project when nothing else moves', () => {
    const state = { tasks: [task('t')], projects: [project('p', { taskIds: ['t'] }), project('q')] }
    const renamed = { ...state.projects[0]!, name: 'Renamed' }

    expect(changesOf(planProjectSave(state, { project: renamed }))).toEqual({ tasks: [], projects: [renamed] })
  })

  it('adds a new project', () => {
    const state = { tasks: [task('t')], projects: [] }
    const added = project('p', { taskIds: ['t'] })

    expect(changesOf(planProjectSave(state, { project: added }))).toEqual({ tasks: [], projects: [added] })
  })

  it('archives a project saved with only completed tasks', () => {
    const state = { tasks: [task('t', { completed: true })], projects: [project('p')] }

    const changes = changesOf(planProjectSave(state, { project: project('p', { taskIds: ['t'], tagIds: ['work'] }) }))

    expect(changes.projects[0]!.tagIds).toEqual(['work', ARCHIVE_TAG_ID])
  })

  it('lets a rename through despite a clash already stored', () => {
    const state = {
      tasks: [task('t', { dueDate: '2026-11-05' })],
      projects: [project('p', { deliveryDate: '2026-11-01', taskIds: ['t'] })],
    }

    expect(planProjectSave(state, { project: { ...state.projects[0]!, name: 'Renamed' } }).ok).toBe(true)
  })

  it('refuses an earlier delivery date that a task is due after, listing every clash', () => {
    const state = {
      tasks: [task('t', { dueDate: '2026-11-05' }), task('u', { dueDate: '2026-11-03' }), task('v')],
      projects: [project('p', { deliveryDate: '2026-11-10', taskIds: ['t', 'u', 'v'] })],
    }

    const plan = planProjectSave(state, { project: { ...state.projects[0]!, deliveryDate: '2026-11-01' } })

    expect(plan).toEqual({
      ok: false,
      clashes: [
        { taskId: 't', projectId: 'p', dueDate: '2026-11-05', deliveryDate: '2026-11-01' },
        { taskId: 'u', projectId: 'p', dueDate: '2026-11-03', deliveryDate: '2026-11-01' },
      ],
    })
  })

  it('refuses taking in a task due after the delivery date', () => {
    const state = {
      tasks: [task('t', { dueDate: '2026-11-05' })],
      projects: [project('p', { deliveryDate: '2026-11-01' })],
    }

    expect(planProjectSave(state, { project: { ...state.projects[0]!, taskIds: ['t'] } }).ok).toBe(false)
  })

  it('accepts an earlier delivery date when dueDates moves the tasks to match', () => {
    const state = {
      tasks: [task('t', { dueDate: '2026-11-05' }), task('u', { dueDate: '2026-10-20' })],
      projects: [project('p', { deliveryDate: '2026-11-10', taskIds: ['t', 'u'] })],
    }
    const earlier = { ...state.projects[0]!, deliveryDate: '2026-11-01' }

    // u is already early enough, so re-sending its date changes nothing
    const changes = changesOf(planProjectSave(state, { project: earlier, dueDates: { t: '2026-11-01', u: '2026-10-20' } }))

    expect(changes).toEqual({ tasks: [{ ...state.tasks[0], dueDate: '2026-11-01' }], projects: [earlier] })
  })

  it('throws UnknownReference for a task id it does not know', () => {
    const state = { tasks: [task('t')], projects: [project('p')] }

    expect(() => planProjectSave(state, { project: state.projects[0]!, dueDates: { gone: '2026-11-01' } })).toThrow(
      UnknownReference,
    )
  })
})

describe('blocking loops', () => {
  const loopOf = (plan: () => Plan) => {
    try {
      plan()
    } catch (e) {
      if (e instanceof BlockLoop) return e.loop
      throw e
    }
    return null
  }

  it('refuses a task save whose relation closes a loop, stored on either task', () => {
    const state = { tasks: [task('a', { relations: [{ taskId: 'b', type: 'blocks' }] }), task('b')], projects: [] }
    expect(loopOf(() => planTaskSave(state, { task: task('b', { relations: [{ taskId: 'a', type: 'blocks' }] }) }))).toEqual([
      'b',
      'a',
    ])
    // b blocked by a is the edge that's already there, so this one is fine
    expect(loopOf(() => planTaskSave(state, { task: task('b', { relations: [{ taskId: 'a', type: 'blocked_by' }] }) }))).toBeNull()
  })

  it('finds a longer loop that a blocked by relation closes', () => {
    // a blocks b, and c is blocked by b; a blocked by c closes a -> b -> c -> a
    const state = {
      tasks: [task('a', { relations: [{ taskId: 'b', type: 'blocks' }] }), task('b'), task('c', { relations: [{ taskId: 'b', type: 'blocked_by' }] })],
      projects: [],
    }
    const saved = task('a', { relations: [{ taskId: 'b', type: 'blocks' }, { taskId: 'c', type: 'blocked_by' }] })
    expect(loopOf(() => planTaskSave(state, { task: saved }))).toEqual(['c', 'a', 'b'])
  })

  it('lets saves through that leave a loop already in the data as it is', () => {
    const state = {
      tasks: [task('a', { relations: [{ taskId: 'b', type: 'blocks' }] }), task('b', { relations: [{ taskId: 'a', type: 'blocks' }] })],
      projects: [],
    }
    const done = { ...state.tasks[0]!, completed: true }
    expect(changesOf(planTaskSave(state, { task: done })).tasks).toEqual([done])
  })
})

describe('start dates moved back with a due date', () => {
  it('moves a start date back when a project save moves the due date before it', () => {
    const state = {
      tasks: [task('t', { dueDate: '2026-12-10', startDate: '2026-12-05' }), task('u', { dueDate: '2026-12-10', startDate: '2026-12-01' })],
      projects: [project('p', { taskIds: ['t', 'u'] })],
    }
    const changes = changesOf(
      planProjectSave(state, { project: state.projects[0]!, dueDates: { t: '2026-12-03', u: '2026-12-03' } }),
    )
    expect(changes.tasks).toEqual([
      task('t', { dueDate: '2026-12-03', startDate: '2026-12-03' }),
      task('u', { dueDate: '2026-12-03', startDate: '2026-12-01' }),
    ])
  })

  it('moves the start date of an imported task back to its due date', () => {
    const state = { tasks: [task('t', { dueDate: '2026-12-10', startDate: '2026-12-05' })], projects: [project('p', { taskIds: ['t'] })] }
    const changes = changesOf(planTasksImport(state, 'p', { tasks: [task('t', { dueDate: '2026-12-02', startDate: '2026-12-05' })] }))
    expect(changes.tasks).toEqual([task('t', { dueDate: '2026-12-02', startDate: '2026-12-02' })])
  })

  it('leaves a task save as it is, since the task form shows the start date', () => {
    const late = task('t', { dueDate: '2026-12-02', startDate: '2026-12-05' })
    expect(changesOf(planTaskSave({ tasks: [], projects: [] }, { task: late })).tasks).toEqual([late])
  })
})

describe('planTaskAction', () => {
  const today = '2026-11-16'
  const stored = task('t', { dueDate: '2026-11-20', effortMinutes: 90, relations: [{ taskId: 'u', type: 'blocks' }] })
  const state = { tasks: [stored, task('u')], projects: [project('p', { taskIds: ['t'] })] }
  const acted = (action: TaskAction, from = state) => changesOf(planTaskAction(from, 't', action)).tasks
  const refusal = (action: TaskAction, from = state) => {
    try {
      planTaskAction(from, 't', action)
    } catch (e) {
      if (e instanceof ActionRefused) return e.message
      throw e
    }
    return null
  }

  it('pins the task to today, and unpins it', () => {
    expect(acted({ action: 'do_today', today })).toEqual([{ ...stored, pinnedDate: today }])
    const pinned = { tasks: [{ ...stored, pinnedDate: today }, task('u')], projects: state.projects }
    expect(acted({ action: 'unpin' }, pinned)).toEqual([stored])
  })

  it('starts the task tomorrow, dropping a pin to today', () => {
    expect(acted({ action: 'not_today', today })).toEqual([{ ...stored, startDate: '2026-11-17' }])
    const pinned = { tasks: [{ ...stored, pinnedDate: today }, task('u')], projects: state.projects }
    expect(acted({ action: 'not_today', today }, pinned)).toEqual([{ ...stored, startDate: '2026-11-17' }])
  })

  it('refuses Not today for a task due today or overdue', () => {
    const dueToday = { tasks: [{ ...stored, dueDate: today }], projects: [] }
    expect(refusal({ action: 'not_today', today }, dueToday)).toBe(`"t": It's due today, so it can't wait until tomorrow`)
    const overdue = { tasks: [{ ...stored, dueDate: '2026-11-13' }], projects: [] }
    expect(refusal({ action: 'not_today', today }, overdue)).toBe(`"t": It's overdue, so it can't wait until tomorrow`)
  })

  it('moves the priority one level, refusing past either end', () => {
    expect(acted({ action: 'importance', direction: 'up' })).toEqual([{ ...stored, priority: 'high' }])
    expect(acted({ action: 'importance', direction: 'down' })).toEqual([{ ...stored, priority: 'low' }])
    const urgent = { tasks: [{ ...stored, priority: 'urgent' as const }], projects: [] }
    expect(refusal({ action: 'importance', direction: 'up' }, urgent)).toBe('"t" is already urgent priority')
    const low = { tasks: [{ ...stored, priority: 'low' as const }], projects: [] }
    expect(refusal({ action: 'importance', direction: 'down' }, low)).toBe('"t" is already low priority')
  })

  it('sets or clears the estimate', () => {
    expect(acted({ action: 'estimate', effortMinutes: 240 })).toEqual([{ ...stored, effortMinutes: 240 }])
    const { effortMinutes: _, ...unestimated } = stored
    expect(acted({ action: 'estimate', effortMinutes: null })).toEqual([unestimated])
  })

  it('keeps everything else about the task, its Google account included', () => {
    const imported = { tasks: [{ ...stored, googleAccount: 'me@example.com' }], projects: [] }
    expect(acted({ action: 'do_today', today }, imported)).toEqual([{ ...stored, googleAccount: 'me@example.com', pinnedDate: today }])
  })

  it('refuses an unknown task', () => {
    expect(() => planTaskAction(state, 'missing', { action: 'unpin' })).toThrow(UnknownReference)
  })

  it('logs its events as the app, unless told they come from the Telegram bot', () => {
    const sources = (plan: Plan) => (plan.ok ? plan.events.map((e) => [e.kind, e.source]) : null)
    const done = { ...stored, completed: true }
    expect(sources(planTaskSave(state, { task: done }))).toEqual([['task_completed', 'app']])
    expect(sources(planTaskSave(state, { task: done }, 'telegram'))).toEqual([['task_completed', 'telegram']])
    expect(sources(planTaskSave(state, { task: { ...stored, dueDate: '2026-11-21' } }, 'telegram'))).toEqual([
      ['due_date_changed', 'telegram'],
    ])
  })

  it('gives each refusal a code and its values, besides the sentence', () => {
    const sentenceOf = (action: TaskAction, from: State) => {
      try {
        planTaskAction(from, 't', action)
      } catch (e) {
        if (e instanceof ActionRefused) return e.sentence
        throw e
      }
      return null
    }
    const at = (fields: Partial<Task>) => ({ tasks: [{ ...stored, ...fields }], projects: [] })
    expect(sentenceOf({ action: 'not_today', today }, at({ dueDate: today }))).toEqual({
      code: 'due_today',
      params: { taskId: 't', task: 't', dueDate: today },
      text: `"t": It's due today, so it can't wait until tomorrow`,
    })
    expect(sentenceOf({ action: 'not_today', today }, at({ dueDate: '2026-11-13' }))!.code).toBe('overdue')
    expect(sentenceOf({ action: 'importance', direction: 'up' }, at({ priority: 'urgent' }))).toEqual({
      code: 'priority_at_top',
      params: { taskId: 't', task: 't', priority: 'urgent' },
      text: '"t" is already urgent priority',
    })
    expect(sentenceOf({ action: 'importance', direction: 'down' }, at({ priority: 'low' }))!.code).toBe('priority_at_bottom')
  })
})

describe('partial task updates', () => {
  const stored = task('t', {
    description: 'Chapter 3',
    dueDate: '2026-11-20',
    effortMinutes: 90,
    startDate: '2026-11-18',
    pinnedDate: '2026-11-16',
    googleAccount: 'me@example.com',
  })

  it('changes only the fields the patch names', () => {
    expect(applyTaskPatch(stored, { completed: true, priority: 'high' })).toEqual({ ...stored, completed: true, priority: 'high' })
    expect(applyTaskPatch(stored, {})).toEqual(stored)
  })

  it('clears the due date and the optional fields with null', () => {
    const { effortMinutes: _e, startDate: _s, pinnedDate: _p, ...bare } = stored
    expect(applyTaskPatch(stored, { effortMinutes: null, startDate: null, pinnedDate: null, dueDate: null })).toEqual({ ...bare, dueDate: null })
  })

  it('plans the patched task as a save, under the same rules', () => {
    const state = { tasks: [stored, task('u', { relations: [{ taskId: 't', type: 'blocks' }] })], projects: [project('p', { taskIds: ['t'] })] }
    expect(changesOf(planTaskPatch(state, 't', { task: { completed: true } }))).toMatchObject({
      tasks: [{ ...stored, completed: true }],
      projects: [{ id: 'p', tagIds: [ARCHIVE_TAG_ID] }],
    })
    expect(() => planTaskPatch(state, 't', { task: { relations: [{ taskId: 'u', type: 'blocks' }] } })).toThrow(BlockLoop)
    expect(() => planTaskPatch(state, 'missing', { task: {} })).toThrow(UnknownReference)
    expect(changesOf(planTaskPatch(state, 't', { task: {}, projectIds: [] })).projects).toEqual([project('p')])
  })
})
