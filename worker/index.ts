// API for storing projects and tasks in D1 (tables in migrations/, created by migrate.ts on
// the first request). Requests outside /api/* never reach this Worker: they are served
// from the built Vue app (see wrangler.jsonc).
//
//   GET    /api/projects       -> Project[]
//   PUT    /api/projects/:id   -> saves the Project in the body, returns it
//   DELETE /api/projects/:id   -> 204
//
// and the same for /api/tasks and /api/tags. Each object is split across its own table and
// the tables holding its arrays when saved, and put back together when read.
import {
  PRIORITIES,
  RELATION_TYPES,
  type Priority,
  type RelationType,
  type Task,
  type TaskRelation,
} from '../src/types/task'
import type { Project, ReferenceLink } from '../src/types/project'
import { ARCHIVE_TAG_ID, type Tag } from '../src/types/tag'
import { migrateOnce } from './migrate'

const MAX_BODY_BYTES = 100_000
const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`

// Thrown for requests that can't be stored; becomes a 400 response
class BadRequest extends Error {}

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
const isDateOrNull = (value: unknown): value is string | null =>
  value === null || (isString(value) && /^\d{4}-\d{2}-\d{2}$/.test(value))
const oneOf = <T>(values: readonly T[], value: unknown): value is T =>
  (values as readonly unknown[]).includes(value)
const allDifferent = (values: unknown[]) => new Set(values).size === values.length
const isRelation = (value: unknown): value is TaskRelation =>
  isObject(value) && isString(value.taskId) && oneOf(RELATION_TYPES, value.type)
const isLink = (value: unknown): value is ReferenceLink =>
  isObject(value) && isString(value.label) && isString(value.url)

// Fields that projects and tasks share
function checkCommon(
  body: unknown,
  id: string,
): asserts body is Record<string, unknown> & { name: string; description: string; priority: Priority } {
  check(isObject(body), 'Body must be a JSON object')
  check(body.id === id, 'id must match the URL')
  check(isString(body.name) && body.name.trim() !== '', 'name must be a non-empty string')
  check(isString(body.description), 'description must be a string')
  check(oneOf(PRIORITIES, body.priority), `priority must be one of ${PRIORITIES.join(', ')}`)
}

function parseTask(body: unknown, id: string): Task {
  checkCommon(body, id)
  const { dueDate, completed, relations } = body
  check(isDateOrNull(dueDate), 'dueDate must be null or a YYYY-MM-DD date')
  check(typeof completed === 'boolean', 'completed must be true or false')
  check(
    Array.isArray(relations) && relations.every(isRelation),
    `relations must be a list of { taskId, type } with type one of ${RELATION_TYPES.join(', ')}`,
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
  check(Array.isArray(tagIds) && tagIds.every(isString), 'tagIds must be a list of tag ids')
  check(allDifferent(tagIds), 'tagIds must not list a tag twice')
  check(Array.isArray(taskIds) && taskIds.every(isString), 'taskIds must be a list of task ids')
  check(allDifferent(taskIds), 'taskIds must not list a task twice')
  check(Array.isArray(links) && links.every(isLink), 'links must be a list of { label, url }')

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

function parseTag(body: unknown, id: string): Tag {
  check(isObject(body), 'Body must be a JSON object')
  check(body.id === id, 'id must match the URL')
  check(isString(body.name) && body.name.trim() !== '', 'name must be a non-empty string')
  return { id, name: body.name.trim() }
}

// Tasks

async function listTasks(db: D1Database): Promise<Task[]> {
  const [tasks, relations] = (await db.batch([
    db.prepare('SELECT * FROM tasks ORDER BY created_at, id'),
    db.prepare('SELECT * FROM task_relations ORDER BY task_id, position'),
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
async function saveTask(db: D1Database, task: Task): Promise<Task> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO tasks (id, name, description, due_date, priority, completed)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, description = excluded.description,
           due_date = excluded.due_date, priority = excluded.priority, completed = excluded.completed,
           updated_at = ${NOW}`,
      )
      .bind(task.id, task.name, task.description, task.dueDate, task.priority, task.completed ? 1 : 0),
    db.prepare('DELETE FROM task_relations WHERE task_id = ?1').bind(task.id),
    ...task.relations.map((relation, position) =>
      db
        .prepare('INSERT INTO task_relations (task_id, related_task_id, type, position) VALUES (?1, ?2, ?3, ?4)')
        .bind(task.id, relation.taskId, relation.type, position),
    ),
  ])
  return task
}

// Projects

