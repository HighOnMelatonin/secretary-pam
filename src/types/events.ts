// Change tracking: the append-only log in task_events (migrations/0007_task_events.sql) that how
// well projects were scoped can be worked out from later. What a save logs is worked out from the
// data before and after it, so the Worker and the client test fake log the same events.
// Pure functions over plain data only: no I/O, no Vue and relative imports only, since worker/
// imports this file too.
import type { Snapshot } from './rules'
import type { Task } from './task'

export const EVENT_KINDS = [
  'task_created',
  'task_added_to_project',
  'task_removed_from_project',
  'due_date_changed',
  'delivery_date_changed',
  'task_completed',
  'task_reopened',
  'task_deleted',
  'project_created',
  'project_deleted',
] as const
export type EventKind = (typeof EVENT_KINDS)[number]

// Who made the change: the user in the app, a Google Calendar sync, or the migration that logged
// the data from before tracking began, whose times and order are only a guess
export type EventSource = 'app' | 'google' | 'backfill'
// Where the task itself came from, so app changes to imported tasks can be told apart
export type TaskSource = 'app' | 'google'

// One change. When it happened is added on writing, so planning stays free of the clock.
//
// An event about a task (created aside) is logged once for each project the task is in, with that
// project's delivery date at the time, or once with no project when it is in none. A task is
// created before it joins any project, so task_created always has no project.
export interface TaskEvent {
  kind: EventKind
  taskId: string | null // null for project_created, project_deleted and delivery_date_changed
  projectId: string | null
  // The date before and after for due_date_changed and delivery_date_changed, and the first due or
  // delivery date as newValue for task_created and project_created. null otherwise.
  oldValue: string | null
  newValue: string | null
  deliveryDateAtTime: string | null // the project's delivery date once the change is made
  source: EventSource
  taskSource: TaskSource | null // null for events about a project
}

// An event as stored, and as GET /api/events lists it
export interface LoggedEvent extends TaskEvent {
  id: number // increases with every event logged, so it orders events logged at the same moment
  at: string // UTC timestamp, e.g. "2026-10-25T15:08:26.123Z"
}

// A project a task is in, as far as its events need it
export interface ProjectDate {
  id: string
  deliveryDate: string | null
}

export function newEvent(kind: EventKind, source: EventSource, fields: Partial<TaskEvent> = {}): TaskEvent {
  return {
    kind,
    taskId: null,
    projectId: null,
    oldValue: null,
    newValue: null,
    deliveryDateAtTime: null,
    source,
    taskSource: null,
    ...fields,
  }
}

// The event once for each of the task's projects, or as it is when the task is in none
export const forEachProject = (event: TaskEvent, projects: ProjectDate[]): TaskEvent[] =>
  projects.length === 0
    ? [event]
    : projects.map((p) => ({ ...event, projectId: p.id, deliveryDateAtTime: p.deliveryDate }))

export const taskSourceOf = (task: Task): TaskSource => (task.googleAccount ? 'google' : 'app')

