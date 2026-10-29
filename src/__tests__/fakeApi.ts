// In-memory stand-in for the Worker API (worker/index.ts), installed as the global fetch.
// Unit tests use it to check what the app sends and how it handles the replies.
import { expect, vi } from 'vitest'
import type { Project } from '@/types/project'
import type { Tag } from '@/types/tag'
import type { Task } from '@/types/task'

export function fakeApi(initial: { projects?: Project[]; tasks?: Task[]; tags?: Tag[] } = {}) {
  const data = {
    projects: structuredClone(initial.projects ?? []),
    tasks: structuredClone(initial.tasks ?? []),
    tags: structuredClone(initial.tags ?? []),
  }

  const api = {
    data,
    // When set, every request fails with a 500 and this error message
    failWith: null as string | null,
    // When set too, only requests for this resource (e.g. 'tasks') fail
    failOn: null as string | null,
    // Each request as "METHOD /path", in order
    requests: [] as string[],
    fetch: vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      api.requests.push(`${method} ${url}`)
      if (api.failWith && (!api.failOn || url.startsWith(`/api/${api.failOn}`))) {
        return Response.json({ error: api.failWith }, { status: 500 })
      }

      const [, , resource, rawId] = url.split('/') as [string, string, keyof typeof data, string?]
      const items: { id: string }[] = data[resource]
      if (method === 'GET') return Response.json(items)
      if (method === 'DELETE') {
        items.splice(items.findIndex((i) => i.id === decodeURIComponent(rawId!)), 1)
        return new Response(null, { status: 204 })
      }

      const item = JSON.parse(init!.body as string)
      expect(item.id).toBe(decodeURIComponent(rawId!))
      const index = items.findIndex((i) => i.id === item.id)
      if (index === -1) items.push(item)
      else items[index] = item
      return Response.json(item)
    }),
  }

  vi.stubGlobal('fetch', api.fetch)
  return api
}
