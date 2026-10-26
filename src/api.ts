// Client for the Worker API in worker/index.ts, which stores projects, tasks and tags in D1
import type { Project } from '@/types/project'
import type { Tag } from '@/types/tag'
import type { Task } from '@/types/task'

interface Resources {
  projects: Project
  tasks: Task
  tags: Tag
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, init)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error ?? `${init?.method ?? 'GET'} /api/${path} failed (${response.status})`)
  }
  if (response.status === 204) return undefined as T
  return response.json()
}

export function list<R extends keyof Resources>(resource: R) {
  return request<Resources[R][]>(resource)
}

export function save<R extends keyof Resources>(resource: R, item: Resources[R]) {
  return request<Resources[R]>(`${resource}/${encodeURIComponent(item.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  })
}

export function remove(resource: keyof Resources, id: string) {
  return request<void>(`${resource}/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
