// Project data model. Like Task, every field is a plain JSON value so a Project
// can be saved with JSON.stringify and loaded with JSON.parse.
import { ARCHIVE_TAG_ID } from './tag'
import type { Priority, Task } from './task'

export interface ReferenceLink {
  label: string // e.g. "GitHub repo"
  url: string
}

export interface Project {
  id: string
  name: string
  description: string
  deliveryDate: string | null // ISO 8601 date, e.g. "2026-10-25"
  taskIds: string[] // ids of existing Task objects
  priority: Priority
  links: ReferenceLink[]
  tagIds: string[] // ids of existing Tag objects
}

export interface CompletionStatus {
  completed: number
  total: number
}

export function createEmptyProject(): Project {
  return {
    id: crypto.randomUUID(),
    name: '',
    description: '',
    deliveryDate: null,
    taskIds: [],
    priority: 'medium',
    links: [],
    tagIds: [],
  }
}

export const isArchived = (project: Project) => project.tagIds.includes(ARCHIVE_TAG_ID)

// Whether a task due on dueDate would be due after its project's delivery date. Only checked
// once both dates are set.
export const isPastDeadline = (dueDate: string | null, deliveryDate: string | null) =>
  dueDate !== null && deliveryDate !== null && dueDate > deliveryDate

// Whether the project has tasks and every one of them is completed
export function isCompleted(project: Project, tasks: Task[]) {
  const { completed, total } = completionStatus(project, tasks)
  return total > 0 && completed === total
}

// The tasks no project lists, live or archived: unfinished first, then soonest due, with
// undated ones last
export function unassignedTasks(tasks: Task[], projects: Project[]): Task[] {
  const assigned = new Set(projects.flatMap((p) => p.taskIds))
  return tasks
    .filter((t) => !assigned.has(t.id))
    .sort(
      (a, b) =>
        Number(a.completed) - Number(b.completed) ||
        (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31'),
    )
}

// Looks up the project's task ids in a list of tasks; ids with no matching task are skipped
export function resolveTasks(project: Project, tasks: Task[]): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  return project.taskIds.map((id) => byId.get(id)).filter((t): t is Task => t !== undefined)
}

// Derived from the tasks rather than stored, so it can't go out of date
export function completionStatus(project: Project, tasks: Task[]): CompletionStatus {
  const projectTasks = resolveTasks(project, tasks)
  return {
    completed: projectTasks.filter((t) => t.completed).length,
    total: projectTasks.length,
  }
}