async function listProjects(db: D1Database): Promise<Project[]> {
  const [projects, projectTasks, links, projectTags] = (await db.batch([
    db.prepare('SELECT * FROM projects ORDER BY created_at, id'),
    db.prepare('SELECT * FROM project_tasks ORDER BY project_id, position'),
    db.prepare('SELECT * FROM project_links ORDER BY project_id, position'),
    db.prepare('SELECT * FROM project_tags ORDER BY project_id, position'),
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
async function saveProject(db: D1Database, project: Project): Promise<Project> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO projects (id, name, description, delivery_date, priority)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, description = excluded.description,
           delivery_date = excluded.delivery_date, priority = excluded.priority, updated_at = ${NOW}`,
      )
      .bind(project.id, project.name, project.description, project.deliveryDate, project.priority),
    db.prepare('DELETE FROM project_tasks WHERE project_id = ?1').bind(project.id),
    ...project.taskIds.map((taskId, position) =>
      db
        .prepare('INSERT INTO project_tasks (project_id, task_id, position) VALUES (?1, ?2, ?3)')
        .bind(project.id, taskId, position),
    ),
    db.prepare('DELETE FROM project_links WHERE project_id = ?1').bind(project.id),
    ...project.links.map((link, position) =>
      db
        .prepare('INSERT INTO project_links (project_id, position, label, url) VALUES (?1, ?2, ?3, ?4)')
        .bind(project.id, position, link.label, link.url),
    ),
    db.prepare('DELETE FROM project_tags WHERE project_id = ?1').bind(project.id),
    ...project.tagIds.map((tagId, position) =>
      db
        .prepare('INSERT INTO project_tags (project_id, tag_id, position) VALUES (?1, ?2, ?3)')
        .bind(project.id, tagId, position),
    ),
  ])
  return project
}

// Tags

async function listTags(db: D1Database): Promise<Tag[]> {
  const { results } = await db.prepare('SELECT id, name FROM tags ORDER BY name, id').all<Tag>()
  return results
}

async function saveTag(db: D1Database, tag: Tag): Promise<Tag> {
  await db
    .prepare(
      `INSERT INTO tags (id, name) VALUES (?1, ?2)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, updated_at = ${NOW}`,
    )
    .bind(tag.id, tag.name)
    .run()
  return tag
}

// Routing

interface Resource {
  table: string // deleting from it cascades to the tables holding its arrays
  list(db: D1Database): Promise<unknown[]>
  save(db: D1Database, id: string, body: unknown): Promise<unknown>
}

const RESOURCES: Record<string, Resource> = {
  tasks: { table: 'tasks', list: listTasks, save: (db, id, body) => saveTask(db, parseTask(body, id)) },
  projects: {
    table: 'projects',
    list: listProjects,
    save: (db, id, body) => saveProject(db, parseProject(body, id)),
  },
  // Deleting a tag removes it from its projects
  tags: { table: 'tags', list: listTags, save: (db, id, body) => saveTag(db, parseTag(body, id)) },
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

function error(status: number, message: string) {
  return json({ error: message }, status)
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text()
  check(text.length <= MAX_BODY_BYTES, 'Body too large')
  try {
    return JSON.parse(text)
  } catch {
    throw new BadRequest('Body must be JSON')
  }
}

export default {
  async fetch(request, env) {
    // e.g. "/api/tasks/abc" -> ["", "api", "tasks", "abc"]
    const [, api, name, rawId, ...rest] = new URL(request.url).pathname.split('/')
    const resource = name !== undefined && Object.hasOwn(RESOURCES, name) ? RESOURCES[name] : undefined
    if (api !== 'api' || !resource || rest.length > 0) return error(404, 'Not found')
    const id = rawId ? decodeURIComponent(rawId) : undefined

    try {
      await migrateOnce(env.DB)
      if (!id && request.method === 'GET') return json(await resource.list(env.DB))
      if (id && request.method === 'PUT') return json(await resource.save(env.DB, id, await readJson(request)))
      if (id && request.method === 'DELETE') {
        check(!(name === 'tags' && id === ARCHIVE_TAG_ID), 'The Archive tag is built in and cannot be deleted')
        await env.DB.prepare(`DELETE FROM ${resource.table} WHERE id = ?1`).bind(id).run()
        return new Response(null, { status: 204 })
      }
      return error(405, 'Method not allowed')
    } catch (e) {
      if (e instanceof BadRequest) return error(400, e.message)
      if (String(e).includes('FOREIGN KEY constraint failed')) {
        return error(400, 'References a task or tag that does not exist')
      }
      if (String(e).includes('UNIQUE constraint failed: tags.name')) {
        return error(400, 'There is already a tag with that name')
      }
      console.error(e)
      return error(500, 'Internal error')
    }
  },
} satisfies ExportedHandler<Env>
