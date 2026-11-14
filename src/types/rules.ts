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

// Whether the task's start date is after its due date, which a task save may not do. Only checked
// once both are set.
export const startsAfterDue = (task: Pick<Task, 'startDate' | 'dueDate'>) =>
  task.startDate !== undefined && task.dueDate !== null && task.startDate > task.dueDate

// The task with its start date moved back to its due date if it was after it, for saves that move
// a due date without showing the start date (a project save's dueDates, an import, a sync). The
// same object when nothing changes.
export const clampStartDate = <T extends Pick<Task, 'startDate' | 'dueDate'>>(task: T): T =>
  startsAfterDue(task) ? { ...task, startDate: task.dueDate! } : task

// Why "Not today" (start the task tomorrow) can't be used on a task, or null if it can: a task due
// today or earlier can't start after its due date
export function notTodayRefusal(task: Pick<Task, 'dueDate'>, today: string): 'due_today' | 'overdue' | null {
  if (task.dueDate === null || task.dueDate > today) return null
  return task.dueDate === today ? 'due_today' : 'overdue'
}

export const NOT_TODAY_REFUSALS = {
  due_today: "It's due today, so it can't wait until tomorrow",
  overdue: "It's overdue, so it can't wait until tomorrow",
} as const

// Blocking loops

type Related = Pick<Task, 'id' | 'relations'>

// Who blocks whom, from both sides: "A blocks B" is stored on A, and "B blocked by A" on B, and
// both mean the edge A -> B. Relations to tasks that aren't in the list are skipped. Each task's
// edges are in the order they're first found, so the results below don't depend on chance.
export function blockEdges(tasks: Related[]): Map<string, string[]> {
  const known = new Set(tasks.map((t) => t.id))
  const edges = new Map<string, string[]>(tasks.map((t) => [t.id, []]))
  const add = (from: string, to: string) => {
    if (from === to || !known.has(from) || !known.has(to)) return
    const list = edges.get(from)!
    if (!list.includes(to)) list.push(to)
  }
  for (const task of tasks) {
    for (const r of task.relations) {
      if (r.type === 'blocks') add(task.id, r.taskId)
      if (r.type === 'blocked_by') add(r.taskId, task.id)
    }
  }
  return edges
}

// A loop of blocking tasks in `tasks` that uses at least one edge `before` doesn't have, as the
// ids around it, starting from that edge: [A, B, C] means A blocks B, B blocks C and C blocks A.
// With no `before`, every edge is new, so it finds any loop. Null when there is none. A save
// passes the tasks before and after it, so loops already in the stored data don't stop it.
export function findBlockCycle(tasks: Related[], before: Related[] = []): string[] | null {
  const edges = blockEdges(tasks)
  const old = blockEdges(before)
  for (const [from, targets] of edges) {
    for (const to of targets) {
      if (old.get(from)?.includes(to)) continue
      const path = shortestPath(edges, to, from)
      if (path) return [from, ...path.slice(0, -1)]
    }
  }
  return null
}

// Every group of tasks caught in blocking loops: each group is the tasks that can all reach one
// another through "blocks" (a strongly connected component of two or more). Groups come in the
// order their first task is listed, with their tasks in list order. Worked out without recursion
// (Tarjan's algorithm with an explicit stack), so a long chain can't overflow the call stack.
export function blockLoops(tasks: Related[]): string[][] {
  const edges = blockEdges(tasks)
  const position = new Map(tasks.map((t, i) => [t.id, i]))
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const groups: string[][] = []
  let next = 0

  for (const root of edges.keys()) {
    if (index.has(root)) continue
    const work: { id: string; child: number }[] = [{ id: root, child: 0 }]
    index.set(root, next)
    low.set(root, next++)
    stack.push(root)
    onStack.add(root)
    while (work.length) {
      const frame = work[work.length - 1]!
      const children = edges.get(frame.id)!
      if (frame.child < children.length) {
        const child = children[frame.child++]!
        if (!index.has(child)) {
          index.set(child, next)
          low.set(child, next++)
          stack.push(child)
          onStack.add(child)
          work.push({ id: child, child: 0 })
        } else if (onStack.has(child)) {
          low.set(frame.id, Math.min(low.get(frame.id)!, index.get(child)!))
        }
        continue
      }
      work.pop()
      const parent = work[work.length - 1]
      if (parent) low.set(parent.id, Math.min(low.get(parent.id)!, low.get(frame.id)!))
      if (low.get(frame.id) === index.get(frame.id)) {
        const group: string[] = []
        let id: string
        do {
          id = stack.pop()!
          onStack.delete(id)
          group.push(id)
        } while (id !== frame.id)
        if (group.length > 1) groups.push(group.sort((a, b) => position.get(a)! - position.get(b)!))
      }
    }
  }
  return groups.sort((a, b) => position.get(a[0]!)! - position.get(b[0]!)!)
}

// The shortest list of ids from `start` to `goal` along the edges, both ends included
function shortestPath(edges: Map<string, string[]>, start: string, goal: string): string[] | null {
  const cameFrom = new Map<string, string | null>([[start, null]])
  const queue = [start]
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i]!
    if (at === goal) {
      const path = [at]
      for (let step = cameFrom.get(at); step != null; step = cameFrom.get(step)) path.unshift(step)
      return path
    }
    for (const next of edges.get(at) ?? []) {
      if (!cameFrom.has(next)) {
        cameFrom.set(next, at)
        queue.push(next)
      }
    }
  }
  return null
}

// e.g. "A" blocks "B", which blocks "C", which blocks "A"
export function describeLoop(loop: string[], nameOf: (id: string) => string): string {
  const names = [...loop, loop[0]!].map((id) => `"${nameOf(id)}"`)
  return names.slice(1).reduce((text, name, i) => `${text}${i === 0 ? ' blocks ' : ', which blocks '}${name}`, names[0]!)
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
