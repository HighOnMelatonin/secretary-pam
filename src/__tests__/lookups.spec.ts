import { describe, it, expect } from 'vitest'
import { forecast } from '../types/forecast'
import {
  lateTasks,
  lookupProject,
  offTrackProjects,
  projectTasks,
  projectTasksById,
  quickWins,
  TASK_GROUP_LABELS,
  visibleTasks,
} from '../types/lookups'
import { prioritise } from '../types/priority'
import { createEmptyProject, type Project } from '../types/project'
import { DEFAULT_SETTINGS, type UserSettings } from '../types/settings'
import { ARCHIVE_TAG_ID } from '../types/tag'
import { createEmptyTask, type Task } from '../types/task'

// Monday. The default capacity is 8 hours Monday to Friday.
const MON = '2026-11-16'
const TUE = '2026-11-17'
const WED = '2026-11-18'
const FRI = '2026-11-20'
const NEXT_MON = '2026-11-23'
const LAST_FRI = '2026-11-13'

const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id, name: `Task ${id}`, ...fields })
const project = (id: string, fields: Partial<Project> = {}): Project => ({ ...createEmptyProject(), id, name: `Project ${id}`, ...fields })
const hours = (h: number) => h * 60
const settingsWith = (fields: Partial<UserSettings> = {}): UserSettings => ({ ...DEFAULT_SETTINGS, ...fields })
const NO_CAPACITY = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 }

const prioritiesOf = (tasks: Task[], projects: Project[] = [], settings = settingsWith()) => prioritise(tasks, projects, settings, MON)
const forecastOf = (tasks: Task[], projects: Project[] = [], settings = settingsWith()) => forecast(tasks, projects, settings, MON)

describe('visibleTasks', () => {
  it('lists Overdue, Do nowww, then Do next, leaving out hidden tasks', () => {
    const tasks = [
      task('next', { effortMinutes: 60 }),
      task('overdue', { dueDate: LAST_FRI, effortMinutes: 60 }),
      task('pinned', { pinnedDate: MON, effortMinutes: 60 }),
      task('later', { startDate: WED, effortMinutes: 60 }),
    ]
    expect(visibleTasks(prioritiesOf(tasks)).map((t) => t.taskId)).toEqual(['overdue', 'pinned', 'next'])
  })
})

describe('projectTasks', () => {
  const tasks = [
    task('next', { name: 'Next', effortMinutes: 90 }),
    task('overdue', { name: 'Overdue', dueDate: LAST_FRI }),
    task('blocker', { name: 'Blocker', effortMinutes: 30, relations: [{ taskId: 'blocked', type: 'blocks' }] }),
    task('blocked', { name: 'Blocked', effortMinutes: 60 }),
    task('later', { name: 'Later', startDate: WED, effortMinutes: 60 }),
    task('google', { name: 'Meeting', googleAccount: 'me@example.com' }),
    task('done', { name: 'Done', completed: true, effortMinutes: 60 }),
    task('elsewhere', { name: 'Elsewhere', effortMinutes: 60 }),
  ]
  const thesis = project('p', { name: 'Thesis', taskIds: ['google', 'next', 'overdue', 'blocker', 'blocked', 'later', 'done'] })

  it('groups the open tasks by category, then hidden, then not counted, with their hours', () => {
    const result = projectTasks(thesis, tasks, prioritiesOf(tasks, [thesis]))
    expect(result.groups.map((g) => [TASK_GROUP_LABELS[g.group], g.tasks.map((t) => [t.name, t.hours, t.unestimated])])).toEqual([
      ['Overdue', [['Overdue', 2, true]]],
      ['Do next', [['Blocker', 0.5, false], ['Next', 1.5, false]]],
      ['Waiting on other tasks', [['Blocked', 1, false]]],
      ['Not started yet', [['Later', 1, false]]],
      ['Not counted (from Google Calendar, no estimate)', [['Meeting', null, true]]],
    ])
  })

  it('counts only the tasks the forecast counts, and their hours with the buffer', () => {
    const settings = settingsWith({ buffer: 1.5 })
    const result = projectTasks(thesis, tasks, prioritiesOf(tasks, [thesis], settings))
    expect(result).toMatchObject({ projectId: 'p', name: 'Thesis', openCount: 5, totalHours: 1.5 * (2 + 0.5 + 1.5 + 1 + 1) })
  })

  it('has no groups for a project with no open tasks', () => {
    const empty = project('e', { taskIds: ['done'] })
    expect(projectTasks(empty, tasks, prioritiesOf(tasks, [empty]))).toEqual({ projectId: 'e', name: 'Project e', groups: [], openCount: 0, totalHours: 0 })
  })
})

