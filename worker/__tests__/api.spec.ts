// Integration tests: HTTP requests through the Worker's entry point, against a real D1
// database with the tables from migrations/ (emptied before each test by setup.ts).
import { env, SELF } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import type { Project } from '../../src/types/project'
import type { Tag } from '../../src/types/tag'
import type { Task } from '../../src/types/task'

async function call(method: string, path: string, body?: unknown) {
  const response = await SELF.fetch(`http://localhost/api/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

const listTasks = async (): Promise<Task[]> => (await call('GET', 'tasks')).body
const listProjects = async (): Promise<Project[]> => (await call('GET', 'projects')).body
const saveTask = (task: Task) => call('PUT', `tasks/${task.id}`, task)
const saveProject = (project: Project) => call('PUT', `projects/${project.id}`, project)

const task = (id: string, fields: Partial<Task> = {}): Task => ({
  id,
  name: `Task ${id}`,
  description: '',
  dueDate: null,
  relations: [],
  priority: 'medium',
  completed: false,
  ...fields,
})

const project = (id: string, fields: Partial<Project> = {}): Project => ({
  id,
  name: `Project ${id}`,
  description: '',
  deliveryDate: null,
  taskIds: [],
  priority: 'medium',
  links: [],
  tagIds: [],
  ...fields,
})

const listTags = async (): Promise<Tag[]> => (await call('GET', 'tags')).body
const saveTag = (tag: Tag) => call('PUT', `tags/${tag.id}`, tag)

const count = async (table: string) =>
  (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())!.n

describe('routing', () => {
  it('starts with no projects or tasks', async () => {
    expect(await call('GET', 'projects')).toEqual({ status: 200, body: [] })
    expect(await call('GET', 'tasks')).toEqual({ status: 200, body: [] })
  })

  it.each([['users'], ['tasks/a/b'], ['']])('answers 404 for /api/%s', async (path) => {
    expect((await call('GET', path)).status).toBe(404)
  })

  it.each([
    ['POST', 'tasks'],
    ['PUT', 'tasks'],
    ['GET', 'tasks/a'],
    ['PATCH', 'projects/a'],
  ])('answers 405 for %s /api/%s', async (method, path) => {
    expect((await call(method, path)).status).toBe(405)
  })

  it('decodes ids in the URL', async () => {
    const t = task('id with spaces/and slash')
    expect((await call('PUT', `tasks/${encodeURIComponent(t.id)}`, t)).status).toBe(200)
    expect(await listTasks()).toEqual([t])
  })
})

describe('tasks', () => {
  it('stores every field and returns it unchanged', async () => {
    await saveTask(task('b'))
    await saveTask(task('c'))
    const t = task('a', {
      name: 'Write report',
      description: 'line 1\nline 2',
      dueDate: '2026-11-02',
      relations: [
        { taskId: 'c', type: 'blocks' },
        { taskId: 'b', type: 'subtask_of' },
      ],
      priority: 'urgent',
      completed: true,
    })

    expect(await saveTask(t)).toEqual({ status: 200, body: t })
    expect((await listTasks()).find((x) => x.id === 'a')).toEqual(t)
  })

  it('stores each field in its own column and relations in their own table', async () => {
    await saveTask(task('b'))
    await saveTask(task('a', { name: 'A', dueDate: '2026-11-02', priority: 'high', completed: true, relations: [{ taskId: 'b', type: 'blocks' }] }))

    expect(await env.DB.prepare("SELECT name, due_date, priority, completed FROM tasks WHERE id = 'a'").first()).toEqual({
      name: 'A',
      due_date: '2026-11-02',
      priority: 'high',
      completed: 1,
    })
    expect((await env.DB.prepare('SELECT * FROM task_relations').all()).results).toEqual([
      { task_id: 'a', related_task_id: 'b', type: 'blocks', position: 0 },
    ])
  })

  it('drops fields that are not part of a task', async () => {
    const response = await call('PUT', 'tasks/a', { ...task('a'), extra: 'ignored' })
    expect(response.body).toEqual(task('a'))
  })

  it('lists tasks in the order they were created, and updating keeps that order', async () => {
    await saveTask(task('z'))
    await saveTask(task('a'))
    await saveTask(task('z', { name: 'Updated' }))
    expect((await listTasks()).map((t) => t.id)).toEqual(['z', 'a'])
  })

  it('replaces relations when a task is saved again', async () => {
    await saveTask(task('b'))
    await saveTask(task('c'))
    await saveTask(task('a', { relations: [{ taskId: 'b', type: 'blocks' }] }))
    await saveTask(task('a', { relations: [{ taskId: 'c', type: 'related_to' }] }))

    expect((await listTasks()).find((t) => t.id === 'a')!.relations).toEqual([{ taskId: 'c', type: 'related_to' }])
    expect(await count('task_relations')).toBe(1)
  })

  it('keeps created_at and moves updated_at when a task is updated', async () => {
    await saveTask(task('a'))
    const before = await env.DB.prepare("SELECT created_at, updated_at FROM tasks WHERE id = 'a'").first<{ created_at: string; updated_at: string }>()
    await new Promise((resolve) => setTimeout(resolve, 5))
    await saveTask(task('a', { name: 'Renamed' }))
    const after = await env.DB.prepare("SELECT created_at, updated_at FROM tasks WHERE id = 'a'").first<{ created_at: string; updated_at: string }>()

    expect(after!.created_at).toBe(before!.created_at)
    expect(after!.updated_at > before!.updated_at).toBe(true)
  })

  it('keeps a task in its projects when the task is updated', async () => {
    await saveTask(task('a'))
    await saveProject(project('p', { taskIds: ['a'] }))
    await saveTask(task('a', { name: 'Renamed', completed: true }))

    expect((await listProjects())[0]!.taskIds).toEqual(['a'])
  })
})

describe('projects', () => {
  it('stores every field and returns it unchanged, keeping array order', async () => {
    await saveTask(task('t1'))
    await saveTask(task('t2'))
    const p = project('p', {
      name: 'Thesis',
      description: 'Final year project',
      deliveryDate: '2027-01-18',
      taskIds: ['t2', 't1'],
      priority: 'urgent',
      links: [
        { label: 'Repo', url: 'https://example.com/repo' },
        { label: 'Docs', url: 'https://example.com/docs' },
      ],
    })

    expect(await saveProject(p)).toEqual({ status: 200, body: p })
    expect(await listProjects()).toEqual([p])
  })

  it('replaces tasks and links when a project is saved again', async () => {
    await saveTask(task('t1'))
    await saveTask(task('t2'))
    await saveProject(project('p', { taskIds: ['t1', 't2'], links: [{ label: 'A', url: 'https://a' }, { label: 'B', url: 'https://b' }] }))
    await saveProject(project('p', { taskIds: ['t2'], links: [{ label: 'C', url: 'https://c' }] }))

    expect(await listProjects()).toEqual([project('p', { taskIds: ['t2'], links: [{ label: 'C', url: 'https://c' }] })])
    expect(await count('project_tasks')).toBe(1)
    expect(await count('project_links')).toBe(1)
  })

  it('lets a task belong to several projects', async () => {
    await saveTask(task('t'))
    await saveProject(project('p1', { taskIds: ['t'] }))
    await saveProject(project('p2', { taskIds: ['t'] }))

    expect((await listProjects()).map((p) => p.taskIds)).toEqual([['t'], ['t']])
  })
})

describe('tags', () => {
  it('stores tags and lists them by name, ignoring case', async () => {
    await saveTag({ id: 'w', name: 'work' })
    expect(await saveTag({ id: 's', name: 'School (SUTD)' })).toEqual({ status: 200, body: { id: 's', name: 'School (SUTD)' } })
    await saveTag({ id: 'p', name: 'Personal' })

    expect((await listTags()).map((t) => t.name)).toEqual(['Personal', 'School (SUTD)', 'work'])
  })

  it('trims names and renames a tag when saved again', async () => {
    await saveTag({ id: 'w', name: 'Work' })
    expect((await saveTag({ id: 'w', name: '  Job  ' })).body).toEqual({ id: 'w', name: 'Job' })
    expect(await listTags()).toEqual([{ id: 'w', name: 'Job' }])
  })

  it('rejects a name another tag already has, ignoring case', async () => {
    await saveTag({ id: 'w', name: 'Work' })
    await saveTag({ id: 'p', name: 'Personal' })

    expect(await saveTag({ id: 'x', name: 'WORK' })).toEqual({
      status: 400,
      body: { error: 'There is already a tag with that name' },
    })
    expect((await saveTag({ id: 'p', name: 'work' })).status).toBe(400)
    expect(await listTags()).toEqual([
      { id: 'p', name: 'Personal' },
      { id: 'w', name: 'Work' },
    ])
  })

  it.each<[string, unknown]>([
    ['a blank name', { id: 't', name: '  ' }],
    ['no name', { id: 't' }],
    ['an id that does not match the URL', { id: 'other', name: 'Work' }],
  ])('rejects a tag with %s', async (_, body) => {
    expect((await call('PUT', 'tags/t', body)).status).toBe(400)
    expect(await listTags()).toEqual([])
  })

  it("stores a project's tags in order and changes them", async () => {
    await saveTag({ id: 'w', name: 'Work' })
    await saveTag({ id: 's', name: 'School' })
    await saveProject(project('p', { tagIds: ['w', 's'] }))
    expect(await listProjects()).toEqual([project('p', { tagIds: ['w', 's'] })])

    await saveProject(project('p', { tagIds: ['s'] }))
    expect((await listProjects())[0]!.tagIds).toEqual(['s'])
    await saveProject(project('p', { tagIds: [] }))
    expect((await listProjects())[0]!.tagIds).toEqual([])
  })

  it.each<[string, unknown]>([
    ['a tag id that is not a string', [3]],
    ['the same tag twice', ['w', 'w']],
    ['no tag list', undefined],
  ])('rejects a project with %s', async (_, tagIds) => {
    await saveTag({ id: 'w', name: 'Work' })
    expect((await call('PUT', 'projects/p', { ...project('p'), tagIds })).status).toBe(400)
    expect(await listProjects()).toEqual([])
  })

  it('rejects a project with a tag that does not exist, saving nothing', async () => {
    expect(await saveProject(project('p', { tagIds: ['missing'] }))).toEqual({
      status: 400,
      body: { error: 'References a task or tag that does not exist' },
    })
    expect(await listProjects()).toEqual([])
  })

  it('removes a deleted tag from its projects, keeping their other tags', async () => {
    await saveTag({ id: 'w', name: 'Work' })
    await saveTag({ id: 's', name: 'School' })
    await saveProject(project('p', { tagIds: ['w', 's'] }))

    expect((await call('DELETE', 'tags/w')).status).toBe(204)

    expect(await listTags()).toEqual([{ id: 's', name: 'School' }])
    expect(await listProjects()).toEqual([project('p', { tagIds: ['s'] })])
  })

  it('refuses to delete the built-in Archive tag, but renames it', async () => {
    await saveTag({ id: 'archive', name: 'Archive' })
    expect(await call('DELETE', 'tags/archive')).toEqual({
      status: 400,
      body: { error: 'The Archive tag is built in and cannot be deleted' },
    })
    expect((await saveTag({ id: 'archive', name: 'Done' })).status).toBe(200)
    expect(await listTags()).toEqual([{ id: 'archive', name: 'Done' }])
  })
})

describe('validation', () => {
  it.each<[string, Record<string, unknown>]>([
    ['an unknown priority', { priority: 'asap' }],
    ['a date in another format', { dueDate: '02/11/2026' }],
    ['a blank name', { name: '   ' }],
    ['a missing description', { description: undefined }],
    ['completed that is not a boolean', { completed: 'yes' }],
    ['relations that are not a list', { relations: 'b' }],
    ['a relation with an unknown type', { relations: [{ taskId: 'b', type: 'depends_on' }] }],
    ['the same task related twice', { relations: [{ taskId: 'b', type: 'blocks' }, { taskId: 'b', type: 'related_to' }] }],
    ['a relation to itself', { relations: [{ taskId: 'a', type: 'blocks' }] }],
    ['a name over 200 characters', { name: 'x'.repeat(201) }],
    ['a description over 10,000 characters', { description: 'x'.repeat(10_001) }],
    ['over 500 relations', { relations: Array.from({ length: 501 }, (_, i) => ({ taskId: `t${i}`, type: 'blocks' })) }],
  ])('rejects a task with %s', async (_, fields) => {
    await saveTask(task('b'))
    const response = await call('PUT', 'tasks/a', { ...task('a'), ...fields })
    expect(response.status).toBe(400)
    expect(response.body.error).toEqual(expect.any(String))
    expect((await listTasks()).map((t) => t.id)).toEqual(['b'])
  })

  it.each<[string, Record<string, unknown>]>([
    ['an unknown priority', { priority: 'top' }],
    ['a date in another format', { deliveryDate: '2027-1-18' }],
    ['taskIds that are not strings', { taskIds: [1] }],
    ['the same task twice', { taskIds: ['t', 't'] }],
    ['a link without a url', { links: [{ label: 'Repo' }] }],
    ['a javascript: link', { links: [{ label: 'Repo', url: 'javascript:alert(document.cookie)' }] }],
    ['a javascript: link hidden by case and whitespace', { links: [{ label: 'Repo', url: ' JavaScript:alert(1)' }] }],
    ['a data: link', { links: [{ label: 'Repo', url: 'data:text/html,<script>alert(1)</script>' }] }],
    ['a link that is not a full URL', { links: [{ label: 'Repo', url: 'example.com' }] }],
    ['a link url over 2,000 characters', { links: [{ label: 'Repo', url: `https://example.com/${'x'.repeat(2_000)}` }] }],
    ['a link label over 200 characters', { links: [{ label: 'x'.repeat(201), url: 'https://example.com' }] }],
  ])('rejects a project with %s', async (_, fields) => {
    await saveTask(task('t'))
    const response = await call('PUT', 'projects/p', { ...project('p'), ...fields })
    expect(response.status).toBe(400)
    expect(await listProjects()).toEqual([])
  })

  it.each<[string, unknown]>([
    ['is not JSON', 'not json'],
    ['is a JSON array', [task('a')]],
    ['is null', 'null'],
    ['has an id that does not match the URL', task('other')],
    ['is larger than 100 KB', task('a', { description: 'x'.repeat(100_001) })],
  ])('rejects a body that %s', async (_, body) => {
    expect((await call('PUT', 'tasks/a', body)).status).toBe(400)
    expect(await listTasks()).toEqual([])
  })

  it('accepts http, https and mailto links', async () => {
    const links = [
      { label: 'Web', url: 'http://example.com' },
      { label: 'Secure', url: 'https://example.com/a?b=c#d' },
      { label: 'Email', url: 'mailto:me@example.com' },
    ]
    expect((await saveProject(project('p', { links }))).status).toBe(200)
  })

  it.each<[string, string | undefined]>([
    ['as a form', 'application/x-www-form-urlencoded'],
    ['as plain text', 'text/plain'],
    ['with no type', undefined],
  ])('rejects a body sent %s', async (_, type) => {
    const response = await SELF.fetch('http://localhost/api/tasks/a', {
      method: 'PUT',
      headers: type ? { 'Content-Type': type } : {},
      body: JSON.stringify(task('a')),
    })
    expect(response.status).toBe(400)
    expect(await listTasks()).toEqual([])
  })

  it('accepts JSON with a charset', async () => {
    const response = await SELF.fetch('http://localhost/api/tasks/a', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(task('a')),
    })
    expect(response.status).toBe(200)
  })

  it.each([
    ['is not correctly encoded', 'tasks/%E0%A4%A'],
    ['is over 100 characters', `tasks/${'x'.repeat(101)}`],
  ])('answers 400 for an id that %s', async (_, path) => {
    expect((await call('DELETE', path)).status).toBe(400)
  })

  it('stores text that looks like SQL as it is, without running it', async () => {
    const name = "'); DROP TABLE tasks; --"
    await saveTask(task('a', { name, description: "' OR 1=1 --" }))
    await saveTask(task("b' OR '1'='1"))
    await call('DELETE', `tasks/${encodeURIComponent("x' OR '1'='1")}`)

    expect((await listTasks()).map((t) => [t.id, t.name])).toEqual([
      ['a', name],
      ["b' OR '1'='1", "Task b' OR '1'='1"],
    ])
  })

  it('rejects a relation to a task that does not exist', async () => {
    const response = await saveTask(task('a', { relations: [{ taskId: 'missing', type: 'blocks' }] }))
    expect(response).toEqual({ status: 400, body: { error: 'References a task or tag that does not exist' } })
  })

  it('rejects a project with a task that does not exist', async () => {
    const response = await saveProject(project('p', { taskIds: ['missing'] }))
    expect(response).toEqual({ status: 400, body: { error: 'References a task or tag that does not exist' } })
  })

  it('leaves the stored task untouched when an update fails part way', async () => {
    await saveTask(task('b'))
    const original = task('a', { name: 'Original', relations: [{ taskId: 'b', type: 'blocks' }] })
    await saveTask(original)

    // The task row is valid but the relation isn't, so the whole transaction rolls back
    await saveTask(task('a', { name: 'Changed', relations: [{ taskId: 'missing', type: 'blocks' }] }))

    expect((await listTasks()).find((t) => t.id === 'a')).toEqual(original)
  })

  it('leaves the stored project untouched when an update fails part way', async () => {
    await saveTask(task('t'))
    const original = project('p', { name: 'Original', taskIds: ['t'], links: [{ label: 'A', url: 'https://a' }] })
    await saveProject(original)

    await saveProject(project('p', { name: 'Changed', taskIds: ['t', 'missing'], links: [] }))

    expect(await listProjects()).toEqual([original])
  })
})

