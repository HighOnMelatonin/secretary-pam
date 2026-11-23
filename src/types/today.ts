// The Today list, a view of the Upcoming panel: the project tasks pinned to today with "Do today",
// then today's errands, rolled-over ones included (src/types/errand.ts). It can be narrowed to what
// is in no project: the errands, and pinned tasks in no project. Pure functions over plain data,
// with `today` passed in and nothing stored.
import { errandDays, isOnToday } from './errand'
import { isArchived, type Project } from './project'
import type { Task } from './task'

export interface TodayItem {
  task: Task
  projects: Project[] // the live projects a pinned task is in; always empty for an errand
  carriedDays: number // how many days an errand has rolled over by; 0 for a pinned task
  overdue: boolean // its due date has passed
}

export function todayItems(tasks: Task[], projects: Project[], today: string): TodayItem[] {
  const pinned = tasks
    .filter((t) => t.kind !== 'errand' && isOnToday(t, today))
    .flatMap((task): TodayItem[] => {
      const inProjects = projects.filter((p) => p.taskIds.includes(task.id))
      const live = inProjects.filter((p) => !isArchived(p))
      // A task only in archived projects is done with, as in Upcoming
      if (inProjects.length > 0 && live.length === 0) return []
      return [{ task, projects: live, carriedDays: 0, overdue: task.dueDate !== null && task.dueDate < today }]
    })
    .sort((a, b) => a.task.name.localeCompare(b.task.name))
  const errands = errandDays(tasks, today)
    .filter((d) => d.planned === today)
    .map((d): TodayItem => ({ task: d.task, projects: [], carriedDays: d.carriedDays, overdue: d.overdue }))
  return [...pinned, ...errands]
}

// For the "Not in a project" filter
export const inNoProject = (item: TodayItem) => item.projects.length === 0
