// API for storing projects and tasks in D1 (tables in migrations/, created by migrate.ts on
// the first request). Requests outside /api/* never reach this Worker: they are served
// from the built Vue app (see wrangler.jsonc).
//
//   GET    /api/projects       -> Project[]
//   PUT    /api/projects/:id   -> saves the Project in the body, returns it
//   DELETE /api/projects/:id   -> 204
//
// and the same for /api/tasks and /api/tags, plus the sign-in routes in auth.ts. Each object is
// split across its own table and the tables holding its arrays when saved, and put back together
// when read.
//
// Every route but /api/auth needs a signed-in user, and only reads and writes that user's rows:
// every query has a user_id, which comes from the session, never from the request.
//
// Every value from a request is passed to D1 as a bound parameter (?1, ?2, ...), never written
// into the SQL itself, so it can't change what a query does. The only SQL built from variables
// uses constants: NOW, and table names from RESOURCES.
import {
  isSafeUrl,
  LINK_PROTOCOLS,
  MAX_DESCRIPTION_LENGTH,
  MAX_ID_LENGTH,
  MAX_LIST_LENGTH,
  MAX_NAME_LENGTH,
  MAX_URL_LENGTH,
} from '../src/types/limits'
import {
  PRIORITIES,
  RELATION_TYPES,
  type Priority,
  type RelationType,
  type Task,
  type TaskRelation,
} from '../src/types/task'
import type { Project, ReferenceLink } from '../src/types/project'
import { ARCHIVE_TAG_ID, DEFAULT_TAG_COLOR, isHexColor, type Tag } from '../src/types/tag'
import { currentUser, handleAuth, HttpError } from './auth'
import { migrateOnce } from './migrate'

const MAX_BODY_BYTES = 100_000
const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`

// Thrown for requests that can't be stored; becomes a 400 response
class BadRequest extends HttpError {
  constructor(message: string) {
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
const isDateOrNull = (value: unknown): value is string | null =>
  value === null || (isString(value) && /^\d{4}-\d{2}-\d{2}$/.test(value))
const isList = (value: unknown): value is unknown[] => Array.isArray(value) && value.length <= MAX_LIST_LENGTH
const oneOf = <T>(values: readonly T[], value: unknown): value is T =>
  (values as readonly unknown[]).includes(value)
const allDifferent = (values: unknown[]) => new Set(values).size === values.length
const isRelation = (value: unknown): value is TaskRelation =>
  isObject(value) && isId(value.taskId) && oneOf(RELATION_TYPES, value.type)
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

function parseTask(body: unknown, id: string): Task {
  checkCommon(body, id)
  const { dueDate, completed, relations } = body
  check(isDateOrNull(dueDate), 'dueDate must be null or a YYYY-MM-DD date')
  check(typeof completed === 'boolean', 'completed must be true or false')
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
  const [tasks, relations] = (await db.batch([
    db.prepare('SELECT * FROM tasks WHERE user_id = ?1 ORDER BY created_at, id').bind(userId),
    db.prepare('SELECT * FROM task_relations WHERE user_id = ?1 ORDER BY task_id, position').bind(userId),
  ])) as [D1Result<TaskRow>, D1Result<RelationRow>]
  const relationsByTask = groupBy(relations.results, (r) => r.task_id)

  return tasks.results.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    dueDate: row.due_date,
    relations: (relationsByTask.get(row.id) ?? []).map((r) => ({ taskId: r.related_task_id, type: r.type })),
    priority: row.priority,
    completed: row.completed === 1,
  }))
}

// Runs as one transaction: the task row is upserted (not replaced, which would cascade
// and drop it from its projects) and its relations are rewritten
async function saveTask(db: D1Database, userId: string, task: Task): Promise<Task> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO tasks (id, name, description, due_date, priority, completed, user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (user_id, id) DO UPDATE SET name = excluded.name, description = excluded.description,
           due_date = excluded.due_date, priority = excluded.priority, completed = excluded.completed,
           updated_at = ${NOW}`,
      )
      .bind(task.id, task.name, task.description, task.dueDate, task.priority, task.completed ? 1 : 0, userId),
    db.prepare('DELETE FROM task_relations WHERE user_id = ?1 AND task_id = ?2').bind(userId, task.id),
    ...task.relations.map((relation, position) =>
      db
        .prepare(
          'INSERT INTO task_relations (user_id, task_id, related_task_id, type, position) VALUES (?1, ?2, ?3, ?4, ?5)',
        )
        .bind(userId, task.id, relation.taskId, relation.type, position),
    ),
  ])
  return task
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

