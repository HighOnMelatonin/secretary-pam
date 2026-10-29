import { describe, it, expect } from 'vitest'
import { completionStatus, createEmptyProject, resolveTasks, unassignedTasks, type Project } from '../types/project'
import { createEmptyTask, findTasks, relatedTasks, type Task, type TaskRelation } from '../types/task'
import { ARCHIVE_TAG_ID, contrastRatio, createEmptyTag, DEFAULT_TAG_COLOR, isHexColor, tagStyle, textColorOn } from '../types/tag'

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

describe('findTasks', () => {
  const tasks = [task('Write report'), task('Review slides'), task('Rewrite report', true), task('Book room')]
  const names = (query: string) => findTasks(tasks, query).map((t) => t.name)

  it('finds tasks whose name contains the query anywhere, ignoring case', () => {
    expect(names('REPORT')).toEqual(['Write report', 'Rewrite report'])
    expect(names('ite')).toEqual(['Write report', 'Rewrite report'])
    expect(names('slides')).toEqual(['Review slides'])
  })

  it('lists unfinished tasks first, then by name, keeping completed ones', () => {
    expect(names('r')).toEqual(['Book room', 'Review slides', 'Write report', 'Rewrite report'])
  })

  it('ignores the spaces around the query, and finds nothing for a blank one or no match', () => {
    expect(names('  book ')).toEqual(['Book room'])
    expect(names('')).toEqual([])
    expect(names('   ')).toEqual([])
    expect(names('thesis')).toEqual([])
  })
})

describe('unassignedTasks', () => {
  it('lists the tasks in no project, live or archived: unfinished first, then soonest due, undated last', () => {
    const dated = (id: string, dueDate: string | null, completed = false) => ({ ...task(id, completed), dueDate })
    const tasks = [
      dated('in live', '2026-11-01'),
      dated('in archived', '2026-11-02'),
      dated('undated', null),
      dated('done', '2026-11-03', true),
      dated('later', '2026-11-20'),
      dated('sooner', '2026-11-05'),
    ]
    const archived = { ...projectWith(['in archived']), tagIds: [ARCHIVE_TAG_ID] }
    expect(unassignedTasks(tasks, [projectWith(['in live']), archived]).map((t) => t.id)).toEqual([
      'sooner',
      'later',
      'undated',
      'done',
    ])
    expect(unassignedTasks([], [])).toEqual([])
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

describe('tag colours', () => {
  it('starts a new tag indigo', () => {
    expect(createEmptyTag().color).toBe('#343ca6')
    expect(DEFAULT_TAG_COLOR).toBe('#343ca6')
  })

  it('accepts only #rrggbb colours', () => {
    expect(['#343ca6', '#F5D76E', '#000000'].every(isHexColor)).toBe(true)
    expect(['indigo', '#fff', '343ca6', '#343ca6 ', '#34gca6', null, 0x343ca6].some(isHexColor)).toBe(false)
  })

  it('measures contrast as WCAG does', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21)
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21)
    expect(contrastRatio('#343ca6', '#343ca6')).toBe(1)
    expect(contrastRatio('#faefe0', '#343ca6')).toBeCloseTo(7.9, 1) // cream on indigo, from the README
  })

  it('writes cream on dark colours and forest green on light ones', () => {
    expect(['#343ca6', '#000000', '#9c2f55', '#204030'].map(textColorOn)).toEqual(Array(4).fill('#faefe0'))
    expect(['#ffffff', '#f5d76e', '#e69e7a', '#faefe0'].map(textColorOn)).toEqual(Array(4).fill('#204030'))
  })

  it('gives anything showing a tag its fill and text colour, falling back to indigo', () => {
    expect(tagStyle({ id: 't', name: 'T', color: '#f5d76e' })).toEqual({ '--pam-tag-fill': '#f5d76e', '--pam-tag-text': '#204030' })
    expect(tagStyle({ id: 't', name: 'T', color: 'url(x)' })).toEqual({ '--pam-tag-fill': '#343ca6', '--pam-tag-text': '#faefe0' })
  })
})
