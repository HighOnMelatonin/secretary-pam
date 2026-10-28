// Client for the Worker API in worker/index.ts, which stores projects, tasks and tags in D1, and
// for signing in through worker/auth.ts. The session cookie is HttpOnly, so this code never sees
// it: the browser sends it with every request.
import type { Project } from '@/types/project'
import type { Tag } from '@/types/tag'
import type { Task } from '@/types/task'

interface Resources {
  projects: Project
  tasks: Task
  tags: Tag
}

export interface Account {
  email: string
}

// Called when a request for data is refused because the session has ended or was never started
let signedOutHandler = () => {}

export function whenSignedOut(handler: () => void) {
  signedOutHandler = handler
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, init)
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('auth/')) signedOutHandler()
    const body = await response.json().catch(() => null)
    throw new Error(body?.error ?? `${init?.method ?? 'GET'} /api/${path} failed (${response.status})`)
  }
  if (response.status === 204) return undefined as T
  return response.json()
}

const sendJson = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export function list<R extends keyof Resources>(resource: R) {
  return request<Resources[R][]>(resource)
}

export function save<R extends keyof Resources>(resource: R, item: Resources[R]) {
  return request<Resources[R]>(`${resource}/${encodeURIComponent(item.id)}`, sendJson('PUT', item))
}

export function remove(resource: keyof Resources, id: string) {
  return request<void>(`${resource}/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export const auth = {
  // The signed-in account; throws if there is none
  me: () => request<Account>('auth/me'),
  signUp: (email: string, password: string) => request<Account>('auth/signup', sendJson('POST', { email, password })),
  logIn: (email: string, password: string) => request<Account>('auth/login', sendJson('POST', { email, password })),
  logOut: () => request<void>('auth/logout', { method: 'POST' }),
}