// Runs as one transaction, like saveTask
async function saveProject(db: D1Database, userId: string, project: Project): Promise<Project> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO projects (id, name, description, delivery_date, priority, user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (user_id, id) DO UPDATE SET name = excluded.name, description = excluded.description,
           delivery_date = excluded.delivery_date, priority = excluded.priority, updated_at = ${NOW}`,
      )
      .bind(project.id, project.name, project.description, project.deliveryDate, project.priority, userId),
    db.prepare('DELETE FROM project_tasks WHERE user_id = ?1 AND project_id = ?2').bind(userId, project.id),
    ...project.taskIds.map((taskId, position) =>
      db
        .prepare('INSERT INTO project_tasks (user_id, project_id, task_id, position) VALUES (?1, ?2, ?3, ?4)')
        .bind(userId, project.id, taskId, position),
    ),
    db.prepare('DELETE FROM project_links WHERE user_id = ?1 AND project_id = ?2').bind(userId, project.id),
    ...project.links.map((link, position) =>
      db
        .prepare('INSERT INTO project_links (user_id, project_id, position, label, url) VALUES (?1, ?2, ?3, ?4, ?5)')
        .bind(userId, project.id, position, link.label, link.url),
    ),
    db.prepare('DELETE FROM project_tags WHERE user_id = ?1 AND project_id = ?2').bind(userId, project.id),
    ...project.tagIds.map((tagId, position) =>
      db
        .prepare('INSERT INTO project_tags (user_id, project_id, tag_id, position) VALUES (?1, ?2, ?3, ?4)')
        .bind(userId, project.id, tagId, position),
    ),
  ])
  return project
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
async function saveTag(db: D1Database, userId: string, tag: TagBody): Promise<Tag> {
  return (await db
    .prepare(
      `INSERT INTO tags (user_id, id, name, color) VALUES (?1, ?2, ?3, coalesce(?4, ?5))
       ON CONFLICT (user_id, id) DO UPDATE SET name = excluded.name, color = coalesce(?4, color),
         updated_at = ${NOW}
       RETURNING id, name, color`,
    )
    .bind(userId, tag.id, tag.name, tag.color ?? null, DEFAULT_TAG_COLOR)
    .first<Tag>())!
}

// Routing

interface Resource {
  table: string // deleting from it cascades to the tables holding its arrays
  list(db: D1Database, userId: string): Promise<unknown[]>
  save(db: D1Database, userId: string, id: string, body: unknown): Promise<unknown>
}

const RESOURCES: Record<string, Resource> = {
  tasks: {
    table: 'tasks',
    list: listTasks,
    save: (db, userId, id, body) => saveTask(db, userId, parseTask(body, id)),
  },
  projects: {
    table: 'projects',
    list: listProjects,
    save: (db, userId, id, body) => saveProject(db, userId, parseProject(body, id)),
  },
  // Deleting a tag removes it from its projects
  tags: {
    table: 'tags',
    list: listTags,
    save: (db, userId, id, body) => saveTag(db, userId, parseTag(body, id)),
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
async function readJson(request: Request): Promise<unknown> {
  const type = request.headers.get('Content-Type') ?? ''
  check(type.split(';')[0]!.trim().toLowerCase() === 'application/json', 'Body must be sent as application/json')
  const text = await request.text()
  check(text.length <= MAX_BODY_BYTES, 'Body too large')
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

export default {
  async fetch(request, env) {
    // e.g. "/api/tasks/abc" -> ["", "api", "tasks", "abc"]
    const [, api, name, rawId, ...rest] = new URL(request.url).pathname.split('/')
    const resource = name !== undefined && Object.hasOwn(RESOURCES, name) ? RESOURCES[name] : undefined
    if (api !== 'api' || !(resource || name === 'auth') || rest.length > 0) return error(404, 'Not found')

    try {
      await migrateOnce(env.DB)
      if (!resource) return await handleAuth(env.DB, request, rawId, () => readJson(request))

      const user = await currentUser(env.DB, request)
      if (!user) return error(401, 'Sign in to continue')
      const id = rawId ? decodeId(rawId) : undefined
      if (!id && request.method === 'GET') return json(await resource.list(env.DB, user.id))
      if (id && request.method === 'PUT') {
        return json(await resource.save(env.DB, user.id, id, await readJson(request)))
      }
      if (id && request.method === 'DELETE') {
        check(!(name === 'tags' && id === ARCHIVE_TAG_ID), 'The Archive tag is built in and cannot be deleted')
        await env.DB.prepare(`DELETE FROM ${resource.table} WHERE user_id = ?1 AND id = ?2`).bind(user.id, id).run()
        return new Response(null, { status: 204 })
      }
      return error(405, 'Method not allowed')
    } catch (e) {
      if (e instanceof HttpError) return error(e.status, e.message)
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
  },
} satisfies ExportedHandler<Env>