// What changed between two snapshots, in the order it is logged: created, date and deletion events
// first, then each project's removals and additions, then due dates and completion. Only real
// changes count: a save that changes nothing, or only fields that aren't tracked (names, tags,
// the order of a project's tasks), logs nothing.
export function diffEvents(before: Snapshot, after: Snapshot, source: EventSource): TaskEvent[] {
  const tasksBefore = new Map(before.tasks.map((t) => [t.id, t]))
  const tasksAfter = new Map(after.tasks.map((t) => [t.id, t]))
  const projectsBefore = new Map(before.projects.map((p) => [p.id, p]))
  const projectsAfter = new Map(after.projects.map((p) => [p.id, p]))
  const projectsOf = (taskId: string, snapshot: Snapshot) => snapshot.projects.filter((p) => p.taskIds.includes(taskId))
  const taskEvent = (kind: EventKind, task: Task, fields: Partial<TaskEvent> = {}) =>
    newEvent(kind, source, { taskId: task.id, taskSource: taskSourceOf(task), ...fields })

  const events: TaskEvent[] = []
  for (const project of after.projects) {
    const old = projectsBefore.get(project.id)
    if (!old) {
      events.push(
        newEvent('project_created', source, {
          projectId: project.id,
          newValue: project.deliveryDate,
          deliveryDateAtTime: project.deliveryDate,
        }),
      )
    } else if (old.deliveryDate !== project.deliveryDate) {
      events.push(
        newEvent('delivery_date_changed', source, {
          projectId: project.id,
          oldValue: old.deliveryDate,
          newValue: project.deliveryDate,
          deliveryDateAtTime: project.deliveryDate,
        }),
      )
    }
  }
  for (const task of after.tasks) {
    if (!tasksBefore.has(task.id)) events.push(taskEvent('task_created', task, { newValue: task.dueDate }))
  }
  for (const project of before.projects) {
    if (!projectsAfter.has(project.id)) {
      events.push(newEvent('project_deleted', source, { projectId: project.id, deliveryDateAtTime: project.deliveryDate }))
    }
  }
  for (const task of before.tasks) {
    if (!tasksAfter.has(task.id)) events.push(...forEachProject(taskEvent('task_deleted', task), projectsOf(task.id, before)))
  }

  // Membership, from each project's taskIds, whichever side of the save changed it. A project
  // that was deleted loses all its tasks.
  for (const project of [...after.projects, ...before.projects.filter((p) => !projectsAfter.has(p.id))]) {
    const was = projectsBefore.get(project.id)?.taskIds ?? []
    const is = projectsAfter.get(project.id)?.taskIds ?? []
    const membership = (kind: EventKind, taskId: string) => {
      const task = tasksAfter.get(taskId) ?? tasksBefore.get(taskId)
      if (task) events.push(taskEvent(kind, task, { projectId: project.id, deliveryDateAtTime: project.deliveryDate }))
    }
    for (const taskId of was) if (!is.includes(taskId)) membership('task_removed_from_project', taskId)
    for (const taskId of is) if (!was.includes(taskId)) membership('task_added_to_project', taskId)
  }

  for (const task of after.tasks) {
    const old = tasksBefore.get(task.id)
    const projects = projectsOf(task.id, after)
    if (old && old.dueDate !== task.dueDate) {
      events.push(...forEachProject(taskEvent('due_date_changed', task, { oldValue: old.dueDate, newValue: task.dueDate }), projects))
    }
    // A task created already done counts as completed when it was created
    if ((old?.completed ?? false) !== task.completed) {
      events.push(...forEachProject(taskEvent(task.completed ? 'task_completed' : 'task_reopened', task), projects))
    }
  }
  return events
}

// How long after a project is created a task can join it and still count as planned rather than
// added later. A tunable heuristic, not a recorded fact: nothing stores which tasks were planned,
// so changing this reclassifies all of the history.
export const PLANNING_WINDOW_HOURS = 24

// Whether the task was part of the project's plan: its first addition to the project came within
// windowHours of the project being created. undefined when that can't be told: the project's
// creation wasn't logged (it is from before tracking began, so only backfilled events have it), or
// the task was never added to it. Events can be in any order.
export function isPlanned(
  events: LoggedEvent[],
  projectId: string,
  taskId: string,
  windowHours = PLANNING_WINDOW_HOURS,
): boolean | undefined {
  const created = events.find((e) => e.kind === 'project_created' && e.projectId === projectId && e.source !== 'backfill')
  const added = events
    .filter((e) => e.kind === 'task_added_to_project' && e.projectId === projectId && e.taskId === taskId)
    .map((e) => Date.parse(e.at))
  if (!created || added.length === 0) return undefined
  return Math.min(...added) - Date.parse(created.at) <= windowHours * 60 * 60 * 1000
}
