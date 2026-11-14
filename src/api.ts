// Client for the Worker API in worker/index.ts, which stores projects, tasks and tags in D1, for
// signing in through worker/auth.ts, and for importing Google Calendar through worker/google.ts. The session cookie is HttpOnly, so this code never sees
// it: the browser sends it with every request.
import type { GoogleAccount, SyncResult } from '@/types/google'
import type { Changes, ProjectSave, TaskAction, TaskPatchSave, TaskSave } from '@/types/operations'
import type { Project } from '@/types/project'
import type { UserSettings } from '@/types/settings'
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

// Changes only the task fields in the patch (null clears an optional one), under the same rules
// as saveTask, and returns every task and project it changed
export function patchTask(taskId: string, input: TaskPatchSave) {
  return request<Changes>(`tasks/${encodeURIComponent(taskId)}`, sendJson('PATCH', input))
}

// Does one quick action to a task (src/types/operations.ts), changing only what the action names,
// and returns every task and project it changed
export function taskAction(taskId: string, action: TaskAction) {
  return request<Changes>(`tasks/${encodeURIComponent(taskId)}/action`, sendJson('POST', action))
}

// Creates or updates the tasks and adds the new ones to the project, as one save under the same
// rules; nothing is saved if any of them clashes
export function importTasks(projectId: string, tasks: Task[]) {
  return request<Changes>(`projects/${encodeURIComponent(projectId)}/import`, sendJson('POST', { tasks }))
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
  // Emails a reset link if the email has an account. The answer is the same either way.
  requestReset: (email: string) => request<void>('auth/forgot', sendJson('POST', { email })),
  // Sets the password from a reset link's token, signing out every device
  resetPassword: (token: string, password: string) =>
    request<void>('auth/reset', sendJson('POST', { token, password })),
}

export const google = {
  // Where to send the browser to connect a Google account. Google sends it back to /?google=connected.
  connectPath: '/api/google/connect',
  accounts: () => request<GoogleAccount[]>('google/accounts'),
  disconnect: (email: string) => request<void>(`google/accounts/${encodeURIComponent(email)}`, { method: 'DELETE' }),
  // Imports the events of every connected account; an empty list when none is connected
  sync: () => request<SyncResult[]>('google/sync', sendJson('POST', {})),
}

// The signed-in account's capacity and prioritisation weights; the defaults until they save their own
export const settings = {
  get: () => request<UserSettings>('settings'),
  save: (value: UserSettings) => request<UserSettings>('settings', sendJson('PUT', value)),
}