describe('deleting', () => {
  it('removes a deleted task from projects and from other tasks', async () => {
    await saveTask(task('gone'))
    await saveTask(task('kept', { relations: [{ taskId: 'gone', type: 'blocked_by' }] }))
    await saveProject(project('p', { taskIds: ['gone', 'kept'] }))

    expect((await call('DELETE', 'tasks/gone')).status).toBe(204)

    expect(await listTasks()).toEqual([task('kept')])
    expect((await listProjects())[0]!.taskIds).toEqual(['kept'])
  })

  it("removes a deleted project's task links and reference links, but keeps its tasks", async () => {
    await saveTask(task('t'))
    await saveProject(project('p', { taskIds: ['t'], links: [{ label: 'A', url: 'https://a' }] }))

    expect((await call('DELETE', 'projects/p')).status).toBe(204)

    expect(await listProjects()).toEqual([])
    expect(await listTasks()).toEqual([task('t')])
    expect(await count('project_tasks')).toBe(0)
    expect(await count('project_links')).toBe(0)
  })

  it('answers 204 for an id that does not exist', async () => {
    expect((await call('DELETE', 'tasks/missing')).status).toBe(204)
  })
})

describe('schema constraints', () => {
  // These go straight to D1, to check the database protects itself even without the Worker
  it.each([
    ["a task priority outside the allowed list", "INSERT INTO tasks (id, name, priority) VALUES ('a', 'A', 'asap')"],
    ['completed other than 0 or 1', "INSERT INTO tasks (id, name, completed) VALUES ('a', 'A', 2)"],
    ['a task without a name', "INSERT INTO tasks (id) VALUES ('a')"],
    ['a project priority outside the allowed list', "INSERT INTO projects (id, name, priority) VALUES ('p', 'P', 'asap')"],
    ['a project_tasks row for a missing project', "INSERT INTO project_tasks (project_id, task_id, position) VALUES ('missing', 't', 0)"],
    ['a project_tasks row for a missing task', "INSERT INTO project_tasks (project_id, task_id, position) VALUES ('p', 'missing', 0)"],
    ['a link for a missing project', "INSERT INTO project_links (project_id, position, label, url) VALUES ('missing', 0, 'A', 'https://a')"],
    ['a relation type outside the allowed list', "INSERT INTO task_relations (task_id, related_task_id, type, position) VALUES ('t', 'u', 'depends_on', 0)"],
    ['a task related to itself', "INSERT INTO task_relations (task_id, related_task_id, type, position) VALUES ('t', 't', 'blocks', 0)"],
    ['a project_tags row for a missing tag', "INSERT INTO project_tags (project_id, tag_id, position) VALUES ('p', 'missing', 0)"],
    ['a project_tags row for a missing project', "INSERT INTO project_tags (project_id, tag_id, position) VALUES ('missing', 'w', 0)"],
    ['a tag name that differs only in case', "INSERT INTO tags (id, name) VALUES ('w2', 'WORK')"],
    ['a tag without a name', "INSERT INTO tags (id) VALUES ('x')"],
  ])('rejects %s', async (_, sql) => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO tasks (id, name) VALUES ('t', 'T'), ('u', 'U')"),
      env.DB.prepare("INSERT INTO projects (id, name) VALUES ('p', 'P')"),
      env.DB.prepare("INSERT INTO tags (id, name) VALUES ('w', 'Work')"),
    ])
    await expect(env.DB.prepare(sql).run()).rejects.toThrow(/constraint/i)
  })

  it('fills in defaults for optional columns', async () => {
    await env.DB.prepare("INSERT INTO tasks (id, name) VALUES ('a', 'A')").run()
    const row = await env.DB.prepare("SELECT * FROM tasks WHERE id = 'a'").first<Record<string, unknown>>()
    expect(row).toMatchObject({ description: '', due_date: null, priority: 'medium', completed: 0 })
    expect(row!.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })
})
