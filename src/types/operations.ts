// What a save writes, worked out up front so the Worker and the client test fake agree on it.
// Pure functions over plain data only: no I/O, no Vue and relative imports only, since worker/
// imports this file too.
import type { Project } from './project'
import { applyMembership, findClashes, projectsToArchive, type Clash } from './rules'
import { ARCHIVE_TAG_ID } from './tag'
import type { Task } from './task'

export interface State {
  tasks: Task[]
  projects: Project[]
}

// Every entity whose stored value changes
export interface Changes {
  tasks: Task[]
  projects: Project[]
}

export type Plan = { ok: true; changes: Changes } | { ok: false; clashes: Clash[] }

export interface TaskSave {
  task: Task
  projectIds?: string[] // the projects the task should be in; omitted leaves membership as is
  deliveryDates?: Record<string, string | null> // project id to its new delivery date
}

export interface ProjectSave {
  project: Project // its taskIds is the membership
  dueDates?: Record<string, string | null> // task id to its new due date
}

// A save named a task or project that doesn't exist
export class UnknownReference extends Error {
  readonly kind: 'task' | 'project'
  readonly id: string

  constructor(kind: 'task' | 'project', id: string) {
    super(`Unknown ${kind}: ${id}`)
    this.name = 'UnknownReference'
    this.kind = kind
    this.id = id
  }
}

export function planTaskSave(state: State, { task, projectIds, deliveryDates = {} }: TaskSave): Plan {
  checkKnown('project', state.projects, [...(projectIds ?? []), ...Object.keys(deliveryDates)])
  const moved = projectIds ? applyMembership(state.projects, task.id, projectIds) : []
  const after = {
    tasks: upsert(state.tasks, task),
    projects: withDates(replaceAll(state.projects, moved), 'deliveryDate', deliveryDates),
  }
  return finish(state, after, { tasks: [task], projects: [] })
}

export function planProjectSave(state: State, { project, dueDates = {} }: ProjectSave): Plan {
  checkKnown('task', state.tasks, Object.keys(dueDates))
  const after = {
    tasks: withDates(state.tasks, 'dueDate', dueDates),
    projects: upsert(state.projects, project),
  }
  return finish(state, after, { tasks: [], projects: [project] })
}

// Steps shared by every save once the change is applied: refuse new clashes, archive the
// projects the change completed, and collect what differs from before. The saved entity is
// always in the changes; anything else only when it was replaced along the way, since every
// step keeps the original object for an entity it leaves alone.
function finish(before: State, after: State, saved: Changes): Plan {
  const clashes = touchedClashes(before, after)
  if (clashes.length > 0) return { ok: false, clashes }

  const toArchive = new Set(projectsToArchive(before, after))
  const projects = after.projects.map((p) => (toArchive.has(p.id) ? { ...p, tagIds: [...p.tagIds, ARCHIVE_TAG_ID] } : p))

  const savedIds = new Set([...saved.tasks, ...saved.projects].map((e) => e.id))
  const differs = <T extends { id: string }>(items: T[], original: T[]) =>
    items.filter((item) => savedIds.has(item.id) || !original.includes(item))
  return { ok: true, changes: { tasks: differs(after.tasks, before.tasks), projects: differs(projects, before.projects) } }
}

// The clashes this change is responsible for: on a task-project pair that's new, or whose due
// date or delivery date moved. Clashes already in the stored data are left alone, so that a save
// which doesn't touch them, such as ticking a task off, still goes through.
function touchedClashes(before: State, after: State): Clash[] {
  const pairs = new Set(before.projects.flatMap((p) => p.taskIds.map((taskId) => `${p.id}/${taskId}`)))
  const dueDates = new Map(before.tasks.map((t) => [t.id, t.dueDate]))
  const deliveryDates = new Map(before.projects.map((p) => [p.id, p.deliveryDate]))
  return findClashes(after.tasks, after.projects).filter(
    (c) =>
      !pairs.has(`${c.projectId}/${c.taskId}`) ||
      dueDates.get(c.taskId) !== c.dueDate ||
      deliveryDates.get(c.projectId) !== c.deliveryDate,
  )
}

function checkKnown(kind: 'task' | 'project', items: { id: string }[], ids: string[]) {
  const known = new Set(items.map((item) => item.id))
  const unknown = ids.find((id) => !known.has(id))
  if (unknown !== undefined) throw new UnknownReference(kind, unknown)
}

// Replaces the item with the same id where it is, or adds it at the end
function upsert<T extends { id: string }>(items: T[], item: T): T[] {
  return items.some((i) => i.id === item.id) ? replaceAll(items, [item]) : [...items, item]
}

function replaceAll<T extends { id: string }>(items: T[], replacements: T[]): T[] {
  const byId = new Map(replacements.map((r) => [r.id, r]))
  return items.map((i) => byId.get(i.id) ?? i)
}

// Sets the date field of the items named in dates, keeping the original object when the date
// is already right
function withDates<K extends 'dueDate' | 'deliveryDate', T extends { id: string } & Record<K, string | null>>(
  items: T[],
  field: K,
  dates: Record<string, string | null>,
): T[] {
  const byId = new Map(Object.entries(dates))
  return items.map((item) => {
    const date = byId.get(item.id)
    return date === undefined || item[field] === date ? item : { ...item, [field]: date }
  })
}
