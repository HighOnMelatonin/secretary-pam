// Builders for test data, with every field filled so tests only state what matters to them
import type { Project } from '../../src/types/project'
import type { Tag } from '../../src/types/tag'
import type { Task } from '../../src/types/task'

export const task = (id: string, fields: Partial<Task> = {}): Task => ({
  id,
  name: `Task ${id}`,
  description: '',
  dueDate: null,
  relations: [],
  priority: 'medium',
  completed: false,
  ...fields,
})

export const project = (id: string, fields: Partial<Project> = {}): Project => ({
  id,
  name: `Project ${id}`,
  description: '',
  deliveryDate: null,
  taskIds: [],
  priority: 'medium',
  links: [],
  tagIds: [],
  ...fields,
})

export const tag = (id: string, name: string): Tag => ({ id, name })

// YYYY-MM-DD for a day relative to today, in local time like the app uses
export const daysFromToday = (days: number) => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toLocaleDateString('en-CA')
}