describe('lookupProject', () => {
  const tasks = [task('a', { effortMinutes: 60 }), task('b', { effortMinutes: 120 })]
  const projects = [
    project('thesis', { name: 'Thesis', taskIds: ['a'] }),
    project('defence', { name: 'Thesis defence', taskIds: ['b'] }),
    project('garden', { name: 'Garden' }),
    project('old', { name: 'Old thesis', tagIds: [ARCHIVE_TAG_ID] }),
  ]
  const look = (query: string) => lookupProject(query, tasks, projects, prioritiesOf(tasks, projects))

  it('finds the one live project whose name contains the text, ignoring case and spaces around it', () => {
    expect(look('  DEFEN ')).toMatchObject({ kind: 'found', project: { projectId: 'defence', openCount: 1, totalHours: 2 } })
    expect(look('gar')).toMatchObject({ kind: 'found', project: { projectId: 'garden', openCount: 0 } })
  })

  it('lists every live match when there are several, leaving archived projects out', () => {
    expect(look('thesis')).toEqual({
      kind: 'several',
      projects: [
        { projectId: 'thesis', name: 'Thesis' },
        { projectId: 'defence', name: 'Thesis defence' },
      ],
    })
  })

  it('lists the live projects when nothing matches, and asks for text when there is none', () => {
    expect(look('old')).toEqual({ kind: 'none', projects: projects.slice(0, 3).map((p) => ({ projectId: p.id, name: p.name })) })
    expect(look('  ')).toEqual({ kind: 'blank' })
  })

  it('finds a live project by id, and nothing for one archived or deleted', () => {
    const priorities = prioritiesOf(tasks, projects)
    expect(projectTasksById('thesis', tasks, projects, priorities)).toMatchObject({ name: 'Thesis', openCount: 1 })
    expect(projectTasksById('old', tasks, projects, priorities)).toBeNull()
    expect(projectTasksById('gone', tasks, projects, priorities)).toBeNull()
  })
})

describe('lateTasks', () => {
  it('lists exactly the tasks the brief counts, hidden ones included, with deadline and finish', () => {
    const tasks = [
      task('late', { name: 'Late', dueDate: TUE, effortMinutes: hours(20) }),
      task('fine', { name: 'Fine', dueDate: NEXT_MON, effortMinutes: hours(1) }),
      task('hidden', { name: 'Hidden', startDate: FRI, dueDate: FRI, effortMinutes: hours(10) }),
    ]
    const result = forecastOf(tasks)
    const late = lateTasks(result)
    // In Suggested order, which the forecast's tasks keep
    expect(late.map((t) => t.taskId)).toEqual(result.tasks.filter((t) => ['late', 'hidden'].includes(t.taskId)).map((t) => t.taskId))
    expect(late).toContainEqual({ taskId: 'late', name: 'Late', deadline: TUE, finish: WED })
    expect(late).toContainEqual({ taskId: 'hidden', name: 'Hidden', deadline: FRI, finish: NEXT_MON })
    expect(late).toHaveLength(2)
    expect(result.brief.text).toContain('2 tasks are projected to finish after their deadline.')
  })

  it('has no finish for a task the forecast never finishes', () => {
    const result = forecastOf([task('a', { dueDate: TUE, effortMinutes: 60 })], [], settingsWith({ capacityMinutes: NO_CAPACITY }))
    expect(lateTasks(result)).toEqual([{ taskId: 'a', name: 'Task a', deadline: TUE, finish: null }])
  })

  it('is empty when nothing is late', () => {
    expect(lateTasks(forecastOf([task('a', { dueDate: TUE, effortMinutes: 60 })]))).toEqual([])
  })
})

