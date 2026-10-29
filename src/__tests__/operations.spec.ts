import { describe, it, expect } from 'vitest'
import { planProjectSave, planTaskSave, UnknownReference, type Plan } from '../types/operations'
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
