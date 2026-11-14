import { describe, it, expect } from 'vitest'
import { exportRows, toJson } from '../types/export'
import { ImportError, parseImport, planImport, tasksToSave, type ImportFile } from '../types/import'
import { createEmptyProject, type Project } from '../types/project'
import { createEmptyTask, type Task } from '../types/task'

const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id, name: id, ...fields })
const project = (fields: Partial<Project> = {}): Project => ({ ...createEmptyProject(), id: 'p', name: 'Thesis', ...fields })

const file = (tasks: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ format: 'pam-project-export', version: 1, project: { name: 'Thesis', deliveryDate: null }, tasks, ...extra })

const errorOf = (text: string) => {
  try {
    parseImport(text)
  } catch (e) {
    expect(e).toBeInstanceOf(ImportError)
    return (e as Error).message
  }
  throw new Error('parsed')
}

describe('parseImport', () => {
  it('reads back exactly what Export writes', () => {
    const tasks = [
      task('t1', { name: 'Write report', dueDate: '2026-11-02', priority: 'high', description: 'Ünïcödé\nline 2' }),
      task('t2', { name: 'Review', completed: true }),
    ]
    const data = exportRows(project({ taskIds: ['t1', 't2'] }), tasks, { includeCompleted: true })
    expect(parseImport(toJson(data, { exportedAt: '2026-11-02T00:00:00.000Z' }))).toEqual({
      project: { name: 'Thesis' },
      tasks: data.tasks,
    })
  })

  it('fills in what a hand-written file leaves out', () => {
    expect(parseImport(file([{ name: 'Just a name' }]))).toEqual({
      project: { name: 'Thesis' },
      tasks: [{ id: null, name: 'Just a name', description: '', dueDate: null, priority: 'medium', completed: false }],
    })
    expect(parseImport(file([], { project: undefined })).project).toBeNull()
  })

  it.each([
    ['not JSON', '{ nope', "This isn't valid JSON. Import reads the JSON that Export makes."],
    ['another format', JSON.stringify({ format: 'csv', tasks: [] }), 'This isn\'t a Pam project export: its "format" should be "pam-project-export".'],
    ['an array', '[]', 'This isn\'t a Pam project export: its "format" should be "pam-project-export".'],
    ['a newer version', file([], { version: 2 }), 'This export is from a newer version of Pam (version 2); this one reads version 1.'],
    ['a version that is not a number', file([], { version: '1' }), 'The export\'s "version" should be a whole number.'],
    ['no task list', file([], { tasks: {} }), 'The export has no "tasks" list.'],
    ['too many tasks', file(Array.from({ length: 501 }, (_, i) => ({ name: `t${i}` }))), 'The export has 501 tasks; a project can have at most 500.'],
    ['a task that is not an object', file(['x']), 'Task 1: should be an object with a name, due date, priority and so on.'],
    ['a task with no name', file([{ name: 'a' }, { name: '  ' }]), 'Task 2: needs a name.'],
    ['a bad date', file([{ name: 'a', dueDate: '2/11/2026' }]), 'Task 1: "a" has a due date that isn\'t null or a YYYY-MM-DD date.'],
    ['a bad priority', file([{ name: 'a', priority: 'asap' }]), 'Task 1: "a" has a priority that isn\'t one of low, medium, high, urgent.'],
    ['completed as a string', file([{ name: 'a', completed: 'yes' }]), 'Task 1: "a" has "completed" that isn\'t true or false.'],
    ['an empty id', file([{ name: 'a', id: '' }]), 'Task 1: "a" has an id that isn\'t a string of 1 to 100 characters.'],
    ['a long name', file([{ name: 'x'.repeat(201) }]), `Task 1: "${'x'.repeat(201)}" has a name longer than 200 characters.`],
    ['a repeated id', file([{ name: 'a', id: 'x' }, { name: 'b' }, { name: 'c', id: 'x' }]), 'Tasks 1 and 3 have the same id, "x".'],
  ])('refuses %s, saying why', (_, text, message) => {
    expect(errorOf(text)).toBe(message)
  })
})

