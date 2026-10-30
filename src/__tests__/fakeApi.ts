// In-memory stand-in for the Worker API (worker/index.ts), installed as the global fetch.
// Unit tests use it to check what the app sends and how it handles the replies.
import { expect, vi } from 'vitest'
import type { GoogleAccount, SyncResult } from '@/types/google'
import { planProjectSave, planTaskSave, UnknownReference, type Plan, type State } from '@/types/operations'
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
    // Google Calendar: the connected accounts, what a sync answers when there are any, and the
    // tasks it imports
    google: { accounts: [] as GoogleAccount[], results: [] as SyncResult[], imports: [] as Task[] },
    fetch: vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      api.requests.push(`${method} ${url}`)
      if (api.failWith && (!api.failOn || url.startsWith(`/api/${api.failOn}`))) {
        return Response.json({ error: api.failWith }, { status: 500 })
      }

      if (url.startsWith('/api/google/')) return googleRoute(method, url.split('/').slice(3))
      const [, , resource, rawId] = url.split('/') as [string, string, keyof typeof data, string?]
      const items: { id: string }[] = data[resource]
      if (method === 'GET') return Response.json(items)
      if (method === 'DELETE') {
        items.splice(items.findIndex((i) => i.id === decodeURIComponent(rawId!)), 1)
        return new Response(null, { status: 204 })
      }

      const body = JSON.parse(init!.body as string)
      const id = decodeURIComponent(rawId!)
      // Task and project saves go through the scheduling rules, and must be wrapped, as in the Worker
      if (resource === 'tasks') {
        if (!('task' in body)) return Response.json({ error: 'Body must be { task, projectIds?, deliveryDates? }' }, { status: 400 })
        expect(body.task.id).toBe(id)
        return applyPlan(() => planTaskSave(data, body), { tasks: [body.task], projects: [] })
      }
      if (resource === 'projects') {
        if (!('project' in body)) return Response.json({ error: 'Body must be { project, dueDates? }' }, { status: 400 })
        expect(body.project.id).toBe(id)
        return applyPlan(() => planProjectSave(data, body), { tasks: [], projects: [body.project] })
      }

      expect(body.id).toBe(id)
      upsert(items, body)
      return Response.json(body)
    }),
  }

  function googleRoute(method: string, [action, email]: string[]): Response {
    const { google } = api
    if (method === 'POST' && action === 'sync') {
      if (google.accounts.length === 0) return Response.json([])
      for (const task of google.imports) upsert(data.tasks, task)
      return Response.json(google.results)
    }
    if (method === 'GET' && action === 'accounts') return Response.json(google.accounts)
    if (method === 'DELETE' && action === 'accounts') {
      google.accounts = google.accounts.filter((a) => a.email !== decodeURIComponent(email!))
      return new Response(null, { status: 204 })
    }
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  // Stores what a planned save changes and replies as the Worker does: the changes, a 400 for an
  // unknown id, or a 409 naming the first clash, using the names in `saving` over the stored ones
  function applyPlan(plan: () => Plan, saving: State): Response {
    let result: Plan
    try {
      result = plan()
    } catch (e) {
      if (e instanceof UnknownReference) return Response.json({ error: e.message }, { status: 400 })
      throw e
    }
    if (!result.ok) {
      const { taskId, projectId, dueDate, deliveryDate } = result.clashes[0]!
      const name = (items: { id: string; name: string }[], id: string) => items.find((i) => i.id === id)?.name ?? id
      const taskName = name([...saving.tasks, ...data.tasks], taskId)
      const projectName = name([...saving.projects, ...data.projects], projectId)
      const error = `"${taskName}" is due ${dueDate}, after "${projectName}"'s delivery date (${deliveryDate})`
      return Response.json({ error, clashes: result.clashes }, { status: 409 })
    }
    for (const task of result.changes.tasks) upsert(data.tasks, task)
    for (const project of result.changes.projects) upsert(data.projects, project)
    return Response.json(result.changes)
  }

  vi.stubGlobal('fetch', api.fetch)
  return api
}

// Replaces the item with the same id, or adds it at the end
function upsert<T extends { id: string }>(items: T[], item: T) {
  const index = items.findIndex((i) => i.id === item.id)
  if (index === -1) items.push(item)
  else items[index] = item
}
