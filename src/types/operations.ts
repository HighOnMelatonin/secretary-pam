// What a save writes, worked out up front so the Worker and the client test fake agree on it.
// Pure functions over plain data only: no I/O, no Vue and relative imports only, since worker/
// imports this file too.
import { diffEvents, type EventSource, type TaskEvent } from './events'
import type { Project } from './project'
import {
  applyMembership,
  clampStartDate,
  findBlockCycle,
  findClashes,
  NOT_TODAY_REFUSALS,
  notTodayRefusal,
  projectsToArchive,
  type Clash,
} from './rules'
import { ARCHIVE_TAG_ID } from './tag'
import type { Sentence } from './sentence'
import { isErrand, nextErrand } from './errand'
import { stepPriority, type ChecklistItem, type Task, type TaskKind } from './task'
import { addDays } from './upcoming'

export interface State {
  tasks: Task[]
  projects: Project[]
}

// Every entity whose stored value changes
export interface Changes {
  tasks: Task[]
  projects: Project[]
}

// events are what the save logs (src/types/events.ts), written with the changes
export type Plan = { ok: true; changes: Changes; events: TaskEvent[] } | { ok: false; clashes: Clash[] }

export interface TaskSave {
  task: Task
  projectIds?: string[] // the projects the task should be in; omitted leaves membership as is
  deliveryDates?: Record<string, string | null> // project id to its new delivery date
  // The user's local date, which only the client knows: an errand saved with no planned day is
  // planned for it
  today?: string
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

// A save would make a loop of blocking tasks: loop is the ids around it, as findBlockCycle
// (src/types/rules.ts) gives them
export class BlockLoop extends Error {
  readonly loop: string[]

  constructor(loop: string[]) {
    super(`Blocking loop: ${loop.join(' -> ')}`)
    this.name = 'BlockLoop'
    this.loop = loop
  }
}

// Why an errand can't be saved as it is: an errand is in no project, has no relations, always has a
// planned day, and isn't planned after it's due. Thrown, with the reason as a code and its values
// and in words for the user, much as a clash is reported.
export type ErrandRefusalCode = 'errand_in_project' | 'errand_related' | 'errand_unplanned' | 'errand_planned_after_due'

export class ErrandRefused extends Error {
  readonly sentence: Sentence

