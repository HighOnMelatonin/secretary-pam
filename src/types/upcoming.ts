// Which tasks are coming up, across every project: the list in the panel on the right of the
// dashboard. Kept apart from the component so other summaries of the day can use it too.
import { isArchived, type Project } from './project'
import { PRIORITIES, type Task } from './task'

// How far ahead "upcoming" looks, in days from today
export const UPCOMING_DAYS = 14

export interface UpcomingTask {
  task: Task
  projects: Project[] // the live projects the task is in; empty for a task in no project
}

export interface Upcoming {
  overdue: UpcomingTask[] // due before today
  upcoming: UpcomingTask[] // due today or within UPCOMING_DAYS of it
}

// The YYYY-MM-DD date `days` after `date`, counted in calendar days
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10)
}

// Soonest first, then most urgent, then by name
const bySoonest = (a: UpcomingTask, b: UpcomingTask) =>
  a.task.dueDate!.localeCompare(b.task.dueDate!) ||
  PRIORITIES.indexOf(b.task.priority) - PRIORITIES.indexOf(a.task.priority) ||
  a.task.name.localeCompare(b.task.name)

// Unfinished tasks with a due date up to UPCOMING_DAYS from `today` (YYYY-MM-DD), split into
// overdue and upcoming. Tasks with no due date are left out, and so are tasks whose only
// projects are archived, since those are done with.
export function upcomingTasks(tasks: Task[], projects: Project[], today: string): Upcoming {
  const until = addDays(today, UPCOMING_DAYS)
  const result: Upcoming = { overdue: [], upcoming: [] }

  for (const task of tasks) {
    if (task.completed || task.dueDate === null || task.dueDate > until) continue
    const inProjects = projects.filter((p) => p.taskIds.includes(task.id))
    const live = inProjects.filter((p) => !isArchived(p))
    if (inProjects.length > 0 && live.length === 0) continue
    result[task.dueDate < today ? 'overdue' : 'upcoming'].push({ task, projects: live })
  }

  result.overdue.sort(bySoonest)
  result.upcoming.sort(bySoonest)
  return result
}
