// API for storing projects and tasks in D1 (tables in migrations/, created by migrate.ts on
// the first request). Requests outside /api/* never reach this Worker: they are served
// from the built Vue app (see wrangler.jsonc).
//
//   GET    /api/projects       -> Project[]
//   PUT    /api/projects/:id   -> saves { project, dueDates? }, returns the Changes it made
//   DELETE /api/projects/:id   -> 204
//   POST   /api/projects/:id/import -> saves { tasks } into the project, returns the Changes it made
//   GET    /api/tasks          -> Task[]
//   PUT    /api/tasks/:id      -> saves { task, projectIds?, deliveryDates? }, returns the Changes it made
//   PATCH  /api/tasks/:id      -> changes only the fields in { task, projectIds?, deliveryDates? }, returns the Changes
//   POST   /api/tasks/:id/action -> does one quick action (a TaskAction), returns the Changes it made
//   DELETE /api/tasks/:id      -> 204
//   GET    /api/tags           -> Tag[]
//   PUT    /api/tags/:id       -> saves the Tag in the body, returns it
//   DELETE /api/tags/:id       -> 204
//   GET    /api/events         -> LoggedEvent[], oldest first; ?projectId= and ?since= narrow it down
//   GET    /api/settings       -> UserSettings, the defaults until the user saves their own
//   PUT    /api/settings       -> saves the UserSettings in the body, returns them
//   POST   /api/settings/preset, /api/settings/preview -> see settings.ts
//   GET    /api/priorities?today=YYYY-MM-DD -> exactly what prioritise() returns (src/types/priority.ts)
//   GET    /api/forecast?today=YYYY-MM-DD   -> exactly what forecast() returns (src/types/forecast.ts)
//
// plus the sign-in routes in auth.ts, the Google Calendar routes in google.ts and the Telegram bot's
// routes in pamBot/index.ts. Each object is split across its own table and the tables
// holding its arrays when saved, and put back together when read.
//
// Saving a task or project applies the scheduling rules in src/types/operations.ts: a save that
// makes a task due after a project's delivery date is refused with 409 and the clashes, and a
// project whose last task is completed is archived. The Changes ({ tasks, projects }) are every
// task and project whose stored value changed. A body that isn't wrapped in { task } or
// { project } (a bare Task or Project) is refused with 400. So is a task save that would make a
// loop of blocking tasks, with the ids around it as `loop`.
//
// Errands (src/types/errand.ts) are tasks with kind 'errand'. A save that puts one in a project,
// relates it to another task, leaves it with no planned day or plans it after its due date is
// refused with 409 and the reason as a sentence ({ error, code, params, text }). A task save or
// patch may carry today, the user's local date, which an errand saved with no planned day is
// planned for. Completing a recurring errand makes the next one in the same batch.
//
// Saves and deletes of tasks and projects also log what they changed to task_events
// (src/types/events.ts), in the same batch, so a refused or failed save logs nothing.
//
// Every change to tasks, projects, tags and their lists is also logged to history by triggers
// (migrations/0013_history.sql), which take who made it from each row's changed_by: every write sets
// it to the client the request came from (worker/history.ts). Lists are written as changes to the
// rows stored, never rewritten whole, so history only shows rows that really came or went. Each
// action a person takes is counted in usage_counts once it has succeeded (worker/usage.ts):
//
//   POST   /api/usage          -> { action }, an action that happens only in the browser; 204
//
// Every route but /api/auth needs a signed-in user, and only reads and writes that user's rows:
// every query has a user_id, which comes from the session, never from the request.
//
// Every value from a request is passed to D1 as a bound parameter (?1, ?2, ...), never written
// into the SQL itself, so it can't change what a query does. The only SQL built from variables
// uses constants: NOW, the list tables in listStatements, and the table names in history.ts.
import {
  isSafeUrl,
  LINK_PROTOCOLS,
  MAX_DESCRIPTION_LENGTH,
  MAX_EFFORT_MINUTES,
  MAX_ID_LENGTH,
  MAX_LIST_LENGTH,
  MAX_NAME_LENGTH,
  MAX_URL_LENGTH,
} from '../src/types/limits'
import {
  PRIORITIES,
  RELATION_TYPES,
  TASK_KINDS,
  type ChecklistItem,
  type Priority,
  type RelationType,
  type Task,
  type TaskKind,
  type TaskRelation,
} from '../src/types/task'
import { parseRecurrence, RECURRENCE_FORMATS } from '../src/types/errand'
import type { Project, ReferenceLink } from '../src/types/project'
import { ARCHIVE_TAG_ID, DEFAULT_TAG_COLOR, isHexColor, type Tag } from '../src/types/tag'
import type { TaskEvent } from '../src/types/events'
import {
  ActionRefused,
  applyTaskPatch,
  BlockLoop,
  ErrandRefused,
  PATCH_FIELDS,
  planProjectDelete,
  planProjectSave,
  planTaskDelete,
  planTaskSave,
  planTaskAction,
  planTasksImport,
  TASK_ACTIONS,
  UnknownReference,
  type Changes,
  type Plan,
  type ProjectSave,
  type State,
  type TaskAction,
  type TaskPatch,
  type TaskSave,
  type TasksImport,
} from '../src/types/operations'
import { describeLoop, startsAfterDue, type Clash } from '../src/types/rules'
import { currentUser, handleAuth, HttpError } from './auth'
import { eventStatements, listEvents, type EventQuery } from './events'
import { handleGoogle } from './google'
import { clientOf, deleteStatements } from './history'
import { countRequest, parseUsageReport } from './usage'
import type { ChangeSource, ClientOnlyAction } from '../src/types/usage'
import { migrateOnce } from './migrate'
import { forecast } from '../src/types/forecast'
import { prioritise } from '../src/types/priority'
import { getSettings, handleSettings } from './settings'
import { botConfig, handleTelegram, handleWebhook, type PamData } from './pamBot'
import { sendBriefs } from './pamBot/brief'

