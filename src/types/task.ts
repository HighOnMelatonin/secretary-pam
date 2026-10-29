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

// The same relation read from the other task's side, e.g. A blocks B means B is blocked by A
const INVERSE: Record<RelationType, RelationType> = {
  blocks: 'blocked_by',
  blocked_by: 'blocks',
  subtask_of: 'parent_of',
  parent_of: 'subtask_of',
  related_to: 'related_to',
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

export interface RelatedTask {
  type: RelationType // how `task` relates to the other task
  task: Task // the other task
}

// The task's own relations, plus the ones other tasks record with it turned round to read from
// this task, since a relation is only stored on the task it was added to. Each pairing appears
// once, and relations to tasks that no longer exist are skipped.
export function relatedTasks(task: Task, tasks: Task[]): RelatedTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const found = new Map<string, RelatedTask>()
  const add = (type: RelationType, other: Task | undefined) => {
    if (other && other.id !== task.id) found.set(`${type}:${other.id}`, { type, task: other })
  }
  for (const relation of task.relations) add(relation.type, byId.get(relation.taskId))
  for (const other of tasks) {
    for (const relation of other.relations) {
      if (relation.taskId === task.id) add(INVERSE[relation.type], other)
    }
  }
  return [...found.values()]
}

// "blocked_by" reads as "blocked by"
export const relationLabel = (type: RelationType) => type.replace('_', ' ')

// The tasks whose name contains the query, ignoring case and the spaces around it, for the task
// lookup. Unfinished ones come first, then by name. A blank query finds nothing.
export function findTasks(tasks: Task[], query: string): Task[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  return tasks
    .filter((t) => t.name.toLowerCase().includes(needle))
    .sort((a, b) => Number(a.completed) - Number(b.completed) || a.name.localeCompare(b.name))
}
