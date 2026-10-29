// Client for the Worker API in worker/index.ts, which stores projects, tasks and tags in D1, and
// for signing in through worker/auth.ts. The session cookie is HttpOnly, so this code never sees
// it: the browser sends it with every request.
import type { Changes, ProjectSave, TaskSave } from '@/types/operations'
import type { Project } from '@/types/project'
import type { Clash } from '@/types/rules'
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

// A save the Worker refused (409) because it would make a task due after a project's delivery date
export class ApiConflict extends Error {
  readonly clashes: Clash[]

  constructor(message: string, clashes: Clash[]) {
    super(message)
    this.name = 'ApiConflict'
    this.clashes = clashes
  }
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
    const message = body?.error ?? `${init?.method ?? 'GET'} /api/${path} failed (${response.status})`
    if (response.status === 409) throw new ApiConflict(message, body?.clashes ?? [])
    throw new Error(message)
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

// Saves the item as it is, with no scheduling rules applied. Tags use this; tasks and projects
// use saveTask and saveProject.
export function save<R extends keyof Resources>(resource: R, item: Resources[R]) {
  return request<Resources[R]>(`${resource}/${encodeURIComponent(item.id)}`, sendJson('PUT', item))
}

// Saves a task under the scheduling rules (src/types/operations.ts), returning every task and
// project the save changed. Throws ApiConflict if it would make the task due after a delivery date.
export function saveTask(input: TaskSave) {
  return request<Changes>(`tasks/${encodeURIComponent(input.task.id)}`, sendJson('PUT', input))
}

// Like saveTask, for a project
export function saveProject(input: ProjectSave) {
  return request<Changes>(`projects/${encodeURIComponent(input.project.id)}`, sendJson('PUT', input))
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