const MAX_BODY_BYTES = 100_000
// An import can carry a whole project's tasks, each with a full-length description
const MAX_IMPORT_BODY_BYTES = MAX_LIST_LENGTH * (MAX_DESCRIPTION_LENGTH + 2_000)
const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`

// Thrown for requests that can't be stored; becomes a 400 response
class BadRequest extends HttpError {
  constructor(message: string) {
    super(400, message)
  }
}

// Thrown for saves that would break a scheduling rule; becomes a 409 response listing the clashes
class Conflict extends HttpError {
  constructor(
    message: string,
    readonly clashes: Clash[],
  ) {
    super(409, message)
  }
}

// Thrown for a save that would make a loop of blocking tasks; becomes a 400 response with the loop
class LoopRefused extends HttpError {
  constructor(
    message: string,
    readonly loop: string[],
  ) {
    super(400, message)
  }
}

// Rows as stored in D1
interface TaskRow {
  id: string
  name: string
  description: string
  due_date: string | null
  priority: Priority
  completed: 0 | 1
  effort_minutes: number | null
  start_date: string | null
  pinned_date: string | null
  kind: TaskKind
  recurrence: string | null
  next_occurrence_id: string | null
  account_email: string | null // from google_events, for imported tasks
}

interface ChecklistRow {
  task_id: string
  text: string
  done: 0 | 1
}

interface RelationRow {
  task_id: string
  related_task_id: string
  type: RelationType
}

interface ProjectRow {
  id: string
  name: string
  description: string
  delivery_date: string | null
  priority: Priority
}

interface ProjectTaskRow {
  project_id: string
  task_id: string
}

interface TaskTagRow {
  task_id: string
  tag_id: string
}

interface ProjectTagRow {
  project_id: string
  tag_id: string
}

interface LinkRow {
  project_id: string
  label: string
  url: string
}

function groupBy<T>(rows: T[], key: (row: T) => string) {
  const groups = new Map<string, T[]>()
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row])
  return groups
}

// Validation of request bodies

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new BadRequest(message)
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isString = (value: unknown): value is string => typeof value === 'string'
const isId = (value: unknown): value is string => isString(value) && value.length <= MAX_ID_LENGTH
const isDate = (value: unknown): value is string => isString(value) && /^\d{4}-\d{2}-\d{2}$/.test(value)
const isDateOrNull = (value: unknown): value is string | null => value === null || isDate(value)
// Fields a body may leave out, or send as null, to say they aren't set
const isUnset = (value: unknown): value is null | undefined => value === undefined || value === null
const isList = (value: unknown): value is unknown[] => Array.isArray(value) && value.length <= MAX_LIST_LENGTH
// An object from ids to dates, as in deliveryDates and dueDates
const isDateMap = (value: unknown): value is Record<string, string | null> =>
  isObject(value) &&
  Object.keys(value).length <= MAX_LIST_LENGTH &&
  Object.entries(value).every(([id, date]) => isId(id) && isDateOrNull(date))
const oneOf = <T>(values: readonly T[], value: unknown): value is T =>
  (values as readonly unknown[]).includes(value)
const allDifferent = (values: unknown[]) => new Set(values).size === values.length
const isRelation = (value: unknown): value is TaskRelation =>
  isObject(value) && isId(value.taskId) && oneOf(RELATION_TYPES, value.type)
const isChecklistItem = (value: unknown): value is ChecklistItem =>
  isObject(value) &&
  isString(value.text) &&
  value.text.trim() !== '' &&
  value.text.length <= MAX_NAME_LENGTH &&
  typeof value.done === 'boolean'
const isLink = (value: unknown): value is ReferenceLink =>
  isObject(value) &&
  isString(value.label) &&
  value.label.length <= MAX_NAME_LENGTH &&
  isString(value.url) &&
  value.url.length <= MAX_URL_LENGTH &&
  isSafeUrl(value.url)

function checkName(name: unknown): asserts name is string {
  check(isString(name) && name.trim() !== '', 'name must be a non-empty string')
  check(name.length <= MAX_NAME_LENGTH, `name must be at most ${MAX_NAME_LENGTH} characters`)
}

// Fields that projects and tasks share
function checkCommon(
  body: unknown,
  id: string,
): asserts body is Record<string, unknown> & { name: string; description: string; priority: Priority } {
  check(isObject(body), 'Body must be a JSON object')
  check(body.id === id, 'id must match the URL')
  checkName(body.name)
  check(
    isString(body.description) && body.description.length <= MAX_DESCRIPTION_LENGTH,
    `description must be a string of at most ${MAX_DESCRIPTION_LENGTH} characters`,
  )
  check(oneOf(PRIORITIES, body.priority), `priority must be one of ${PRIORITIES.join(', ')}`)
}

// A start date after the due date is refused, except in an import, whose plan moves it back to the
// due date instead (planTasksImport), since the import dialog doesn't show start dates
function parseTask(body: unknown, id: string, { startAfterDue = 'refuse' } = {}): Task {
  checkCommon(body, id)
  const { dueDate, completed, relations, effortMinutes, startDate, pinnedDate, tagIds, kind, recurrence, checklist } = body
  check(isDateOrNull(dueDate), 'dueDate must be null or a YYYY-MM-DD date')
  // An errand's own fields. The rules between fields and other tasks (no projects, no relations, a
  // planned day on or before the due date) are the planner's, in operations.ts.
  check(isUnset(kind) || oneOf(TASK_KINDS, kind), `kind must be left out, null or one of ${TASK_KINDS.join(', ')}`)
  const errand = kind === 'errand'
  check(
    isUnset(recurrence) || (isString(recurrence) && parseRecurrence(recurrence) !== null),
    `recurrence must be left out, null, ${RECURRENCE_FORMATS}`,
  )
  check(isUnset(recurrence) || errand, 'recurrence is only for errands (kind errand)')
  check(
    isUnset(checklist) || (isList(checklist) && checklist.every(isChecklistItem)),
    `checklist must be left out, null or a list of at most ${MAX_LIST_LENGTH} { text, done }, with text of 1 to ${MAX_NAME_LENGTH} characters`,
  )
  check(isUnset(checklist) || checklist.length === 0 || errand, 'checklist is only for errands (kind errand)')
  check(
    isUnset(tagIds) || (isList(tagIds) && tagIds.every(isId)),
    `tagIds must be left out, null or a list of at most ${MAX_LIST_LENGTH} tag ids`,
  )
  check(isUnset(tagIds) || allDifferent(tagIds), 'tagIds must not list a tag twice')
  check(typeof completed === 'boolean', 'completed must be true or false')
  check(
    isUnset(effortMinutes) ||
      (typeof effortMinutes === 'number' &&
        Number.isInteger(effortMinutes) &&
        effortMinutes > 0 &&
        effortMinutes <= MAX_EFFORT_MINUTES),
    `effortMinutes must be left out, null or a whole number of minutes from 1 to ${MAX_EFFORT_MINUTES}`,
  )
  check(isUnset(startDate) || isDate(startDate), 'startDate must be left out, null or a YYYY-MM-DD date')
  check(isUnset(pinnedDate) || isDate(pinnedDate), 'pinnedDate must be left out, null or a YYYY-MM-DD date')
  check(
    startAfterDue === 'allow' || !startsAfterDue({ startDate: startDate ?? undefined, dueDate }),
    'startDate must be on or before dueDate',
  )
  check(
    isList(relations) && relations.every(isRelation),
    `relations must be a list of at most ${MAX_LIST_LENGTH} { taskId, type } with type one of ${RELATION_TYPES.join(', ')}`,
  )
  check(allDifferent(relations.map((r) => r.taskId)), 'relations must not list a task twice')
  check(relations.every((r) => r.taskId !== id), 'a task cannot be related to itself')

  return {
    id,
    name: body.name,
    description: body.description,
    dueDate,
    relations: relations.map((r) => ({ taskId: r.taskId, type: r.type })),
    priority: body.priority,
    completed,
    ...(isUnset(effortMinutes) ? {} : { effortMinutes }),
    ...(isUnset(startDate) ? {} : { startDate }),
    ...(isUnset(pinnedDate) ? {} : { pinnedDate }),
    // An empty list is left out, as a task with no tags has none
    ...(isUnset(tagIds) || tagIds.length === 0 ? {} : { tagIds }),
    // A project task has no kind stored, as one saved before errands
    ...(errand ? { kind } : {}),
    ...(isUnset(recurrence) ? {} : { recurrence }),
    ...(isUnset(checklist) || checklist.length === 0 ? {} : { checklist: checklist.map((i) => ({ text: i.text, done: i.done })) }),
  }
}

function parseProject(body: unknown, id: string): Project {
  checkCommon(body, id)
  const { deliveryDate, taskIds, links, tagIds } = body
  check(isDateOrNull(deliveryDate), 'deliveryDate must be null or a YYYY-MM-DD date')
  check(isList(tagIds) && tagIds.every(isId), `tagIds must be a list of at most ${MAX_LIST_LENGTH} tag ids`)
  check(allDifferent(tagIds), 'tagIds must not list a tag twice')
  check(isList(taskIds) && taskIds.every(isId), `taskIds must be a list of at most ${MAX_LIST_LENGTH} task ids`)
  check(allDifferent(taskIds), 'taskIds must not list a task twice')
  check(
    isList(links) && links.every(isLink),
    `links must be a list of at most ${MAX_LIST_LENGTH} { label, url }, with url starting ${LINK_PROTOCOLS.join(', ')}`,
  )

  return {
    id,
    name: body.name,
    description: body.description,
    deliveryDate,
    taskIds,
    priority: body.priority,
    links: links.map((l) => ({ label: l.label, url: l.url })),
    tagIds,
  }
}

// A task save: { task, projectIds?, deliveryDates? }
function parseTaskSave(body: unknown, id: string): TaskSave {
  check(isObject(body), 'Body must be a JSON object')
  check(Object.hasOwn(body, 'task'), 'Body must be { task, projectIds?, deliveryDates? }')
  return { task: parseTask(body.task, id), ...parseMembership(body) }
}

// What a task save or patch may carry besides the task: the projects it should be in, and the
// delivery dates moved to fit it
function parseMembership(body: Record<string, unknown>): Omit<TaskSave, 'task'> {
  const { projectIds, deliveryDates, today } = body
  check(today === undefined || isDate(today), "today must be left out or a YYYY-MM-DD date: the user's local date")
  check(
    projectIds === undefined || (isList(projectIds) && projectIds.every(isId)),
    `projectIds must be a list of at most ${MAX_LIST_LENGTH} project ids`,
  )
  check(projectIds === undefined || allDifferent(projectIds), 'projectIds must not list a project twice')
  check(
    deliveryDates === undefined || isDateMap(deliveryDates),
    'deliveryDates must map project ids to null or a YYYY-MM-DD date',
  )
  return { projectIds, deliveryDates, today }
}

// A partial task save: { task, projectIds?, deliveryDates? }, where task holds only the fields to
// change (PATCH_FIELDS in operations.ts). Null clears the due date and the optional fields. The
// patched task is checked as a whole when the save is planned, so the rules are those of a PUT.
function parseTaskPatch(body: unknown, id: string): { patch: TaskPatch } & Omit<TaskSave, 'task'> {
  check(isObject(body) && isObject(body.task), 'Body must be { task, projectIds?, deliveryDates? }, with task holding the fields to change')
  const { task } = body
  const unknown = Object.keys(task).filter((key) => !(PATCH_FIELDS as readonly string[]).includes(key) && key !== 'id')
  check(unknown.length === 0, `task can only change ${PATCH_FIELDS.join(', ')}; not ${unknown.join(', ')}`)
  check(task.id === undefined || task.id === id, 'id must match the URL')
  const { id: _, ...patch } = task
  return { patch: patch as TaskPatch, ...parseMembership(body) }
}

// A project save: { project, dueDates? }
function parseProjectSave(body: unknown, id: string): ProjectSave {
  check(isObject(body), 'Body must be a JSON object')
  check(Object.hasOwn(body, 'project'), 'Body must be { project, dueDates? }')
  const { dueDates } = body
  check(dueDates === undefined || isDateMap(dueDates), 'dueDates must map task ids to null or a YYYY-MM-DD date')
  return { project: parseProject(body.project, id), dueDates }
}

// An import: { tasks }, each a whole Task. A task's problem is reported with its place in the
// list, e.g. "tasks[2]: name must be a non-empty string".
function parseTasksImport(body: unknown): TasksImport {
  check(isObject(body) && Object.hasOwn(body, 'tasks'), 'Body must be { tasks }')
  const { tasks } = body
  check(isList(tasks), `tasks must be a list of at most ${MAX_LIST_LENGTH} tasks`)
  const parsed = tasks.map((task, i) => {
    try {
      check(isObject(task) && isId(task.id), `id must be a string of at most ${MAX_ID_LENGTH} characters`)
      return parseTask(task, task.id, { startAfterDue: 'allow' })
    } catch (e) {
      throw e instanceof BadRequest ? new BadRequest(`tasks[${i}]: ${e.message}`) : e
    }
  })
  check(allDifferent(parsed.map((t) => t.id)), 'tasks must not list a task twice')
  return { tasks: parsed }
}

// A quick action: { action, ... } with what that action needs (TaskAction in operations.ts)
function parseTaskAction(body: unknown): TaskAction {
  check(isObject(body) && oneOf(TASK_ACTIONS, body.action), `action must be one of ${TASK_ACTIONS.join(', ')}`)
  switch (body.action) {
    case 'do_today':
    case 'not_today':
      check(isDate(body.today), 'today must be a YYYY-MM-DD date')
      return { action: body.action, today: body.today }
    case 'unpin':
      return { action: 'unpin' }
    case 'plan':
      check(isDate(body.date), 'date must be a YYYY-MM-DD date')
      return { action: 'plan', date: body.date }
    case 'importance':
      check(body.direction === 'up' || body.direction === 'down', 'direction must be up or down')
      return { action: 'importance', direction: body.direction }
    case 'estimate': {
      const { effortMinutes } = body
      check(
        effortMinutes === null ||
          (typeof effortMinutes === 'number' &&
            Number.isInteger(effortMinutes) &&
            effortMinutes > 0 &&
            effortMinutes <= MAX_EFFORT_MINUTES),
        `effortMinutes must be null or a whole number of minutes from 1 to ${MAX_EFFORT_MINUTES}`,
      )
      return { action: 'estimate', effortMinutes }
    }
  }
}

// A tag to save. color may be left out, as by clients from before tags had colours: a new tag
// is then indigo and an existing one keeps its colour.
type TagBody = Omit<Tag, 'color'> & { color?: string }

function parseTag(body: unknown, id: string): TagBody {
  check(isObject(body), 'Body must be a JSON object')
  check(body.id === id, 'id must match the URL')
  checkName(body.name)
  const { color } = body
  check(color === undefined || isHexColor(color), 'color must be a #rrggbb hex colour')
  return { id, name: body.name.trim(), color: color?.toLowerCase() }
}

// Tasks

async function listTasks(db: D1Database, userId: string): Promise<Task[]> {
  const [tasks, relations, taskTags, checklists] = (await db.batch([
    db
      .prepare(
        `SELECT tasks.*, google_events.account_email FROM tasks
         LEFT JOIN google_events ON google_events.user_id = tasks.user_id AND google_events.task_id = tasks.id
         WHERE tasks.user_id = ?1 ORDER BY tasks.created_at, tasks.id`,
      )
      .bind(userId),
    db.prepare('SELECT * FROM task_relations WHERE user_id = ?1 ORDER BY task_id, position').bind(userId),
    db.prepare('SELECT * FROM task_tags WHERE user_id = ?1 ORDER BY task_id, position').bind(userId),
    db.prepare('SELECT * FROM task_checklist_items WHERE user_id = ?1 ORDER BY task_id, position').bind(userId),
  ])) as [D1Result<TaskRow>, D1Result<RelationRow>, D1Result<TaskTagRow>, D1Result<ChecklistRow>]
  const relationsByTask = groupBy(relations.results, (r) => r.task_id)
  const tagsByTask = groupBy(taskTags.results, (t) => t.task_id)
  const checklistByTask = groupBy(checklists.results, (c) => c.task_id)

  return tasks.results.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    dueDate: row.due_date,
    relations: (relationsByTask.get(row.id) ?? []).map((r) => ({ taskId: r.related_task_id, type: r.type })),
    priority: row.priority,
    completed: row.completed === 1,
    ...(row.effort_minutes !== null ? { effortMinutes: row.effort_minutes } : {}),
    ...(row.start_date !== null ? { startDate: row.start_date } : {}),
    ...(row.pinned_date !== null ? { pinnedDate: row.pinned_date } : {}),
    ...(tagsByTask.has(row.id) ? { tagIds: tagsByTask.get(row.id)!.map((t) => t.tag_id) } : {}),
    ...(row.kind === 'errand' ? { kind: row.kind } : {}),
    ...(row.recurrence !== null ? { recurrence: row.recurrence } : {}),
    ...(checklistByTask.has(row.id)
      ? { checklist: checklistByTask.get(row.id)!.map((c) => ({ text: c.text, done: c.done === 1 })) }
      : {}),
    ...(row.next_occurrence_id !== null ? { nextOccurrenceId: row.next_occurrence_id } : {}),
    ...(row.account_email ? { googleAccount: row.account_email } : {}),
  }))
}

// A task as the API returns it: without nextOccurrenceId, which only the Worker reads
function publicTask(task: Task): Task {
  const { nextOccurrenceId: _, ...rest } = task
  return rest
}

const publicChanges = (changes: Changes): Changes => ({ ...changes, tasks: changes.tasks.map(publicTask) })

// A table holding a list: the rows of `owner`'s list are its `item`s, in `position` order, with a
// `value` column for relations' type
interface ListTable {
  table: 'project_tasks' | 'project_tags' | 'task_tags' | 'task_relations'
  owner: 'project_id' | 'task_id'
  item: 'task_id' | 'tag_id' | 'related_task_id'
  value?: 'type'
}

const PROJECT_TASKS: ListTable = { table: 'project_tasks', owner: 'project_id', item: 'task_id' }
const PROJECT_TAGS: ListTable = { table: 'project_tags', owner: 'project_id', item: 'tag_id' }
const TASK_TAGS: ListTable = { table: 'task_tags', owner: 'task_id', item: 'tag_id' }
const TASK_RELATIONS: ListTable = { table: 'task_relations', owner: 'task_id', item: 'related_task_id', value: 'type' }

interface ListRow {
  id: string
  value?: string
}

const ids = (list: string[]): ListRow[] => list.map((id) => ({ id }))
const relationRows = (relations: TaskRelation[]): ListRow[] => relations.map((r) => ({ id: r.taskId, value: r.type }))

// Writes a list as changes to the rows stored: deletes the items that left it, inserts the new ones
// (and, for relations, updates those whose type changed), then renumbers the positions. Rewriting
// the whole list would log a delete and an insert to history for every item that stayed; position
// changes aren't logged. `before` is the list as stored, in order. Its positions can have gaps, left
// by rows a cascade deleted, so they are set from the new order with one statement rather than
// worked out from `before`, whenever the list changed. An insert that finds its row already there
// (another device added it since this save read the data) updates it instead. Table and column
// names come from the constants above, never from a request.
function listStatements(
  db: D1Database,
  { table, owner, item, value }: ListTable,
  userId: string,
  ownerId: string,
  before: ListRow[],
  after: ListRow[],
): D1PreparedStatement[] {
  const stored = new Map(before.map((row) => [row.id, row]))
  const kept = new Set(after.map((row) => row.id))
  const removed = before.filter((row) => !kept.has(row.id)).map((row) => row.id)
  const written = after
    .map((row, position) => ({ ...row, position }))
    .filter((row) => !stored.has(row.id) || stored.get(row.id)!.value !== row.value)
  const reordered = before.length !== after.length || before.some((row, i) => row.id !== after[i]!.id)
  const upsert = value
    ? `INSERT INTO ${table} (user_id, ${owner}, ${item}, position, ${value}) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (user_id, ${owner}, ${item}) DO UPDATE SET position = excluded.position, ${value} = excluded.${value}`
    : `INSERT INTO ${table} (user_id, ${owner}, ${item}, position) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (user_id, ${owner}, ${item}) DO UPDATE SET position = excluded.position`
  return [
    ...(removed.length
      ? [
          db
            .prepare(`DELETE FROM ${table} WHERE user_id = ?1 AND ${owner} = ?2 AND ${item} IN (SELECT value FROM json_each(?3))`)
            .bind(userId, ownerId, JSON.stringify(removed)),
        ]
      : []),
    ...written.map((row) => db.prepare(upsert).bind(userId, ownerId, row.id, row.position, ...(value ? [row.value] : []))),
    ...(reordered && after.length
      ? [
          db
            .prepare(
              `UPDATE ${table} SET position = listed.key FROM json_each(?3) AS listed
               WHERE ${table}.user_id = ?1 AND ${table}.${owner} = ?2 AND ${table}.${item} = listed.value
                 AND ${table}.position IS NOT listed.key`,
            )
            .bind(userId, ownerId, JSON.stringify(after.map((row) => row.id))),
        ]
      : []),
  ]
}

// The task row is upserted (not replaced, which would cascade and drop it from its projects), and
// its relations and tags are written as changes to `stored`, the task as it was read before the save
// (undefined for a new one)
function taskStatements(
  db: D1Database,
  userId: string,
  task: Task,
  stored: Task | undefined,
  source: ChangeSource,
): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO tasks (id, name, description, due_date, priority, completed, effort_minutes, start_date,
           pinned_date, user_id, changed_by, kind, recurrence, next_occurrence_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
         ON CONFLICT (user_id, id) DO UPDATE SET name = excluded.name, description = excluded.description,
           due_date = excluded.due_date, priority = excluded.priority, completed = excluded.completed,
           effort_minutes = excluded.effort_minutes, start_date = excluded.start_date,
           pinned_date = excluded.pinned_date, changed_by = excluded.changed_by, kind = excluded.kind,
           recurrence = excluded.recurrence, next_occurrence_id = excluded.next_occurrence_id, updated_at = ${NOW}`,
      )
      .bind(
        task.id,
        task.name,
        task.description,
        task.dueDate,
        task.priority,
        task.completed ? 1 : 0,
        task.effortMinutes ?? null,
        task.startDate ?? null,
        task.pinnedDate ?? null,
        userId,
        source,
        task.kind ?? 'task',
        task.recurrence ?? null,
        task.nextOccurrenceId ?? null,
      ),
    ...listStatements(db, TASK_RELATIONS, userId, task.id, relationRows(stored?.relations ?? []), relationRows(task.relations)),
    ...listStatements(db, TASK_TAGS, userId, task.id, ids(stored?.tagIds ?? []), ids(task.tagIds ?? [])),
    ...checklistStatements(db, userId, task.id, stored?.checklist ?? [], task.checklist ?? []),
  ]
}

