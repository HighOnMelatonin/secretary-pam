// Project data model. Like Task, every field is a plain JSON value so a Project
// can be saved with JSON.stringify and loaded with JSON.parse.
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
  }
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
