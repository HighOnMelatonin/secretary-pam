import { afterEach, describe, it, expect, vi } from 'vitest'
import * as api from '../api'
import { createEmptyTask } from '../types/task'

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

  it("throws the API's error message when a request fails", async () => {
    stubFetch(Response.json({ error: 'name must be a non-empty string' }, { status: 400 }))
    await expect(api.list('projects')).rejects.toThrow('name must be a non-empty string')
  })

  it('throws a message with the method, path and status when the error body is not JSON', async () => {
    stubFetch(new Response('Bad gateway', { status: 502 }))
    await expect(api.save('projects', { id: 'p' } as never)).rejects.toThrow('PUT /api/projects/p failed (502)')
  })
})
