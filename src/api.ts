// Client for the Worker API in worker/index.ts, which stores projects and tasks in D1
import type { Project } from '@/types/project'
import type { Task } from '@/types/task'

interface Resources {
  projects: Project
  tasks: Task
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, init)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error ?? `${init?.method ?? 'GET'} /api/${path} failed (${response.status})`)
  }
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