// A checklist is kept by position, not by item, so it is written as the positions that changed and
// the ones past its new end deleted. It isn't logged to history (migrations/0014_errands.sql), so
// unlike the lists above, an item edited in place needs no care to look like the same row.
function checklistStatements(
  db: D1Database,
  userId: string,
  taskId: string,
  before: ChecklistItem[],
  after: ChecklistItem[],
): D1PreparedStatement[] {
  const changed = after
    .map((item, position) => ({ ...item, position }))
    .filter((item) => before[item.position]?.text !== item.text || before[item.position]?.done !== item.done)
  return [
    ...(before.length > after.length
      ? [db.prepare('DELETE FROM task_checklist_items WHERE user_id = ?1 AND task_id = ?2 AND position >= ?3').bind(userId, taskId, after.length)]
      : []),
    ...changed.map((item) =>
      db
        .prepare(
          `INSERT INTO task_checklist_items (user_id, task_id, position, text, done) VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT (user_id, task_id, position) DO UPDATE SET text = excluded.text, done = excluded.done`,
        )
        .bind(userId, taskId, item.position, item.text, item.done ? 1 : 0),
    ),
  ]
}

// Projects

async function listProjects(db: D1Database, userId: string): Promise<Project[]> {
  const [projects, projectTasks, links, projectTags] = (await db.batch([
    db.prepare('SELECT * FROM projects WHERE user_id = ?1 ORDER BY created_at, id').bind(userId),
    db.prepare('SELECT * FROM project_tasks WHERE user_id = ?1 ORDER BY project_id, position').bind(userId),
    db.prepare('SELECT * FROM project_links WHERE user_id = ?1 ORDER BY project_id, position').bind(userId),
    db.prepare('SELECT * FROM project_tags WHERE user_id = ?1 ORDER BY project_id, position').bind(userId),
  ])) as [D1Result<ProjectRow>, D1Result<ProjectTaskRow>, D1Result<LinkRow>, D1Result<ProjectTagRow>]
  const tasksByProject = groupBy(projectTasks.results, (t) => t.project_id)
  const linksByProject = groupBy(links.results, (l) => l.project_id)
  const tagsByProject = groupBy(projectTags.results, (t) => t.project_id)

  return projects.results.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    deliveryDate: row.delivery_date,
    taskIds: (tasksByProject.get(row.id) ?? []).map((t) => t.task_id),
    priority: row.priority,
    links: (linksByProject.get(row.id) ?? []).map((l) => ({ label: l.label, url: l.url })),
    tagIds: (tagsByProject.get(row.id) ?? []).map((t) => t.tag_id),
  }))
}

