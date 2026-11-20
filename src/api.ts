// Client for the Worker API in worker/index.ts, which stores projects, tasks and tags in D1, for
// signing in through worker/auth.ts, for importing Google Calendar through worker/google.ts, and for
// linking the Telegram bot through worker/pamBot/. The session cookie is HttpOnly, so this code never
// sees it: the browser sends it with every request.
//
// Every request also says which layout sent it (X-Pam-Client), and a request that is an action the
// user took says which (X-Pam-Action), for history and usage_counts (README, "Usage"). The stores
// name the action, since they know whether a save makes a task or changes one; a request the app
// sends on its own is named 'auto', so it isn't counted.
import type { GoogleAccount, SyncResult } from '@/types/google'
import type { Changes, ProjectSave, TaskAction, TaskPatchSave, TaskSave } from '@/types/operations'
import type { Project } from '@/types/project'
import type { UserSettings } from '@/types/settings'
import type { Clash } from '@/types/rules'
import type { Tag } from '@/types/tag'
import type { Task } from '@/types/task'
import type { TelegramLinkCode, TelegramPreferences, TelegramStatus } from '@/types/telegram'
import {
  ACTION_HEADER,
  CLIENT_HEADER,
  PHONE_QUERY,
  type AUTO_ACTION,
  type ClientOnlyAction,
  type UsageAction,
  type WebClient,
} from '@/types/usage'

interface Resources {
  projects: Project
  tasks: Task
  tags: Tag
}

export interface Account {
  email: string
}

// A request the Worker refused, with the status it answered
export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
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

// This page load's layout, at the app's phone breakpoint. Decided once, so turning a tablet halfway
// through doesn't split what it did between two clients. Without matchMedia (as in tests) it's desktop.
const CLIENT: WebClient = typeof matchMedia === 'function' && matchMedia(PHONE_QUERY).matches ? 'web-mobile' : 'web-desktop'

// What a request is, for usage_counts: an action the user took, or 'auto' for one the app sends on
// its own. Left out, the Worker counts it by its method and route.
export type RequestAction = UsageAction | typeof AUTO_ACTION

async function request<T>(path: string, init: RequestInit = {}, action?: RequestAction): Promise<T> {
  const headers = { ...(init.headers as Record<string, string>), [CLIENT_HEADER]: CLIENT, ...(action ? { [ACTION_HEADER]: action } : {}) }
  const response = await fetch(`/api/${path}`, { ...init, headers })
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('auth/')) signedOutHandler()
    const body = await response.json().catch(() => null)
    const message = body?.error ?? `${init.method ?? 'GET'} /api/${path} failed (${response.status})`
    if (response.status === 409) throw new ApiConflict(message, body?.clashes ?? [])
    throw new ApiError(message, response.status)
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
export function save<R extends keyof Resources>(resource: R, item: Resources[R], action?: RequestAction) {
  return request<Resources[R]>(`${resource}/${encodeURIComponent(item.id)}`, sendJson('PUT', item), action)
}

// Saves a task under the scheduling rules (src/types/operations.ts), returning every task and
// project the save changed. Throws ApiConflict if it would make the task due after a delivery date.
export function saveTask(input: TaskSave, action?: RequestAction) {
  return request<Changes>(`tasks/${encodeURIComponent(input.task.id)}`, sendJson('PUT', input), action)
}

// Like saveTask, for a project
export function saveProject(input: ProjectSave, action?: RequestAction) {
  return request<Changes>(`projects/${encodeURIComponent(input.project.id)}`, sendJson('PUT', input), action)
}

// Changes only the task fields in the patch (null clears an optional one), under the same rules
// as saveTask, and returns every task and project it changed
export function patchTask(taskId: string, input: TaskPatchSave, action?: RequestAction) {
  return request<Changes>(`tasks/${encodeURIComponent(taskId)}`, sendJson('PATCH', input), action)
}

// Does one quick action to a task (src/types/operations.ts), changing only what the action names,
// and returns every task and project it changed
export function taskAction(taskId: string, action: TaskAction, usage?: RequestAction) {
  return request<Changes>(`tasks/${encodeURIComponent(taskId)}/action`, sendJson('POST', action), usage)
}

// Creates or updates the tasks and adds the new ones to the project, as one save under the same
// rules; nothing is saved if any of them clashes
export function importTasks(projectId: string, tasks: Task[], action?: RequestAction) {
  return request<Changes>(`projects/${encodeURIComponent(projectId)}/import`, sendJson('POST', { tasks }), action)
}

export function remove(resource: keyof Resources, id: string, action?: RequestAction) {
  return request<void>(`${resource}/${encodeURIComponent(id)}`, { method: 'DELETE' }, action)
}

// Counts an action that happens only in the browser, such as an export, which sends nothing else
export function reportUsage(action: ClientOnlyAction) {
  return request<void>('usage', sendJson('POST', { action }), action)
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
  disconnect: (email: string) =>
    request<void>(`google/accounts/${encodeURIComponent(email)}`, { method: 'DELETE' }, 'google_disconnect'),
  // Imports the events of every connected account; an empty list when none is connected. 'auto'
  // when the app syncs by itself, after an account is connected.
  sync: (action: RequestAction = 'google_sync') => request<SyncResult[]>('google/sync', sendJson('POST', {}), action),
}

// The signed-in account's capacity and prioritisation weights; the defaults until they save their own
export const settings = {
  get: () => request<UserSettings>('settings'),
  save: (value: UserSettings) => request<UserSettings>('settings', sendJson('PUT', value), 'settings_save'),
}

// The Telegram companion bot: whether a chat is linked, a code to link one, and the morning brief
export const telegram = {
  // null when the bot isn't set up on this deploy, which the Worker answers with 404
  status: () =>
    request<TelegramStatus>('telegram').catch((e) => {
      if (e instanceof ApiError && e.status === 404) return null
      throw e
    }),
  // A one-time code for linking a chat, with this browser's time zone for the brief
  linkCode: (timeZone: string) =>
    request<TelegramLinkCode>('telegram/link-code', sendJson('POST', { timeZone }), 'telegram_link'),
  save: (preferences: TelegramPreferences) => request<TelegramStatus>('telegram', sendJson('PUT', preferences), 'telegram_save'),
  disconnect: () => request<void>('telegram', { method: 'DELETE' }, 'telegram_unlink'),
}
