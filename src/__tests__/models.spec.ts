import { describe, it, expect } from 'vitest'
import { completionStatus, createEmptyProject, resolveTasks, type Project } from '../types/project'
import { createEmptyTask, relatedTasks, type Task, type TaskRelation } from '../types/task'

const task = (id: string, completed = false): Task => ({ ...createEmptyTask(), id, name: id, completed })
const projectWith = (taskIds: string[]): Project => ({ ...createEmptyProject(), taskIds })

describe('createEmptyTask', () => {
  it('starts blank with medium priority and a fresh id each time', () => {
    const a = createEmptyTask()
    expect(a).toEqual({
      id: expect.any(String),
      name: '',
      description: '',
      dueDate: null,
      relations: [],
      priority: 'medium',
      completed: false,
    })
    expect(createEmptyTask().id).not.toBe(a.id)
  })
})

describe('createEmptyProject', () => {
  it('starts blank with medium priority and a fresh id each time', () => {
    const a = createEmptyProject()
    expect(a).toEqual({
      id: expect.any(String),
      name: '',
      description: '',
      deliveryDate: null,
      taskIds: [],
      priority: 'medium',
      links: [],
      tagIds: [],
    })
    expect(createEmptyProject().id).not.toBe(a.id)
  })

  it('survives a JSON round trip unchanged', () => {
    const project = createEmptyProject()
    expect(JSON.parse(JSON.stringify(project))).toEqual(project)
  })
})

describe('resolveTasks', () => {
  const tasks = [task('a'), task('b'), task('c')]

  it("returns the project's tasks in the project's order", () => {
    expect(resolveTasks(projectWith(['c', 'a']), tasks).map((t) => t.id)).toEqual(['c', 'a'])
  })

  it('skips ids with no matching task', () => {
    expect(resolveTasks(projectWith(['a', 'missing']), tasks).map((t) => t.id)).toEqual(['a'])
  })

  it('returns nothing for a project without tasks', () => {
    expect(resolveTasks(projectWith([]), tasks)).toEqual([])
  })
})

describe('completionStatus', () => {
  it('counts completed and total tasks in the project only', () => {
    const tasks = [task('a', true), task('b'), task('c', true), task('other', true)]
    expect(completionStatus(projectWith(['a', 'b', 'c']), tasks)).toEqual({ completed: 2, total: 3 })
  })

  it('does not count ids with no matching task', () => {
    expect(completionStatus(projectWith(['a', 'missing']), [task('a', true)])).toEqual({ completed: 1, total: 1 })
  })

  it('is 0 of 0 for a project without tasks', () => {
    expect(completionStatus(projectWith([]), [])).toEqual({ completed: 0, total: 0 })
  })
})

describe('relatedTasks', () => {
  const withRelations = (id: string, relations: TaskRelation[]): Task => ({ ...task(id), relations })
  const summary = (id: string, tasks: Task[]) =>
    relatedTasks(tasks.find((t) => t.id === id)!, tasks).map((r) => `${r.type} ${r.task.id}`)

  it("lists the task's own relations", () => {
    const tasks = [withRelations('a', [{ taskId: 'b', type: 'blocks' }]), task('b')]
    expect(summary('a', tasks)).toEqual(['blocks b'])
  })

  it('turns round the relations other tasks record with it', () => {
    const tasks = [
      withRelations('a', [{ taskId: 'c', type: 'blocks' }]),
      withRelations('b', [{ taskId: 'c', type: 'parent_of' }]),
      withRelations('c', [{ taskId: 'd', type: 'related_to' }]),
      withRelations('d', []),
    ]
    expect(summary('c', tasks)).toEqual(['related_to d', 'blocked_by a', 'subtask_of b'])
    expect(summary('d', tasks)).toEqual(['related_to c'])
  })

  it('lists a relation recorded on both tasks once', () => {
    const tasks = [
      withRelations('a', [{ taskId: 'b', type: 'blocks' }]),
      withRelations('b', [{ taskId: 'a', type: 'blocked_by' }]),
    ]
    expect(summary('a', tasks)).toEqual(['blocks b'])
    expect(summary('b', tasks)).toEqual(['blocked_by a'])
  })

  it('skips relations to tasks that no longer exist', () => {
    expect(summary('a', [withRelations('a', [{ taskId: 'gone', type: 'blocks' }])])).toEqual([])
  })
})