// The project row is upserted, its tasks and tags are written as changes to `stored` (as in
// taskStatements), and its links, which history doesn't log, are rewritten
function projectStatements(
  db: D1Database,
  userId: string,
  project: Project,
  stored: Project | undefined,
  source: ChangeSource,
): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO projects (id, name, description, delivery_date, priority, user_id, changed_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (user_id, id) DO UPDATE SET name = excluded.name, description = excluded.description,
           delivery_date = excluded.delivery_date, priority = excluded.priority, changed_by = excluded.changed_by,
           updated_at = ${NOW}`,
      )
      .bind(project.id, project.name, project.description, project.deliveryDate, project.priority, userId, source),
    ...listStatements(db, PROJECT_TASKS, userId, project.id, ids(stored?.taskIds ?? []), ids(project.taskIds)),
    db.prepare('DELETE FROM project_links WHERE user_id = ?1 AND project_id = ?2').bind(userId, project.id),
    ...project.links.map((link, position) =>
      db
        .prepare('INSERT INTO project_links (user_id, project_id, position, label, url) VALUES (?1, ?2, ?3, ?4, ?5)')
        .bind(userId, project.id, position, link.label, link.url),
    ),
    ...listStatements(db, PROJECT_TAGS, userId, project.id, ids(stored?.tagIds ?? []), ids(project.tagIds)),
  ]
}

// Saves several tasks and projects, and logs the events, as one transaction, since D1 has no
// BEGIN/COMMIT and a batch is its only atomic unit. Tasks go first because project_tasks rows
// reference them. `stored` is the data the save was planned against, which the lists are written
// as changes to, and `source` who made the change, for history.
async function writeChanges(
  db: D1Database,
  userId: string,
  { tasks, projects }: Changes,
  events: TaskEvent[],
  stored: State,
  source: ChangeSource,
) {
  const storedTasks = new Map(stored.tasks.map((t) => [t.id, t]))
  const storedProjects = new Map(stored.projects.map((p) => [p.id, p]))
  await db.batch([
    ...tasks.flatMap((task) => taskStatements(db, userId, task, storedTasks.get(task.id), source)),
    ...projects.flatMap((project) => projectStatements(db, userId, project, storedProjects.get(project.id), source)),
    ...eventStatements(db, userId, new Date().toISOString(), events),
  ])
}

// Plans a save against the user's stored tasks and projects, then writes everything it changes as
// one batch. `saving` holds the task or project being saved, so a clash calls it by its new name,
// and `source` is who is saving it, for history.
//
// The read and the batch are not one transaction (D1 has no interactive transactions), so when
// two devices save at once, one can plan against data the other is changing, and lose that
// update. That's acceptable for now.
async function saveWithRules(
  db: D1Database,
  userId: string,
  plan: (state: State) => Plan,
  saving: State,
  source: ChangeSource,
): Promise<Changes> {
  const [tasks, projects] = await Promise.all([listTasks(db, userId), listProjects(db, userId)])
  let result: Plan
  try {
    result = plan({ tasks, projects })
  } catch (e) {
    if (!(e instanceof BlockLoop)) throw e
    throw new LoopRefused(loopMessage(e.loop, [...tasks, ...saving.tasks]), e.loop)
  }
  if (!result.ok) {
    const message = clashMessage(result.clashes[0]!, [...tasks, ...saving.tasks], [...projects, ...saving.projects])
    throw new Conflict(message, result.clashes)
  }
  await writeChanges(db, userId, result.changes, result.events, { tasks, projects }, source)
  return publicChanges(result.changes)
}

// e.g. "Write report" is due 2026-12-14, after "Thesis"'s delivery date (2026-12-10). The last
// task or project with the id gives its name.
function clashMessage(clash: Clash, tasks: Task[], projects: Project[]) {
  const name = (items: { id: string; name: string }[], id: string) => items.findLast((i) => i.id === id)?.name ?? id
  return (
    `"${name(tasks, clash.taskId)}" is due ${clash.dueDate}, ` +
    `after "${name(projects, clash.projectId)}"'s delivery date (${clash.deliveryDate})`
  )
}