describe('planImport', () => {
  const ids = () => {
    let n = 0
    return () => `new${++n}`
  }
  const imported = (fields: Partial<ImportFile['tasks'][number]>) => ({
    id: null,
    name: 'x',
    description: '',
    dueDate: null,
    priority: 'medium' as const,
    completed: false,
    ...fields,
  })
  const plan = (p: Project, tasks: Task[], fileTasks: ImportFile['tasks']) =>
    planImport(p, tasks, { project: null, tasks: fileTasks }, ids())

  it('adds tasks the project has no match for, keeping their ids', () => {
    const result = plan(project(), [], [imported({ id: 'a', name: 'A', dueDate: '2026-11-02' }), imported({ name: 'B' })])
    expect(result.added).toEqual([
      { id: 'a', name: 'A', description: '', dueDate: '2026-11-02', relations: [], priority: 'medium', completed: false },
      { id: 'new1', name: 'B', description: '', dueDate: null, relations: [], priority: 'medium', completed: false },
    ])
    expect(result.duplicates).toEqual([])
  })

  it("leaves the project's identical tasks alone, matching by id or by name in any case", () => {
    const tasks = [task('a', { name: 'Write report' }), task('b', { name: 'Review' })]
    const result = plan(project({ taskIds: ['a', 'b'] }), tasks, [
      imported({ id: 'a', name: 'Write report' }),
      imported({ name: '  review ' }),
    ])
    expect(result.unchanged.map((t) => t.id)).toEqual(['a'])
    // A different case is still a difference to choose between
    expect(result.duplicates.map((d) => [d.current.id, d.matchedBy, d.differences])).toEqual([['b', 'name', ['name']]])
    expect(result.added).toEqual([])
  })

  it('lists only the fields that differ, keeping the current id, relations and Google account', () => {
    const current = task('a', { name: 'Draft', relations: [{ taskId: 'b', type: 'blocks' }], googleAccount: 'me@example.com' })
    const result = plan(project({ taskIds: ['a', 'b'] }), [current, task('b')], [
      imported({ id: 'a', name: 'Draft', dueDate: '2026-12-01', completed: true, priority: 'medium' }),
    ])
    expect(result.duplicates).toEqual([
      {
        current,
        imported: { ...current, dueDate: '2026-12-01', completed: true },
        matchedBy: 'id',
        differences: ['dueDate', 'completed'],
      },
    ])
  })

  it('matches ids before names, and each project task once', () => {
    const tasks = [task('a', { name: 'Same' }), task('b', { name: 'Same' })]
    const result = plan(project({ taskIds: ['a', 'b'] }), tasks, [
      imported({ name: 'Same', priority: 'high' }), // would take a by name, but a is named by id below
      imported({ id: 'a', name: 'Same', priority: 'low' }),
      imported({ name: 'Same', priority: 'urgent' }), // a and b are taken: a new task
    ])
    expect(result.duplicates.map((d) => [d.current.id, d.matchedBy, d.imported.priority])).toEqual([
      ['b', 'name', 'high'],
      ['a', 'id', 'low'],
    ])
    expect(result.added.map((t) => [t.id, t.priority])).toEqual([['new1', 'urgent']])
  })

  it("copies a task whose id belongs to another project's task, under a new id, rather than changing it", () => {
    const elsewhere = task('a', { name: 'Elsewhere' })
    const result = plan(project(), [elsewhere], [imported({ id: 'a', name: 'Elsewhere', priority: 'high' })])
    expect(result.added.map((t) => [t.id, t.name])).toEqual([['new1', 'Elsewhere']])
    expect(result.duplicates).toEqual([])
  })

  it('refuses an import that would take the project past 500 tasks', () => {
    const p = project({ taskIds: Array.from({ length: 499 }, (_, i) => `t${i}`) })
    expect(() => plan(p, [], [imported({ name: 'a' }), imported({ name: 'b' })])).toThrow(
      new ImportError('This would give the project 501 tasks; a project can have at most 500.'),
    )
  })
})

describe('tasksToSave', () => {
  it('sends the new tasks and the duplicates whose imported version was chosen', () => {
    const tasks = [task('a'), task('b')]
    const result = planImport(project({ taskIds: ['a', 'b'] }), tasks, {
      project: null,
      tasks: [
        { id: 'a', name: 'A2', description: '', dueDate: null, priority: 'medium', completed: false },
        { id: 'b', name: 'B2', description: '', dueDate: null, priority: 'medium', completed: false },
        { id: 'c', name: 'C', description: '', dueDate: null, priority: 'medium', completed: false },
      ],
    })
    expect(tasksToSave(result, { a: 'current', b: 'imported' }).map((t) => [t.id, t.name])).toEqual([
      ['c', 'C'],
      ['b', 'B2'],
    ])
  })
})