  constructor(code: ErrandRefusalCode, params: Sentence['params'], text: string) {
    super(text)
    this.name = 'ErrandRefused'
    this.sentence = { code, params, text }
  }
}

// `source` is who the events say made the change: the app unless the Telegram bot says otherwise.
//
// Completing a recurring errand also makes the next one (nextErrand in errand.ts), in the same
// save. The completed one remembers it as nextOccurrenceId, so reopening and completing it again
// makes no second one, and reopening it leaves the next one in place. `newId` makes the next one's
// id, and is only passed by tests.
export function planTaskSave(
  state: State,
  { task, projectIds, deliveryDates = {}, today }: TaskSave,
  source: EventSource = 'app',
  newId: () => string = () => crypto.randomUUID(),
): Plan {
  checkKnown('project', state.projects, [...(projectIds ?? []), ...Object.keys(deliveryDates)])
  const stored = state.tasks.find((t) => t.id === task.id)
  let saved = withErrandDefaults(task, stored, today)
  const next = repeats(saved, stored) ? nextErrand(saved, newId()) : null
  if (next) saved = { ...saved, nextOccurrenceId: next.id }
  const moved = projectIds ? applyMembership(state.projects, saved.id, projectIds) : []
  const after = {
    tasks: next ? [...upsert(state.tasks, saved), next] : upsert(state.tasks, saved),
    projects: withDates(replaceAll(state.projects, moved), 'deliveryDate', deliveryDates),
  }
  return finish(state, after, { tasks: next ? [saved, next] : [saved], projects: [] }, source)
}

// The task as it is saved. nextOccurrenceId is never sent, so the stored one is kept, and only an
// errand has one. An errand with no planned day is planned for `today`, and its priority stays at
// the default, since nothing ranks errands. A project task has no recurrence or checklist.
function withErrandDefaults(task: Task, stored: Task | undefined, today: string | undefined): Task {
  const saved: Task = { ...task }
  delete saved.nextOccurrenceId
  if (!isErrand(task)) {
    delete saved.kind
    delete saved.recurrence
    delete saved.checklist
    return saved
  }
  if (stored && isErrand(stored) && stored.nextOccurrenceId !== undefined) saved.nextOccurrenceId = stored.nextOccurrenceId
  if (saved.pinnedDate === undefined && today !== undefined) saved.pinnedDate = today
  saved.priority = 'medium'
  return saved
}

// Whether this save completes a recurring errand that hasn't made its next one yet
const repeats = (task: Task, stored: Task | undefined) =>
  isErrand(task) && task.completed && !stored?.completed && task.recurrence !== undefined && task.nextOccurrenceId === undefined

export function planProjectSave(state: State, { project, dueDates = {} }: ProjectSave): Plan {
  checkKnown('task', state.tasks, Object.keys(dueDates))
  const after = {
    // The project form doesn't show start dates, so one a moved due date passes moves back with it
    tasks: withDates(state.tasks, 'dueDate', dueDates).map(clampStartDate),
    projects: upsert(state.projects, project),
  }
  return finish(state, after, { tasks: [], projects: [project] })
}

// Tasks imported into a project at once (src/types/import.ts): each is created or updated, and
// those the project doesn't list yet are added at the end, in order
export interface TasksImport {
  tasks: Task[]
}

export function planTasksImport(state: State, projectId: string, imported: TasksImport): Plan {
  // An import doesn't show start dates, so one a due date from the file passes moves back with it
  const tasks = imported.tasks.map(clampStartDate)
  checkKnown('project', state.projects, [projectId])
  const project = state.projects.find((p) => p.id === projectId)!
  const joining = tasks.map((t) => t.id).filter((id) => !project.taskIds.includes(id))
  const withTasks = joining.length ? [{ ...project, taskIds: [...project.taskIds, ...joining] }] : []
  const after = {
    tasks: tasks.reduce((all, task) => upsert(all, task), state.tasks),
    projects: replaceAll(state.projects, withTasks),
  }
  return finish(state, after, { tasks, projects: withTasks })
}

// Quick actions on one task, from a row of the Suggested list and the voice front-end.
// Each changes only what it names, through POST /api/tasks/:id/action rather than a whole task
// save. `today` is the user's local date, which only the browser knows.
export type TaskAction =
  | { action: 'do_today'; today: string } // pin it to today
  | { action: 'unpin' }
  | { action: 'not_today'; today: string } // start it tomorrow
  | { action: 'importance'; direction: 'up' | 'down' } // its priority one level up or down
  | { action: 'estimate'; effortMinutes: number | null } // a new estimate, or none
  | { action: 'plan'; date: string } // plan an errand for another day (Today, Tomorrow, Pick date)

export const TASK_ACTIONS = ['do_today', 'unpin', 'not_today', 'importance', 'estimate', 'plan'] as const

// Why a quick action can't be done to the task as it is
export type RefusalCode = 'due_today' | 'overdue' | 'priority_at_top' | 'priority_at_bottom' | 'not_an_errand'

// A quick action that can't be done to the task as it is: why as a code with its values, and in
// words for the user (the message), like every other sentence the API returns
export class ActionRefused extends Error {
  readonly sentence: Sentence