// e.g. This would make a loop of blocking tasks: "A" blocks "B", which blocks "A". The last task
// with the id gives its name, as in clashMessage.
function loopMessage(loop: string[], tasks: Task[]) {
  const name = (id: string) => tasks.findLast((t) => t.id === id)?.name ?? id
  return `This would make a loop of blocking tasks: ${describeLoop(loop, name)}`
}

// Saves imported tasks into a project as one batch, so a clash or a failure saves none of them.
// As with a task save, a task keeps the Google account it was synced from.
function importTasks(db: D1Database, userId: string, projectId: string, body: unknown, source: ChangeSource): Promise<Changes> {
  const { tasks } = parseTasksImport(body)
  return saveWithRules(
    db,
    userId,
    (state) => {
      const project = state.projects.find((p) => p.id === projectId)
      const total = new Set([...(project?.taskIds ?? []), ...tasks.map((t) => t.id)]).size
      check(total <= MAX_LIST_LENGTH, `A project can have at most ${MAX_LIST_LENGTH} tasks; this import would give it ${total}`)
      const accounts = new Map(state.tasks.map((t) => [t.id, t.googleAccount]))
      const withSource = tasks.map((t) => {
        const googleAccount = accounts.get(t.id)
        return googleAccount ? { ...t, googleAccount } : t
      })
      return planTasksImport(state, projectId, { tasks: withSource })
    },
    { tasks, projects: [] },
    source,
  )
}

