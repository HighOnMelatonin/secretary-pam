import { describe, it, expect } from 'vitest'
import { createEmptyProject, type Project } from '../types/project'
import {
  applyMembership,
  blockEdges,
  clampStartDate,
  describeLoop,
  findBlockCycle,
  findClashes,
  projectsToArchive,
  startsAfterDue,
} from '../types/rules'
import { ARCHIVE_TAG_ID } from '../types/tag'
import { createEmptyTask, type Task } from '../types/task'

const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id, name: id, ...fields })
const project = (id: string, fields: Partial<Project> = {}): Project => ({
  ...createEmptyProject(),
  id,
  name: id,
  ...fields,
})

describe('findClashes', () => {
  it('finds a task due after the delivery date of a project it is in', () => {
    const tasks = [task('late', { dueDate: '2026-11-02' }), task('early', { dueDate: '2026-10-30' })]
    const projects = [project('p', { deliveryDate: '2026-11-01', taskIds: ['late', 'early'] })]
    expect(findClashes(tasks, projects)).toEqual([
      { taskId: 'late', projectId: 'p', dueDate: '2026-11-02', deliveryDate: '2026-11-01' },
    ])
  })

  it('only counts a clash when both dates are set', () => {
    const tasks = [task('dated', { dueDate: '2026-11-02' }), task('undated')]
    const projects = [
      project('no-deadline', { taskIds: ['dated'] }),
      project('deadline', { deliveryDate: '2026-11-01', taskIds: ['undated'] }),
    ]
    expect(findClashes(tasks, projects)).toEqual([])
  })

  it('ignores tasks the project does not list', () => {
    const tasks = [task('late', { dueDate: '2026-11-02' })]
    expect(findClashes(tasks, [project('p', { deliveryDate: '2026-11-01' })])).toEqual([])
  })
})

describe('applyMembership', () => {
  it('appends the task after the existing ones', () => {
    const projects = [project('p', { taskIds: ['a', 'b'] })]
    expect(applyMembership(projects, 'c', ['p'])).toEqual([{ ...projects[0], taskIds: ['a', 'b', 'c'] }])
  })

  it('removes the task from the projects it leaves and returns only the changed ones', () => {
    const projects = [project('p1', { taskIds: ['a', 't'] }), project('p2'), project('p3', { taskIds: ['t'] })]
    expect(applyMembership(projects, 't', ['p2', 'p3']).map((p) => [p.id, p.taskIds])).toEqual([
      ['p1', ['a']],
      ['p2', ['t']],
    ])
  })

  it('returns nothing when no project changes', () => {
    const projects = [project('p1', { taskIds: ['t'] }), project('p2')]
    expect(applyMembership(projects, 't', ['p1'])).toEqual([])
  })

  it('leaves the given projects unchanged', () => {
    const projects = [project('p', { taskIds: ['a'] })]
    applyMembership(projects, 'b', ['p'])
    expect(projects[0]!.taskIds).toEqual(['a'])
  })
})

describe('projectsToArchive', () => {
  const open = task('t')
  const done = task('t', { completed: true })

  it('archives a project whose last task was completed', () => {
    const projects = [project('p', { taskIds: ['t'] })]
    expect(projectsToArchive({ projects, tasks: [open] }, { projects, tasks: [done] })).toEqual(['p'])
  })

  it('never archives a project with no tasks', () => {
    const projects = [project('p')]
    expect(projectsToArchive({ projects: [], tasks: [] }, { projects, tasks: [done] })).toEqual([])
  })

  it('does not re-archive a completed project taken out of the archive by hand', () => {
    const archived = project('p', { taskIds: ['t'], tagIds: [ARCHIVE_TAG_ID] })
    const unarchived = { ...archived, tagIds: [] }
    expect(
      projectsToArchive({ projects: [archived], tasks: [done] }, { projects: [unarchived], tasks: [done] }),
    ).toEqual([])
  })

  it('archives a new project created complete', () => {
    const projects = [project('p', { taskIds: ['t'] })]
    expect(projectsToArchive({ projects: [], tasks: [done] }, { projects, tasks: [done] })).toEqual(['p'])
  })

  it('skips a project that is already archived', () => {
    const projects = [project('p', { taskIds: ['t'], tagIds: [ARCHIVE_TAG_ID] })]
    expect(projectsToArchive({ projects, tasks: [open] }, { projects, tasks: [done] })).toEqual([])
  })
})

describe('startsAfterDue', () => {
  it('is true only when both dates are set and the start is later', () => {
    expect(startsAfterDue(task('t', { startDate: '2026-11-03', dueDate: '2026-11-02' }))).toBe(true)
    expect(startsAfterDue(task('t', { startDate: '2026-11-02', dueDate: '2026-11-02' }))).toBe(false)
    expect(startsAfterDue(task('t', { startDate: '2026-11-01', dueDate: '2026-11-02' }))).toBe(false)
    expect(startsAfterDue(task('t', { startDate: '2026-11-03' }))).toBe(false)
    expect(startsAfterDue(task('t', { dueDate: '2026-11-02' }))).toBe(false)
  })
})

