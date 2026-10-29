import { afterEach, describe, it, expect, vi } from 'vitest'
import * as api from '../api'
import { createEmptyProject, type Project } from '../types/project'
import { ARCHIVE_TAG_ID } from '../types/tag'
import { createEmptyTask, type Task } from '../types/task'
import { fakeApi } from './fakeApi'

const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id, name: id, ...fields })
const project = (id: string, fields: Partial<Project> = {}): Project => ({
  ...createEmptyProject(),
  id,
  name: id,
  ...fields,
})
const clash = { taskId: 't', projectId: 'p', dueDate: '2026-12-14', deliveryDate: '2026-12-10' }

const stubFetch = (response: Response) => {
  const fetch = vi.fn(async () => response)
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists a resource with a GET to /api/<resource>', async () => {
    const fetch = stubFetch(Response.json([{ id: 'a' }]))
    expect(await api.list('tasks')).toEqual([{ id: 'a' }])
    expect(fetch).toHaveBeenCalledWith('/api/tasks', undefined)
  })

  it('saves with a JSON PUT to /api/<resource>/<id>, encoding the id', async () => {
    const task = { ...createEmptyTask(), id: 'a/b c', name: 'Task' }
    const fetch = stubFetch(Response.json(task))

    expect(await api.save('tasks', task)).toEqual(task)
    expect(fetch).toHaveBeenCalledWith('/api/tasks/a%2Fb%20c', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    })
  })

  it('removes with a DELETE to /api/<resource>/<id>, accepting an empty 204 reply', async () => {
    const fetch = stubFetch(new Response(null, { status: 204 }))
    expect(await api.remove('tags', 'a/b')).toBeUndefined()
    expect(fetch).toHaveBeenCalledWith('/api/tags/a%2Fb', { method: 'DELETE' })
  })

  it("throws the API's error message when a request fails", async () => {
    stubFetch(Response.json({ error: 'name must be a non-empty string' }, { status: 400 }))
    await expect(api.list('projects')).rejects.toThrow('name must be a non-empty string')
  })

  it('throws a message with the method, path and status when the error body is not JSON', async () => {
    stubFetch(new Response('Bad gateway', { status: 502 }))
    await expect(api.save('projects', { id: 'p' } as never)).rejects.toThrow('PUT /api/projects/p failed (502)')
  })

  it('saves a task with its extras in a JSON PUT, returning the changes', async () => {
    const input = { task: task('a/b c'), projectIds: ['p'], deliveryDates: { p: '2026-12-14' } }
    const changes = { tasks: [input.task], projects: [project('p', { deliveryDate: '2026-12-14', taskIds: ['a/b c'] })] }
    const fetch = stubFetch(Response.json(changes))

    expect(await api.saveTask(input)).toEqual(changes)
    expect(fetch).toHaveBeenCalledWith('/api/tasks/a%2Fb%20c', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  })

  it('saves a project with its extras in a JSON PUT, returning the changes', async () => {
    const input = { project: project('p/q', { taskIds: ['t'] }), dueDates: { t: '2026-12-10' } }
    const changes = { tasks: [task('t', { dueDate: '2026-12-10' })], projects: [input.project] }
    const fetch = stubFetch(Response.json(changes))

    expect(await api.saveProject(input)).toEqual(changes)
    expect(fetch).toHaveBeenCalledWith('/api/projects/p%2Fq', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  })

  it('throws an ApiConflict with the clashes on a 409', async () => {
    const error = `"Write report" is due 2026-12-14, after "Thesis"'s delivery date (2026-12-10)`
    stubFetch(Response.json({ error, clashes: [clash] }, { status: 409 }))

    const thrown = await api.saveTask({ task: task('t'), projectIds: ['p'] }).catch((e) => e)
    expect(thrown).toBeInstanceOf(api.ApiConflict)
    expect(thrown).toMatchObject({ name: 'ApiConflict', message: error, clashes: [clash] })
  })

  it('throws a plain Error, not an ApiConflict, for other failures', async () => {
    stubFetch(Response.json({ error: 'Unknown project: p' }, { status: 400 }))
    const thrown = await api.saveTask({ task: task('t'), projectIds: ['p'] }).catch((e) => e)
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).not.toBeInstanceOf(api.ApiConflict)
    expect(thrown.message).toBe('Unknown project: p')
  })
})

describe('api client against the fake Worker', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('applies a task save under the rules, archiving the project it completes', async () => {
    const fake = fakeApi({ tasks: [task('t')], projects: [project('p', { taskIds: ['t'] })] })
    const done = task('t', { completed: true })
    const archived = project('p', { taskIds: ['t'], tagIds: [ARCHIVE_TAG_ID] })

    expect(await api.saveTask({ task: done })).toEqual({ tasks: [done], projects: [archived] })
    expect(fake.data).toMatchObject({ tasks: [done], projects: [archived] })
  })

  it('applies a project save with due dates, saving both', async () => {
    const fake = fakeApi({ tasks: [task('t', { dueDate: '2026-12-14' })], projects: [project('p', { deliveryDate: '2026-12-10' })] })
    const withTask = project('p', { deliveryDate: '2026-12-10', taskIds: ['t'] })
    const earlier = task('t', { dueDate: '2026-12-10' })

    expect(await api.saveProject({ project: withTask, dueDates: { t: '2026-12-10' } })).toEqual({ tasks: [earlier], projects: [withTask] })
    expect(fake.data).toMatchObject({ tasks: [earlier], projects: [withTask] })
  })

  it('refuses a clash with an ApiConflict, naming it as the Worker does and saving nothing', async () => {
    const before = { tasks: [task('t', { name: 'Draft', dueDate: '2026-12-14' })], projects: [project('p', { name: 'Thesis', deliveryDate: '2026-12-10' })] }
    const fake = fakeApi(before)

    const thrown = await api.saveTask({ task: task('t', { name: 'Write report', dueDate: '2026-12-14' }), projectIds: ['p'] }).catch((e) => e)
    expect(thrown).toBeInstanceOf(api.ApiConflict)
    expect(thrown).toMatchObject({
      message: `"Write report" is due 2026-12-14, after "Thesis"'s delivery date (2026-12-10)`,
      clashes: [clash],
    })
    expect(fake.data).toMatchObject(before)
  })

  it('answers 400 for an unknown project, saving nothing', async () => {
    const fake = fakeApi({ tasks: [task('t')] })
    await expect(api.saveTask({ task: task('t', { name: 'Renamed' }), projectIds: ['missing'] })).rejects.toThrow('Unknown project: missing')
    expect(fake.data.tasks).toEqual([task('t')])
  })

  it('still saves a bare task as it is', async () => {
    const fake = fakeApi({ tasks: [task('t')], projects: [project('p', { taskIds: ['t'] })] })
    const done = task('t', { completed: true })

    expect(await api.save('tasks', done)).toEqual(done)
    expect(fake.data.projects).toEqual([project('p', { taskIds: ['t'] })])
  })
})