// Deletes a task or project, logging what the delete does in the same batch. The events are
// worked out from the stored data, read first, with the same race as saveWithRules. History logs
// the delete as `source`'s (see deleteStatements).
async function deleteLogged(
  db: D1Database,
  userId: string,
  table: 'tasks' | 'projects',
  id: string,
  plan: (state: State, id: string) => TaskEvent[],
  source: ChangeSource,
): Promise<void> {
  const [tasks, projects] = await Promise.all([listTasks(db, userId), listProjects(db, userId)])
  await db.batch([
    ...eventStatements(db, userId, new Date().toISOString(), plan({ tasks, projects }, id)),
    ...deleteStatements(db, userId, table, [id], source),
  ])
}

// Prioritisation and the forecast

// ?today=, the user's local date, which only their device knows
function parseToday(params: URLSearchParams): string {
  const today = params.get('today')
  check(isDate(today), "today must be a YYYY-MM-DD date: the user's local date")
  return today
}

// GET /api/priorities and /api/forecast: what the shared functions return, from the stored tasks,
// projects and settings, as the app works them out. Nothing is stored.
async function planning(db: D1Database, userId: string, name: 'priorities' | 'forecast', today: string) {
  const [tasks, projects, settings] = await Promise.all([listTasks(db, userId), listProjects(db, userId), getSettings(db, userId)])
  const priorities = prioritise(tasks, projects, settings, today)
  return name === 'priorities' ? priorities : forecast(tasks, projects, settings, today, priorities)
}

