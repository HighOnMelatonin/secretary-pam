// Task data model. Every field is a plain JSON value (strings, numbers, arrays,
// null) so a Task can be saved with JSON.stringify and loaded with JSON.parse.

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
export type Priority = (typeof PRIORITIES)[number]

export const RELATION_TYPES = ['blocks', 'blocked_by', 'subtask_of', 'parent_of', 'related_to'] as const
export type RelationType = (typeof RELATION_TYPES)[number]

export interface TaskRelation {
  taskId: string // id of the other task
  type: RelationType // how this task relates to the other task
}

export interface Task {
  id: string
  name: string
  description: string
  dueDate: string | null // ISO 8601 date, e.g. "2026-10-25"
  relations: TaskRelation[]
  priority: Priority
  completed: boolean
}

export function createEmptyTask(): Task {
  return {
    id: crypto.randomUUID(),
    name: '',
    description: '',
    dueDate: null,
    relations: [],
    priority: 'medium',
    completed: false,
  }
}
