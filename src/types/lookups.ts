// Lookups over the prioritisation and the forecast (docs/telegram-bot.md, Stage 5): a project's
// open tasks, the tasks projected to finish late, the projects off track, and the quick wins.
// Pure functions over plain data only: no Vue, no browser APIs, no clock and relative imports
// only, since worker/ imports this file too. They take what prioritise() and forecast() return, so
// they never work anything out differently from them, and the result is plain JSON.
import type { Forecast, Pace } from './forecast'
import { CATEGORIES, CATEGORY_LABELS, round4, type Category, type HiddenBecause, type Priorities, type ScoredTask } from './priority'
import { isArchived, resolveTasks, type Project } from './project'
import type { Task } from './task'

// The tasks the Suggested list shows, in its order: Overdue, Do nowww, then Do next
export function visibleTasks(priorities: Priorities): ScoredTask[] {
  const byId = new Map(priorities.tasks.map((t) => [t.taskId, t]))
  return CATEGORIES.flatMap((c) => priorities.sections[c]).map((id) => byId.get(id)!)
}

// A project's tasks

// The Suggested categories, then the hidden tasks by why they're hidden, then the open tasks
// prioritising leaves out (imported from Google Calendar with no estimate), which have no hours
export const TASK_GROUPS = [...CATEGORIES, 'blocked', 'not_started', 'not_counted'] as const
export type TaskGroup = Category | HiddenBecause | 'not_counted'
export const TASK_GROUP_LABELS: Record<TaskGroup, string> = {
  ...CATEGORY_LABELS,
  blocked: 'Waiting on other tasks',
  not_started: 'Not started yet',
  not_counted: 'Not counted (from Google Calendar, no estimate)',
}

export interface LookupTask {
  taskId: string
  name: string
  hours: number | null // the hours the forecast counts (estimate x buffer); null when not counted
  unestimated: boolean // its hours are the 2-hour default
}

export interface ProjectTasks {
  projectId: string
  name: string
  groups: { group: TaskGroup; tasks: LookupTask[] }[] // in TASK_GROUPS order, only those with tasks
  openCount: number // the open tasks the forecast counts, so not those in not_counted
  totalHours: number // their hours
}

export interface ProjectName {
  projectId: string
  name: string
}

export type ProjectLookup =
  | { kind: 'found'; project: ProjectTasks }
  | { kind: 'several'; projects: ProjectName[] } // the live projects whose names contain the text
  | { kind: 'none'; projects: ProjectName[] } // every live project
  | { kind: 'blank' } // no text to look for

const nameOf = (p: Project): ProjectName => ({ projectId: p.id, name: p.name })

// The project's open tasks, grouped. Within a group they're in Suggested order; the uncounted ones
// keep the project's order.
export function projectTasks(project: Project, tasks: Task[], priorities: Priorities): ProjectTasks {
  const scored = new Map(priorities.tasks.map((t, i) => [t.taskId, { task: t, rank: i }]))
  const open = resolveTasks(project, tasks).filter((t) => !t.completed)
  const counted = open
    .map((t) => scored.get(t.id))
    .filter((s) => s !== undefined)
    .sort((a, b) => a.rank - b.rank)
    .map((s) => s.task)
  const notCounted = open.filter((t) => !scored.has(t.id))

  const groupOf = (t: ScoredTask): TaskGroup => t.hidden ?? t.category
  const toLookup = (t: ScoredTask): LookupTask => ({
    taskId: t.taskId,
    name: t.name,
    hours: t.factors.effortHours,
    unestimated: t.flags.unestimated,
  })
  const groups = TASK_GROUPS.map((group) => ({
    group,
    tasks:
      group === 'not_counted'
        ? notCounted.map((t) => ({ taskId: t.id, name: t.name, hours: null, unestimated: true }))
        : counted.filter((t) => groupOf(t) === group).map(toLookup),
  })).filter((g) => g.tasks.length > 0)

  return {
    projectId: project.id,
    name: project.name,
    groups,
    openCount: counted.length,
    totalHours: round4(counted.reduce((sum, t) => sum + t.factors.effortHours, 0)),
  }
}

// The live project whose name contains `query` (ignoring case and the spaces around it), with its
// open tasks; or every match when there are several, or every live project when none matches
export function lookupProject(query: string, tasks: Task[], projects: Project[], priorities: Priorities): ProjectLookup {
  const needle = query.trim().toLowerCase()
  if (!needle) return { kind: 'blank' }
  const live = projects.filter((p) => !isArchived(p))
  const matches = live.filter((p) => p.name.toLowerCase().includes(needle))
  if (matches.length === 1) return { kind: 'found', project: projectTasks(matches[0]!, tasks, priorities) }
  if (matches.length > 1) return { kind: 'several', projects: matches.map(nameOf) }
  return { kind: 'none', projects: live.map(nameOf) }
}

// One live project's open tasks, by id (as a button under a "several" reply asks for); null when
// it's been deleted or archived since
export function projectTasksById(projectId: string, tasks: Task[], projects: Project[], priorities: Priorities): ProjectTasks | null {
  const project = projects.find((p) => p.id === projectId)
  return project && !isArchived(project) ? projectTasks(project, tasks, priorities) : null
}

// Late tasks

export interface LateTask {
  taskId: string
  name: string
  deadline: string // its effective deadline
  finish: string | null // its projected finish; null when the forecast never finishes it
}

// The tasks the forecast projects to finish after their effective deadline, in Suggested order.
// The same tasks the brief counts, hidden ones included.
export function lateTasks(forecast: Forecast): LateTask[] {
  return forecast.tasks
    .filter((t) => t.late)
    .map((t) => ({ taskId: t.taskId, name: t.name, deadline: t.deadline!, finish: t.finish }))
}

// Projects off track

export interface OffTrackProject {
  projectId: string
  name: string
  pace: Exclude<Pace, 'on_pace'> | null // null when the forecast never finishes its open work
  finish: string | null
  deliveryDate: string
}

// The live projects that are tight or behind, and those with a delivery date and open work that
// the forecast never finishes, in the order the forecast has them. Projects with no delivery date
// or no open work have no pace, and are left out.
export function offTrackProjects(forecast: Forecast): OffTrackProject[] {
  return forecast.projects.flatMap((p) => {
    if (p.deliveryDate === null) return []
    const neverFinishes = p.finish === null && p.openHours > 0
    if (p.pace !== 'tight' && p.pace !== 'behind' && !neverFinishes) return []
    return [{ projectId: p.projectId, name: p.name, pace: neverFinishes ? null : (p.pace as 'tight' | 'behind'), finish: p.finish, deliveryDate: p.deliveryDate }]
  })
}

// Quick wins

// The most hours a quick win can count for, buffer included
export const QUICK_WIN_HOURS = 1

export interface QuickWins {
  tasks: ScoredTask[]
  totalHours: number
}

// The tasks the Suggested list shows that count for QUICK_WIN_HOURS or less, in its order. Tasks
// with no estimate are left out, since their hours are only the 2-hour default.
export function quickWins(priorities: Priorities): QuickWins {
  const found = visibleTasks(priorities).filter((t) => !t.flags.unestimated && t.factors.effortHours <= QUICK_WIN_HOURS)
  return { tasks: found, totalHours: round4(found.reduce((sum, t) => sum + t.factors.effortHours, 0)) }
}
