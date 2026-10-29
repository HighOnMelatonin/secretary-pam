// Rules shared by the front end and the Worker. Pure functions over plain data only:
// no Vue, no browser APIs and relative imports only, since worker/ imports this file too.
import { isArchived, isCompleted, isPastDeadline, type Project } from './project'
import type { Task } from './task'

// A task in a project that is due after the project's delivery date
export interface Clash {
  taskId: string
  projectId: string
  dueDate: string
  deliveryDate: string
}

export interface Snapshot {
  projects: Project[]
  tasks: Task[]
}

// Every task that is due after the delivery date of a project it's in. Only counted once both
// dates are set.
export function findClashes(tasks: Task[], projects: Project[]): Clash[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  return projects.flatMap((project) =>
    project.taskIds.flatMap((taskId) => {
      const dueDate = byId.get(taskId)?.dueDate ?? null
      const deliveryDate = project.deliveryDate
      return isPastDeadline(dueDate, deliveryDate)
        ? [{ taskId, projectId: project.id, dueDate: dueDate!, deliveryDate: deliveryDate! }]
        : []
    }),
  )
}

// Puts the task in exactly the given projects, returning only the projects that change: the
// task goes at the end of the projects it's added to and is dropped from the ones it leaves
export function applyMembership(projects: Project[], taskId: string, projectIds: string[]): Project[] {
  return projects
    .filter((p) => p.taskIds.includes(taskId) !== projectIds.includes(p.id))
    .map((p) => ({
      ...p,
      taskIds: projectIds.includes(p.id) ? [...p.taskIds, taskId] : p.taskIds.filter((id) => id !== taskId),
    }))
}

// Ids of the projects a change completed, which should now be archived. Only projects that
// weren't completed before count, so one taken out of the archive stays out. A project that
// didn't exist before counts as not completed.
export function projectsToArchive(before: Snapshot, after: Snapshot): string[] {
  const completedBefore = new Set(before.projects.filter((p) => isCompleted(p, before.tasks)).map((p) => p.id))
  return after.projects
    .filter((p) => !completedBefore.has(p.id) && !isArchived(p) && isCompleted(p, after.tasks))
    .map((p) => p.id)
}