// What the Telegram bot reads, as the planning routes read it, and how it saves, as the task routes
// save
const pamData: PamData = {
  async load(db, userId) {
    const [tasks, projects, settings] = await Promise.all([listTasks(db, userId), listProjects(db, userId), getSettings(db, userId)])
    return { tasks, projects, settings }
  },
  save: (db, userId, plan) => saveWithRules(db, userId, plan, { tasks: [], projects: [] }, 'telegram'),
  remove: (db, userId, taskId) => deleteLogged(db, userId, 'tasks', taskId, planTaskDelete, 'telegram'),
}

// Events

// ?projectId= and ?since=, where an empty value means no filter
function parseEventQuery(params: URLSearchParams): EventQuery {
  const projectId = params.get('projectId') || undefined
  const since = params.get('since') || undefined
  check(projectId === undefined || isId(projectId), `projectId must be at most ${MAX_ID_LENGTH} characters`)
  check(
    since === undefined || /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z)?$/.test(since),
    'since must be a YYYY-MM-DD date or a UTC timestamp such as 2026-10-25T15:08:26.123Z',
  )
  return { projectId, since }
}

// Tags

async function listTags(db: D1Database, userId: string): Promise<Tag[]> {
  const { results } = await db
    .prepare('SELECT id, name, color FROM tags WHERE user_id = ?1 ORDER BY name, id')
    .bind(userId)
    .all<Tag>()
  return results
}

// Returns the tag as stored, so the reply has its colour even when the body left it out
async function saveTag(db: D1Database, userId: string, tag: TagBody, source: ChangeSource): Promise<Tag> {
  return (await db
    .prepare(
      `INSERT INTO tags (user_id, id, name, color, changed_by) VALUES (?1, ?2, ?3, coalesce(?4, ?5), ?6)
       ON CONFLICT (user_id, id) DO UPDATE SET name = excluded.name, color = coalesce(?4, color),
         changed_by = excluded.changed_by, updated_at = ${NOW}
       RETURNING id, name, color`,
    )
    .bind(userId, tag.id, tag.name, tag.color ?? null, DEFAULT_TAG_COLOR, source)
    .first<Tag>())!
}

// Routing

// `source` is who is saving or deleting, for history
interface Resource {
  list(db: D1Database, userId: string): Promise<unknown[]>
  save(db: D1Database, userId: string, id: string, body: unknown, source: ChangeSource): Promise<unknown>
  // Deleting the row cascades to the tables holding its arrays
  remove(db: D1Database, userId: string, id: string, source: ChangeSource): Promise<void>
}