describe('offTrackProjects', () => {
  const one = (effort: number, fields: Partial<Project> = {}, settings = settingsWith()) =>
    offTrackProjects(forecastOf([task('a', { effortMinutes: hours(effort) })], [project('p', { name: 'P', deliveryDate: FRI, taskIds: ['a'], ...fields })], settings))

  it('lists tight and behind projects with their finish and delivery date', () => {
    expect(one(48)).toEqual([{ projectId: 'p', name: 'P', pace: 'behind', finish: NEXT_MON, deliveryDate: FRI }])
    expect(one(32)).toEqual([{ projectId: 'p', name: 'P', pace: 'tight', finish: '2026-11-19', deliveryDate: FRI }])
  })

  it('lists a project with a delivery date whose open work never finishes', () => {
    expect(one(4, {}, settingsWith({ capacityMinutes: NO_CAPACITY }))).toEqual([{ projectId: 'p', name: 'P', pace: null, finish: null, deliveryDate: FRI }])
  })

  it('leaves out projects on pace, with no delivery date, no open work, or archived', () => {
    expect(one(4)).toEqual([])
    expect(one(48, { deliveryDate: null })).toEqual([])
    expect(one(48, { taskIds: [] })).toEqual([])
    expect(one(48, { tagIds: [ARCHIVE_TAG_ID] })).toEqual([])
    expect(one(4, { deliveryDate: null }, settingsWith({ capacityMinutes: NO_CAPACITY }))).toEqual([])
  })

  it('keeps the forecast’s order', () => {
    const tasks = [task('a', { effortMinutes: hours(30) }), task('b', { effortMinutes: hours(30) })]
    const projects = [project('p', { deliveryDate: FRI, taskIds: ['a'] }), project('q', { deliveryDate: WED, taskIds: ['b'] })]
    expect(offTrackProjects(forecastOf(tasks, projects)).map((p) => p.projectId)).toEqual(['p', 'q'])
  })
})

describe('quickWins', () => {
  it('lists the visible tasks counting for an hour or less, in Suggested order, with their total', () => {
    const tasks = [
      task('hour', { effortMinutes: 60 }),
      task('half', { effortMinutes: 30, dueDate: TUE }),
      task('long', { effortMinutes: 61 }),
      task('default', {}),
      task('hidden', { effortMinutes: 15, startDate: WED }),
    ]
    const wins = quickWins(prioritiesOf(tasks))
    expect(wins.tasks.map((t) => t.taskId)).toEqual(['half', 'hour'])
    expect(wins.totalHours).toBe(1.5)
  })

  it('counts the buffer, and leaves out tasks on the 2-hour default however small the buffer', () => {
    const tasks = [task('a', { effortMinutes: 45 }), task('b', { effortMinutes: 40 }), task('default', {})]
    expect(quickWins(prioritiesOf(tasks, [], settingsWith({ buffer: 1.5 }))).tasks.map((t) => t.taskId)).toEqual(['b'])
    expect(quickWins(prioritiesOf(tasks, [], settingsWith({ buffer: 0.25 }))).tasks.map((t) => t.taskId).sort()).toEqual(['a', 'b'])
  })

  it('is empty with no quick wins', () => {
    expect(quickWins(prioritiesOf([task('a', {})]))).toEqual({ tasks: [], totalHours: 0 })
  })
})
