import type { Changes } from '@/types/operations'
import { useProjectList } from './projectList'
import { useTaskList } from './taskList'

// Puts what a save changed (as the Worker returns it) into the stores: each task and project
// replaces the one with the same id, or is added at the end
export function applyChanges(changes: Changes) {
  const taskList = useTaskList()
  const projectList = useProjectList()
  for (const task of changes.tasks) upsert(taskList.tasks, task)
  for (const project of changes.projects) upsert(projectList.projects, project)
}

function upsert<T extends { id: string }>(items: T[], item: T) {
  const index = items.findIndex((i) => i.id === item.id)
  if (index === -1) items.push(item)
  else items[index] = item
}