const RESOURCES: Record<string, Resource> = {
  tasks: {
    list: async (db, userId) => (await listTasks(db, userId)).map(publicTask),
    save(db, userId, id, body, source) {
      const save = parseTaskSave(body, id)
      const saving = { tasks: [save.task], projects: [] }
      // Only the sync sets googleAccount, so the saved task keeps the stored one
      const withSource = (state: State): TaskSave => {
        const googleAccount = state.tasks.find((t) => t.id === id)?.googleAccount
        return googleAccount ? { ...save, task: { ...save.task, googleAccount } } : save
      }
      return saveWithRules(db, userId, (state) => planTaskSave(state, withSource(state)), saving, source)
    },
    remove: (db, userId, id, source) => deleteLogged(db, userId, 'tasks', id, planTaskDelete, source),
  },
  projects: {
    list: listProjects,
    save(db, userId, id, body, source) {
      const save = parseProjectSave(body, id)
      const saving = { tasks: [], projects: [save.project] }
      return saveWithRules(db, userId, (state) => planProjectSave(state, save), saving, source)
    },
    remove: (db, userId, id, source) => deleteLogged(db, userId, 'projects', id, planProjectDelete, source),
  },
  // Deleting a tag removes it from its projects and tasks
  tags: {
    list: listTags,
    save: (db, userId, id, body, source) => saveTag(db, userId, parseTag(body, id), source),
    async remove(db, userId, id, source) {
      await db.batch(deleteStatements(db, userId, 'tags', [id], source))
    },
  },
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

function error(status: number, message: string) {
  return json({ error: message }, status)
}

// Only JSON is accepted, so a form on another site (which can't send JSON without the browser
// asking this Worker's permission first) can't save anything
async function readJson(request: Request, maxLength = MAX_BODY_BYTES): Promise<unknown> {
  const type = request.headers.get('Content-Type') ?? ''
  check(type.split(';')[0]!.trim().toLowerCase() === 'application/json', 'Body must be sent as application/json')
  const text = await request.text()
  check(text.length <= maxLength, 'Body too large')
  try {
    return JSON.parse(text)
  } catch {
    throw new BadRequest('Body must be JSON')
  }
}

function decodeId(rawId: string) {
  let id: string
  try {
    id = decodeURIComponent(rawId)
  } catch {
    throw new BadRequest('The id in the URL is not correctly encoded') // e.g. a stray "%"
  }
  check(id.length <= MAX_ID_LENGTH, `id must be at most ${MAX_ID_LENGTH} characters`)
  return id
}

// What handling a request found out that counting it needs: the signed-in user, and the action a
// POST /api/usage reported
interface Handled {
  userId?: string
  reported?: ClientOnlyAction
}

// The route without ids, for the name of a request with no known X-Pam-Action, e.g. "tasks",
// "tasks/action", "google/accounts" or "settings/preset"
function routeOf(name: string | undefined, rawId: string | undefined, rest: string[]) {
  if (name === 'tasks' || name === 'projects') return [name, ...rest].join('/')
  if (name === 'tags' || !rawId) return name ?? ''
  return `${name}/${rawId}` // google/..., settings/..., telegram/...
}

// Every /api request, apart from counting it
async function handle(request: Request, env: Env, ctx: ExecutionContext, handled: Handled): Promise<Response> {
  // e.g. "/api/tasks/abc" -> ["", "api", "tasks", "abc"]
  const url = new URL(request.url)
  const [, api, name, rawId, ...rest] = url.pathname.split('/')
  const resource = name !== undefined && Object.hasOwn(RESOURCES, name) ? RESOURCES[name] : undefined
  const isGoogle = name === 'google' // the only routes with more than one part after the name
  const isEvents = name === 'events' && !rawId // read only, so there is no /api/events/:id
  // One per user, so there is no /api/settings/:id, only /api/settings/preset and /preview
  const isSettings = name === 'settings' && rest.length === 0
  const isPlanning = (name === 'priorities' || name === 'forecast') && !rawId
  const isPatch = name === 'tasks' && rawId !== undefined && rest.length === 0 && request.method === 'PATCH'
  const isImport = name === 'projects' && rest.length === 1 && rest[0] === 'import'
  const isAction = name === 'tasks' && rest.length === 1 && rest[0] === 'action'
  // /api/telegram, /api/telegram/link-code and /api/telegram/webhook
  const isTelegram = name === 'telegram' && rest.length === 0
  const isUsage = name === 'usage' && !rawId
  if (
    api !== 'api' ||
    !(resource || name === 'auth' || isGoogle || isEvents || isSettings || isPlanning || isTelegram || isUsage) ||
    (rest.length > 0 && !isGoogle && !isImport && !isAction)
  ) {
    return error(404, 'Not found')
  }

  try {
    await migrateOnce(env.DB)
    if (name === 'auth') return await handleAuth(env, ctx, request, rawId, () => readJson(request))
    // The bot is off until its secrets are set. Telegram has no session, so the webhook comes first.
    const bot = isTelegram ? botConfig(env) : null
    if (isTelegram && !bot) return error(404, 'Not found')
    if (bot && rawId === 'webhook') return await handleWebhook(env, ctx, bot, pamData, request)

    const user = await currentUser(env.DB, request)
    if (!user) return error(401, 'Sign in to continue')
    handled.userId = user.id
    const source = clientOf(request)
    if (bot) return await handleTelegram(env, ctx, bot, request, user, rawId, () => readJson(request))
    if (isUsage) {
      if (request.method !== 'POST') return error(405, 'Method not allowed')
      handled.reported = parseUsageReport(await readJson(request))
      return new Response(null, { status: 204 })
    }
    if (isEvents) {
      if (request.method !== 'GET') return error(405, 'Method not allowed')
      return json(await listEvents(env.DB, user.id, parseEventQuery(url.searchParams)))
    }
    if (isSettings) {
      const loadState = async () => {
        const [tasks, projects] = await Promise.all([listTasks(env.DB, user.id), listProjects(env.DB, user.id)])
        return { tasks, projects }
      }
      return json(await handleSettings(env.DB, request, user.id, rawId, () => readJson(request), loadState))
    }
    if (isPlanning) {
      if (request.method !== 'GET') return error(405, 'Method not allowed')
      return json(await planning(env.DB, user.id, name as 'priorities' | 'forecast', parseToday(url.searchParams)))
    }
    if (!resource) return await handleGoogle(env, request, user, [rawId, ...rest], () => readJson(request))
    const id = rawId ? decodeId(rawId) : undefined
    if (isImport) {
      if (!id || request.method !== 'POST') return error(405, 'Method not allowed')
      return json(await importTasks(env.DB, user.id, id, await readJson(request, MAX_IMPORT_BODY_BYTES), source))
    }
    if (isPatch) {
      const { patch, projectIds, deliveryDates, today } = parseTaskPatch(await readJson(request), id!)
      const plan = (state: State) => {
        const stored = state.tasks.find((t) => t.id === id)
        if (!stored) throw new UnknownReference('task', id!)
        // Checked whole, as a PUT is; only the sync sets the Google account, so it's kept
        const task = parseTask(applyTaskPatch(stored, patch), id!)
        const saved = stored.googleAccount ? { ...task, googleAccount: stored.googleAccount } : task
        return planTaskSave(state, { task: saved, projectIds, deliveryDates, today })
      }
      return json(await saveWithRules(env.DB, user.id, plan, { tasks: [], projects: [] }, source))
    }
    if (isAction) {
      if (!id || request.method !== 'POST') return error(405, 'Method not allowed')
      const action = parseTaskAction(await readJson(request))
      const plan = (state: State) => planTaskAction(state, id, action)
      return json(await saveWithRules(env.DB, user.id, plan, { tasks: [], projects: [] }, source))
    }
    if (!id && request.method === 'GET') return json(await resource.list(env.DB, user.id))
    if (id && request.method === 'PUT') {
      return json(await resource.save(env.DB, user.id, id, await readJson(request), source))
    }
    if (id && request.method === 'DELETE') {
      check(!(name === 'tags' && id === ARCHIVE_TAG_ID), 'The Archive tag is built in and cannot be deleted')
      await resource.remove(env.DB, user.id, id, source)
      return new Response(null, { status: 204 })
    }
    return error(405, 'Method not allowed')
  } catch (e) {
    if (e instanceof Conflict) return json({ error: e.message, clashes: e.clashes }, e.status)
    if (e instanceof LoopRefused) return json({ error: e.message, loop: e.loop }, e.status)
    if (e instanceof HttpError) return error(e.status, e.message)
    if (e instanceof UnknownReference) return error(e.kind === 'task' && (isAction || isPatch) ? 404 : 400, e.message)
    if (e instanceof ActionRefused) return json({ error: e.message, ...e.sentence }, 400)
    // Like a clash: the save breaks a rule between the errand and other tasks or projects
    if (e instanceof ErrandRefused) return json({ error: e.message, ...e.sentence }, 409)
    if (String(e).includes('FOREIGN KEY constraint failed')) {
      return error(400, 'References a task or tag that does not exist')
    }
    if (String(e).includes('UNIQUE constraint failed: tags.user_id, tags.name')) {
      return error(400, 'There is already a tag with that name')
    }
    if (String(e).includes('UNIQUE constraint failed: users.email')) {
      return error(400, 'There is already an account with that email')
    }
    console.error(e)
    return error(500, 'Internal error')
  }
}

export default {
  // Answers the request, then counts it if it was an action a person took (worker/usage.ts)
  async fetch(request, env, ctx) {
    const handled: Handled = {}
    const response = await handle(request, env, ctx, handled)
    const [, , name, rawId, ...rest] = new URL(request.url).pathname.split('/')
    countRequest(ctx, env.DB, request, response, handled.userId, routeOf(name, rawId, rest), handled.reported)
    return response
  },

  // The Cron Trigger in wrangler.jsonc, every 15 minutes: sends the Telegram morning briefs that are
  // due. The run's scheduled time is the clock everything else is worked out from.
  async scheduled(controller, env) {
    const bot = botConfig(env)
    if (!bot) return
    await migrateOnce(env.DB)
    await sendBriefs(env.DB, bot, pamData, new Date(controller.scheduledTime))
  },
} satisfies ExportedHandler<Env>