describe('clampStartDate', () => {
  it('moves a start date after the due date back to it', () => {
    const late = task('t', { startDate: '2026-11-05', dueDate: '2026-11-02' })
    expect(clampStartDate(late)).toEqual({ ...late, startDate: '2026-11-02' })
  })

  it('returns the same task when the start date is fine', () => {
    for (const fine of [task('t', { startDate: '2026-11-01', dueDate: '2026-11-02' }), task('t', { startDate: '2026-11-05' }), task('t')]) {
      expect(clampStartDate(fine)).toBe(fine)
    }
  })
})

describe('blockEdges', () => {
  it('reads blocks and blocked by from both sides as the same edge', () => {
    const tasks = [
      task('a', { relations: [{ taskId: 'b', type: 'blocks' }] }),
      task('b', { relations: [{ taskId: 'a', type: 'blocked_by' }] }),
      task('c', { relations: [{ taskId: 'b', type: 'blocked_by' }] }),
    ]
    expect(blockEdges(tasks)).toEqual(
      new Map([
        ['a', ['b']],
        ['b', ['c']],
        ['c', []],
      ]),
    )
  })

  it('leaves out other relation types and tasks that are not in the list', () => {
    const tasks = [
      task('a', {
        relations: [
          { taskId: 'b', type: 'parent_of' },
          { taskId: 'c', type: 'related_to' },
          { taskId: 'gone', type: 'blocks' },
        ],
      }),
      task('b', { relations: [{ taskId: 'gone', type: 'blocked_by' }] }),
      task('c'),
    ]
    expect(blockEdges(tasks)).toEqual(
      new Map([
        ['a', []],
        ['b', []],
        ['c', []],
      ]),
    )
  })
})

describe('findBlockCycle', () => {
  it('finds a loop of two stored on the two tasks', () => {
    const tasks = [task('a', { relations: [{ taskId: 'b', type: 'blocks' }] }), task('b', { relations: [{ taskId: 'a', type: 'blocks' }] })]
    expect(findBlockCycle(tasks)).toEqual(['a', 'b'])
  })

  it('finds a loop stored as blocks on one task and blocked by on another', () => {
    // a blocks b, b blocks c (stored on c as blocked by), c blocks a (stored on a as blocked by)
    const tasks = [
      task('a', { relations: [{ taskId: 'b', type: 'blocks' }, { taskId: 'c', type: 'blocked_by' }] }),
      task('b'),
      task('c', { relations: [{ taskId: 'b', type: 'blocked_by' }] }),
    ]
    expect(findBlockCycle(tasks)).toEqual(['a', 'b', 'c'])
  })

  it('finds nothing in a chain, or where tasks block the same task', () => {
    const tasks = [
      task('a', { relations: [{ taskId: 'b', type: 'blocks' }, { taskId: 'c', type: 'blocks' }] }),
      task('b', { relations: [{ taskId: 'c', type: 'blocks' }] }),
      task('c', { relations: [{ taskId: 'a', type: 'related_to' }] }),
    ]
    expect(findBlockCycle(tasks)).toBeNull()
  })

  it('only counts loops that use an edge the tasks before did not have', () => {
    const looped = [task('a', { relations: [{ taskId: 'b', type: 'blocks' }] }), task('b', { relations: [{ taskId: 'a', type: 'blocks' }] })]
    const renamed = [{ ...looped[0]!, name: 'Renamed' }, looped[1]!]
    expect(findBlockCycle(renamed, looped)).toBeNull()

    const another = [...looped, task('c', { relations: [{ taskId: 'a', type: 'blocks' }, { taskId: 'b', type: 'blocked_by' }] })]
    // b -> c is the first new edge found, going round the tasks in order
    expect(findBlockCycle(another, [...looped, task('c')])).toEqual(['b', 'c', 'a'])
  })

  it('gives the shortest loop through the new edge', () => {
    // d -> a is new; a -> b -> d is the short way back, a -> c -> e -> d the long one
    const before = [
      task('a', { relations: [{ taskId: 'c', type: 'blocks' }, { taskId: 'b', type: 'blocks' }] }),
      task('b', { relations: [{ taskId: 'd', type: 'blocks' }] }),
      task('c', { relations: [{ taskId: 'e', type: 'blocks' }] }),
      task('d'),
      task('e', { relations: [{ taskId: 'd', type: 'blocks' }] }),
    ]
    const after = before.map((t) => (t.id === 'd' ? task('d', { relations: [{ taskId: 'a', type: 'blocks' }] }) : t))
    expect(findBlockCycle(after, before)).toEqual(['d', 'a', 'b'])
  })
})

describe('describeLoop', () => {
  const names: Record<string, string> = { a: 'Draft', b: 'Review', c: 'Print' }
  it('names each task in turn, back to the first', () => {
    expect(describeLoop(['a', 'b'], (id) => names[id]!)).toBe('"Draft" blocks "Review", which blocks "Draft"')
    expect(describeLoop(['a', 'b', 'c'], (id) => names[id]!)).toBe(
      '"Draft" blocks "Review", which blocks "Print", which blocks "Draft"',
    )
  })
})
