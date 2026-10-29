import { describe, it, expect } from 'vitest'
import { createEmptyProject, type Project } from '../types/project'
import { applyMembership, findClashes, projectsToArchive } from '../types/rules'
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