  constructor(code: RefusalCode, params: Sentence['params'], text: string) {
    super(text)
    this.name = 'ActionRefused'
    this.sentence = { code, params, text }
  }
}

export function planTaskAction(state: State, taskId: string, action: TaskAction, source: EventSource = 'app'): Plan {
  checkKnown('task', state.tasks, [taskId])
  const task = state.tasks.find((t) => t.id === taskId)!
  return planTaskSave(state, { task: applyAction(task, action) }, source)
}

// The task without one of its optional fields, as a task that never had it
function without(task: Task, field: 'pinnedDate' | 'effortMinutes'): Task {
  const copy = { ...task }
  delete copy[field]
  return copy
}

function applyAction(task: Task, action: TaskAction): Task {
  switch (action.action) {
    case 'do_today':
      return { ...task, pinnedDate: action.today }
    case 'unpin':
      return without(task, 'pinnedDate')
    case 'not_today': {
      const refusal = notTodayRefusal(task, action.today)
      if (refusal) {
        const params = { taskId: task.id, task: task.name, dueDate: task.dueDate }
        throw new ActionRefused(refusal, params, `"${task.name}": ${NOT_TODAY_REFUSALS[refusal]}`)
      }
      // A pin to today goes with it, since the task now starts tomorrow
      const moved = { ...task, startDate: addDays(action.today, 1) }
      return moved.pinnedDate === action.today ? without(moved, 'pinnedDate') : moved
    }
    case 'importance': {
      const priority = stepPriority(task.priority, action.direction)
      if (!priority) {
        const code = action.direction === 'up' ? 'priority_at_top' : 'priority_at_bottom'
        const params = { taskId: task.id, task: task.name, priority: task.priority }
        throw new ActionRefused(code, params, `"${task.name}" is already ${task.priority} priority`)
      }
      return { ...task, priority }
    }
    case 'estimate':
      return action.effortMinutes === null ? without(task, 'effortMinutes') : { ...task, effortMinutes: action.effortMinutes }
    case 'plan':
      // A project task is pinned to today with Do today, and only ever to today
      if (!isErrand(task)) {
        throw new ActionRefused('not_an_errand', { taskId: task.id, task: task.name }, `"${task.name}" is a project task, not an errand`)
      }
      return { ...task, pinnedDate: action.date }
  }
}

// A partial task update (PATCH /api/tasks/:id): only the fields it names change. Null clears an
// optional field (the estimate, start date or pinned date) and the due date; a field left out keeps
// its stored value. The id and the Google account can't be changed this way.
export const PATCH_FIELDS = [
  'name',
  'description',
  'dueDate',
  'relations',
  'priority',
  'completed',
  'effortMinutes',
  'startDate',
  'pinnedDate',
  'tagIds',
  'kind',
  'recurrence',
  'checklist',
] as const

export type TaskPatch = Partial<
  Pick<Task, 'name' | 'description' | 'dueDate' | 'relations' | 'priority' | 'completed'> & {
    effortMinutes: number | null
    startDate: string | null
    pinnedDate: string | null
    tagIds: string[] | null
    kind: TaskKind
    recurrence: string | null
    checklist: ChecklistItem[] | null
  }
>

export interface TaskPatchSave {
  task: TaskPatch
  projectIds?: string[]
  deliveryDates?: Record<string, string | null>
  today?: string // as in TaskSave
}

const OPTIONAL_FIELDS = ['effortMinutes', 'startDate', 'pinnedDate', 'tagIds', 'recurrence', 'checklist'] as const

// The task with the patch's fields in place of its own
export function applyTaskPatch(task: Task, patch: TaskPatch): Task {
  const patched: Task = { ...task }
  for (const field of PATCH_FIELDS) {
    if (!(field in patch)) continue
    const value = patch[field]
    if (value === null && (OPTIONAL_FIELDS as readonly string[]).includes(field)) delete patched[field as (typeof OPTIONAL_FIELDS)[number]]
    else if (field === 'kind' && value === 'task') delete patched.kind // a project task has no kind stored
    else Object.assign(patched, { [field]: value })
  }
  return patched
}

export function planTaskPatch(state: State, taskId: string, { task, projectIds, deliveryDates, today }: TaskPatchSave): Plan {
  checkKnown('task', state.tasks, [taskId])
  const stored = state.tasks.find((t) => t.id === taskId)!
  return planTaskSave(state, { task: applyTaskPatch(stored, task), projectIds, deliveryDates, today })
}

// What deleting a task or project logs. A deleted task also leaves its projects, as the delete
// cascades to them.
export function planTaskDelete(state: State, id: string): TaskEvent[] {
  const projects = state.projects.map((p) => (p.taskIds.includes(id) ? { ...p, taskIds: p.taskIds.filter((t) => t !== id) } : p))
  return diffEvents(state, { tasks: state.tasks.filter((t) => t.id !== id), projects }, 'app')
}

export function planProjectDelete(state: State, id: string): TaskEvent[] {
  return diffEvents(state, { tasks: state.tasks, projects: state.projects.filter((p) => p.id !== id) }, 'app')
}

// Steps shared by every save once the change is applied: refuse new blocking loops (by throwing
// BlockLoop) and new clashes, archive the
// projects the change completed, and collect what differs from before and the events it logs.
// The saved entity is always in the changes; anything else only when it was replaced along the
// way, since every step keeps the original object for an entity it leaves alone. Archiving isn't
// an event, so the events come from the change before it.
function finish(before: State, after: State, saved: Changes, source: EventSource = 'app'): Plan {
  checkErrands(after, [...saved.tasks.map((t) => t.id), ...saved.projects.flatMap((p) => p.taskIds), ...relatedIds(saved.tasks)])
  const loop = findBlockCycle(after.tasks, before.tasks)
  if (loop) throw new BlockLoop(loop)
  const clashes = touchedClashes(before, after)
  if (clashes.length > 0) return { ok: false, clashes }

  const toArchive = new Set(projectsToArchive(before, after))
  const projects = after.projects.map((p) => (toArchive.has(p.id) ? { ...p, tagIds: [...p.tagIds, ARCHIVE_TAG_ID] } : p))

  const savedIds = new Set([...saved.tasks, ...saved.projects].map((e) => e.id))
  const differs = <T extends { id: string }>(items: T[], original: T[]) =>
    items.filter((item) => savedIds.has(item.id) || !original.includes(item))
  return {
    ok: true,
    changes: { tasks: differs(after.tasks, before.tasks), projects: differs(projects, before.projects) },
    events: diffEvents(before, after, source),
  }
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

// The tasks the saved tasks relate to, so that relating a task to an errand is refused too
const relatedIds = (tasks: Task[]) => tasks.flatMap((t) => t.relations.map((r) => r.taskId))

// Refuses (by throwing ErrandRefused) an errand among `touched`, the tasks this change saved, put
// in a project or related to, that breaks a rule: it is in a project, it and another task are
// related, it has no planned day, or it is planned after it's due. Only touched errands are
// checked, so a stored errand is never in the way of saving something else.
function checkErrands(after: State, touched: string[]) {
  const byId = new Map(after.tasks.map((t) => [t.id, t]))
  for (const id of new Set(touched)) {
    const task = byId.get(id)
    if (!task || !isErrand(task)) continue
    const params = { taskId: task.id, task: task.name }
    const project = after.projects.find((p) => p.taskIds.includes(id))
    if (project) {
      throw new ErrandRefused(
        'errand_in_project',
        { ...params, projectId: project.id, project: project.name },
        `"${task.name}" is an errand, so it can't be in a project ("${project.name}")`,
      )
    }
    const related = task.relations[0]?.taskId ?? after.tasks.find((t) => t.relations.some((r) => r.taskId === id))?.id
    if (related !== undefined) {
      const other = byId.get(related)?.name ?? related
      throw new ErrandRefused(
        'errand_related',
        { ...params, relatedTaskId: related, related: other },
        `"${task.name}" is an errand, so it can't be related to another task ("${other}")`,
      )
    }
    if (task.pinnedDate === undefined) {
      throw new ErrandRefused('errand_unplanned', params, `"${task.name}" is an errand, so it needs a planned day`)
    }
    if (task.dueDate !== null && task.pinnedDate > task.dueDate) {
      throw new ErrandRefused(
        'errand_planned_after_due',
        { ...params, pinnedDate: task.pinnedDate, dueDate: task.dueDate },
        `"${task.name}" is planned for ${task.pinnedDate}, after it's due (${task.dueDate})`,
      )
    }
  }
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
