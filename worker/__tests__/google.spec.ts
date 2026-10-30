// Integration tests for the Google Calendar import (worker/google.ts and googleCalendar.ts),
// against a real D1 database. fetch is replaced by a fake Google that answers the token, calendar
// list, batch and revoke requests, so nothing leaves the test.
import { env, SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoggedEvent } from '../../src/types/events'
import type { SyncResult } from '../../src/types/google'
import type { Project } from '../../src/types/project'
import type { Task } from '../../src/types/task'
import { addDays } from '../../src/types/upcoming'
import { batchBody, eventFields, htmlToText, parseBatch, timing, type GoogleEvent } from '../googleCalendar'
import * as helpers from './helpers'

const EMAIL = 'me@gmail.com'
const LIST_SCOPE = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'
const EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly'
const today = new Date().toISOString().slice(0, 10)
const inDays = (days: number) => addDays(today, days)

// The base64url JSON in the middle of an ID token
const idToken = (claims: object) =>
  `header.${btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.signature`

interface FakeCalendar {
  selected?: boolean
  events: GoogleEvent[]
  failWith?: number // every events.list call answers with this status
  rateLimited?: number // how many calls answer 429 before the rest go through
}

// Google as far as the import uses it. Pages of events hold PAGE events, so paging is tested
// without thousands of them.
function fakeGoogle() {
  const PAGE = 2
  const google = {
    email: EMAIL,
    scope: `openid email ${LIST_SCOPE} ${EVENTS_SCOPE}`,
    revoked: false, // the refresh token no longer works
    calendars: new Map<string, FakeCalendar>(),
    batches: [] as string[][], // the calendar ids of each batch's calls, in order
    revokedTokens: [] as string[],
  }

  async function answer(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const auth = new Headers(init?.headers).get('Authorization')

    if (url.href === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(String(init!.body))
      if (form.get('client_secret') !== 'test-client-secret') return Response.json({ error: 'invalid_client' }, { status: 401 })
      if (form.get('grant_type') === 'authorization_code') {
        if (form.get('code') !== 'good-code' || !form.get('code_verifier')) return Response.json({ error: 'invalid_grant' }, { status: 400 })
        return Response.json({
          access_token: 'access',
          refresh_token: `refresh-${google.email}`,
          scope: google.scope,
          id_token: idToken({ email: google.email, email_verified: true }),
        })
      }
      if (google.revoked) return Response.json({ error: 'invalid_grant' }, { status: 400 })
      return Response.json({ access_token: 'access' })
    }
    if (url.href === 'https://oauth2.googleapis.com/revoke') {
      google.revokedTokens.push(new URLSearchParams(String(init!.body)).get('token')!)
      return new Response(null, { status: 200 })
    }
    if (auth !== 'Bearer access') return Response.json({ error: { message: 'Invalid Credentials' } }, { status: 401 })

    if (url.pathname === '/calendar/v3/users/me/calendarList') {
      const items = [...google.calendars].map(([id, c]) => ({ id, selected: c.selected ?? true }))
      return Response.json({ items })
    }
    if (url.href === 'https://www.googleapis.com/batch/calendar/v3') {
      const boundary = /boundary=(\S+)/.exec(new Headers(init!.headers).get('Content-Type')!)![1]!
      const calls = [...String(init!.body).matchAll(/Content-ID: <([^>]+)>\r\n\r\nGET (\S+)/g)]
      google.batches.push(calls.map(([, , path]) => decodeURIComponent(/calendars\/([^/]+)\/events/.exec(path!)![1]!)))
      // Answered in reverse, as Google may answer in any order
      const parts = calls.reverse().map(([, id, path]) => {
        const { status, body } = listEvents(new URL(path!, 'https://www.googleapis.com'))
        return `--reply\r\nContent-Type: application/http\r\nContent-ID: <response-${id}>\r\n\r\nHTTP/1.1 ${status} X\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(body)}\r\n`
      })
      expect(boundary).toMatch(/^batch_/)
      return new Response(`${parts.join('')}--reply--\r\n`, { headers: { 'Content-Type': 'multipart/mixed; boundary=reply' } })
    }
    throw new Error(`Unexpected request to ${url}`)
  }

  function listEvents(url: URL): { status: number; body: unknown } {
    const id = decodeURIComponent(/calendars\/([^/]+)\/events/.exec(url.pathname)![1]!)
    const calendar = google.calendars.get(id)!
    expect(url.searchParams.get('singleEvents')).toBe('true')
    if (calendar.failWith) return { status: calendar.failWith, body: { error: { message: 'Forbidden' } } }
    if (calendar.rateLimited) {
      calendar.rateLimited--
      return { status: 429, body: { error: { message: 'Rate Limit Exceeded' } } }
    }
    const start = Number(url.searchParams.get('pageToken') ?? 0)
    const items = calendar.events.slice(start, start + PAGE)
    const more = start + PAGE < calendar.events.length
    return { status: 200, body: { items, ...(more ? { nextPageToken: String(start + PAGE) } : {}) } }
  }

  vi.spyOn(globalThis, 'fetch').mockImplementation(answer)
  return google
}

const allDay = (id: string, date: string, fields: Partial<GoogleEvent> = {}, endDate = addDays(date, 1)): GoogleEvent => ({
  id,
  summary: `Event ${id}`,
  start: { date },
  end: { date: endDate },
  ...fields,
})

const timed = (id: string, start: string, end: string, fields: Partial<GoogleEvent> = {}): GoogleEvent => ({
  id,
  summary: `Event ${id}`,
  start: { dateTime: start },
  end: { dateTime: end },
  ...fields,
})

let session: string
let google: ReturnType<typeof fakeGoogle>

beforeEach(async () => {
  google = fakeGoogle()
  vi.spyOn(timing, 'sleep').mockResolvedValue()
  session = await helpers.signUp()
})

afterEach(() => vi.restoreAllMocks())

const call = async (method: string, path: string, body?: unknown, cookie = session) =>
  helpers.call(method, path, body, cookie)

// A request the browser makes by following a link or redirect, rather than one from the app
const visit = (path: string, cookie = session) =>
  SELF.fetch(`http://localhost/api/${path}`, { headers: { Cookie: cookie }, redirect: 'manual' })

// Goes to Google and back, as the browser would after the user agrees there
async function connect(cookie = session, code = 'good-code') {
  const toGoogle = new URL((await visit('google/connect', cookie)).headers.get('Location')!)
  const state = toGoogle.searchParams.get('state')!
  return visit(`google/callback?state=${state}&code=${code}`, cookie)
}

const sync = async (cookie = session): Promise<SyncResult[]> => {
  const { status, body } = await call('POST', 'google/sync', {}, cookie)
  expect(status).toBe(200)
  return body
}

const listTasks = async (cookie = session): Promise<Task[]> => (await call('GET', 'tasks', undefined, cookie)).body
const byName = (tasks: Task[]) => [...tasks].sort((a, b) => a.name.localeCompare(b.name))

describe('connecting', () => {
  it('sends the browser to Google for offline, read-only access, with a state and PKCE', async () => {
    const response = await visit('google/connect')
    expect(response.status).toBe(302)
    const url = new URL(response.headers.get('Location')!)
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'test-client-id',
      redirect_uri: 'http://localhost/api/google/callback',
      response_type: 'code',
      scope: `openid email ${LIST_SCOPE} ${EVENTS_SCOPE}`,
      access_type: 'offline',
      code_challenge_method: 'S256',
    })
    expect(url.searchParams.get('state')).toMatch(/^[\w-]{43}$/)
    expect(url.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/)
  })

  it('saves the account when Google sends the browser back, then returns to the app to sync', async () => {
    const response = await connect()
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('http://localhost/?google=connected')
    expect((await call('GET', 'google/accounts')).body).toEqual([{ email: EMAIL, syncedAt: null }])
    const row = await env.DB.prepare('SELECT refresh_token FROM google_accounts').first('refresh_token')
    expect(row).toBe(`refresh-${EMAIL}`)
  })

  it('connects several accounts, and the same one only once', async () => {
    await connect()
    await connect()
    google.email = 'work@gmail.com'
    await connect()
    const accounts = (await call('GET', 'google/accounts')).body
    expect(accounts.map((a: { email: string }) => a.email)).toEqual([EMAIL, 'work@gmail.com'])
  })

  it('refuses a state that is unknown, used already or started by another user', async () => {
    const failed = (response: Response) => new URL(response.headers.get('Location')!).searchParams.get('google')

    expect(failed(await visit('google/callback?state=made-up&code=good-code'))).toBe('error')

    const state = new URL((await visit('google/connect')).headers.get('Location')!).searchParams.get('state')
    const other = await helpers.signUp('other@example.com')
    expect(failed(await visit(`google/callback?state=${state}&code=good-code`, other))).toBe('error')
    // Trying it on another account used it up
    expect(failed(await visit(`google/callback?state=${state}&code=good-code`))).toBe('error')

    expect((await call('GET', 'google/accounts')).body).toEqual([])
    expect((await call('GET', 'google/accounts', undefined, other)).body).toEqual([])
  })

  it('says why when the user says no at Google, or leaves out the calendar permission', async () => {
    const toGoogle = new URL((await visit('google/connect')).headers.get('Location')!)
    const denied = await visit(`google/callback?state=${toGoogle.searchParams.get('state')}&error=access_denied`)
    expect(new URL(denied.headers.get('Location')!).searchParams.get('message')).toBe('Google Calendar wasn’t connected.')

    // Each calendar scope is needed: one lists the calendars, the other their events
    for (const scope of ['openid email', `openid email ${LIST_SCOPE}`, `openid email ${EVENTS_SCOPE}`]) {
      google.scope = scope
      const unticked = await connect()
      expect(new URL(unticked.headers.get('Location')!).searchParams.get('message')).toMatch(/permission to see your calendars/)
    }
    expect((await call('GET', 'google/accounts')).body).toEqual([])
  })

  it('still accepts the broader calendar scope that accounts connected earlier granted', async () => {
    google.scope = 'openid email https://www.googleapis.com/auth/calendar.readonly'
    expect((await connect()).headers.get('Location')).toBe('http://localhost/?google=connected')
  })

  it('needs a signed-in user', async () => {
    expect((await visit('google/connect', '')).status).toBe(401)
    expect((await call('POST', 'google/sync', {}, '')).status).toBe(401)
  })

  it('disconnects an account, asking Google to drop the token, and keeps its tasks', async () => {
    google.calendars.set('primary', { events: [allDay('a', inDays(3))] })
    await connect()
    await sync()

    expect((await call('DELETE', `google/accounts/${encodeURIComponent(EMAIL)}`)).status).toBe(204)
    expect((await call('GET', 'google/accounts')).body).toEqual([])
    expect(google.revokedTokens).toEqual([`refresh-${EMAIL}`])
    expect((await listTasks()).map((t) => t.googleAccount)).toEqual([EMAIL])
  })
})

describe('syncing', () => {
  it('asks the app to connect an account first when none is connected', async () => {
    expect(await sync()).toEqual([])
  })

  it("imports the shown calendars' events as unassigned tasks tagged with the account", async () => {
    google.calendars.set('primary', {
      events: [
        allDay('day', inDays(2)),
        allDay('trip', inDays(5), { summary: 'Trip', description: 'Pack' }, inDays(8)),
        timed('meeting', `${inDays(1)}T09:00:00+08:00`, `${inDays(1)}T10:00:00+08:00`, { summary: 'Meeting' }),
        timed('late', `${inDays(4)}T22:00:00+08:00`, `${inDays(5)}T00:00:00+08:00`, { summary: 'Late' }),
        allDay('gone', inDays(3), { status: 'cancelled' }),
        allDay('home', inDays(3), { eventType: 'workingLocation' }),
      ],
    })
    google.calendars.set('team#holiday@group.v.calendar.google.com', { events: [allDay('holiday', inDays(6), { summary: 'Holiday' })] })
    google.calendars.set('hidden', { selected: false, events: [allDay('secret', inDays(1))] })
    await connect()

    expect(await sync()).toEqual([
      { email: EMAIL, added: 5, updated: 0, removed: 0, keptDates: 0, failedCalendars: 0 },
    ])

    const tasks = byName(await listTasks())
    expect(tasks.map((t) => [t.name, t.dueDate, t.description])).toEqual([
      ['Event day', inDays(2), ''],
      ['Holiday', inDays(6), ''],
      // Ending at midnight counts as ending the day before
      ['Late', inDays(4), ''],
      ['Meeting', inDays(1), ''],
      // The all-day end date is exclusive, so a trip ending on inDays(8) ends the day before
      ['Trip', inDays(5), `Ends ${inDays(7)}\n\nPack`],
    ])
    for (const task of tasks) {
      expect(task).toMatchObject({ googleAccount: EMAIL, priority: 'medium', completed: false, relations: [] })
    }
    expect((await call('GET', 'projects')).body).toEqual([])
    // Both shown calendars in one batch; the primary calendar's later pages in further batches
    expect(google.batches[0]!.sort()).toEqual(['primary', 'team#holiday@group.v.calendar.google.com'])
    expect(google.batches.slice(1)).toEqual([['primary'], ['primary']])
    expect((await call('GET', 'google/accounts')).body[0].syncedAt).toMatch(/^\d{4}-\d\d-\d\dT/)
  })

  it('updates tasks from their events on the next sync, keeping what was set in Pam', async () => {
    google.calendars.set('primary', { events: [allDay('a', inDays(2)), allDay('b', inDays(3))] })
    await connect()
    await sync()
    const [a] = byName(await listTasks())
    await call('PUT', `tasks/${a!.id}`, { task: { ...a!, completed: true, priority: 'urgent' } })

    google.calendars.set('primary', { events: [allDay('a', inDays(4), { summary: 'Renamed' }), allDay('b', inDays(3))] })
    expect((await sync())[0]).toMatchObject({ added: 0, updated: 1, removed: 0 })

    const tasks = byName(await listTasks())
    expect(tasks).toHaveLength(2)
    expect(tasks[1]).toMatchObject({ id: a!.id, name: 'Renamed', dueDate: inDays(4), completed: true, priority: 'urgent' })
  })

  it('deletes the tasks whose events were deleted, and takes them out of their projects', async () => {
    google.calendars.set('primary', { events: [allDay('a', inDays(2)), allDay('b', inDays(3))] })
    await connect()
    await sync()
    const tasks = byName(await listTasks())
    const project: Project = {
      id: 'p',
      name: 'Project',
      description: '',
      deliveryDate: null,
      taskIds: tasks.map((t) => t.id),
      priority: 'medium',
      links: [],
      tagIds: [],
    }
    await call('PUT', 'projects/p', { project })

    google.calendars.set('primary', { events: [allDay('b', inDays(3))] })
    expect((await sync())[0]).toMatchObject({ added: 0, updated: 0, removed: 1 })

    expect((await listTasks()).map((t) => t.name)).toEqual(['Event b'])
    expect((await call('GET', 'projects')).body[0].taskIds).toEqual([tasks[1]!.id])
  })

  it('keeps a task due before its project delivers when its event moves later', async () => {
    google.calendars.set('primary', { events: [allDay('a', inDays(2))] })
    await connect()
    await sync()
    const [task] = await listTasks()
    await call('PUT', `tasks/${task!.id}`, { task: task!, projectIds: [] })
    const project: Project = {
      id: 'p',
      name: 'Project',
      description: '',
      deliveryDate: inDays(5),
      taskIds: [task!.id],
      priority: 'medium',
      links: [],
      tagIds: [],
    }
    await call('PUT', 'projects/p', { project })

    google.calendars.set('primary', { events: [allDay('a', inDays(9), { summary: 'Moved' })] })
    expect((await sync())[0]).toMatchObject({ updated: 1, keptDates: 1 })
    expect(await listTasks()).toMatchObject([{ name: 'Moved', dueDate: inDays(2) }])
  })

  it("leaves a calendar's tasks alone when it can't be read, and still syncs the others", async () => {
    google.calendars.set('primary', { events: [allDay('a', inDays(2))] })
    google.calendars.set('shared', { events: [allDay('s', inDays(2))] })
    await connect()
    await sync()

    google.calendars.set('shared', { events: [], failWith: 403 })
    google.calendars.set('primary', { events: [allDay('a', inDays(2)), allDay('new', inDays(4))] })
    expect((await sync())[0]).toMatchObject({ added: 1, removed: 0, failedCalendars: 1 })
    expect((await listTasks()).map((t) => t.name).sort()).toEqual(['Event a', 'Event new', 'Event s'])
  })

  it('tries rate-limited calls again in a later batch, after a pause', async () => {
    google.calendars.set('primary', { events: [allDay('a', inDays(2))], rateLimited: 2 })
    await connect()
    expect((await sync())[0]).toMatchObject({ added: 1, failedCalendars: 0 })
    expect(google.batches).toEqual([['primary'], ['primary'], ['primary']])
    expect(timing.sleep).toHaveBeenCalledTimes(2)
  })

  it('asks for the account to be connected again when Google no longer accepts it', async () => {
    google.calendars.set('primary', { events: [allDay('a', inDays(2))] })
    await connect()
    await sync()

    google.revoked = true
    google.calendars.set('primary', { events: [] })
    expect((await sync())[0]).toMatchObject({ email: EMAIL, reconnect: true, error: expect.stringMatching(/Connect it again/) })
    expect(await listTasks()).toHaveLength(1)
  })

  it("keeps an imported task's badge when it is saved from the app", async () => {
    google.calendars.set('primary', { events: [allDay('a', inDays(2))] })
    await connect()
    await sync()
    const [task] = await listTasks()
    const { googleAccount: _, ...sent } = task!

    const { body } = await call('PUT', `tasks/${task!.id}`, { task: { ...sent, name: 'Mine' } })
    expect(body.tasks[0]).toMatchObject({ name: 'Mine', googleAccount: EMAIL })
    expect(await listTasks()).toMatchObject([{ googleAccount: EMAIL }])
  })

  it("only syncs the signed-in user's accounts, into their own tasks", async () => {
    google.calendars.set('primary', { events: [allDay('a', inDays(2))] })
    await connect()
    const other = await helpers.signUp('other@example.com')

    expect(await sync(other)).toEqual([])
    await sync()
    expect(await listTasks(other)).toEqual([])
    expect(await listTasks()).toHaveLength(1)
  })
})

describe('change tracking', () => {
  const listEvents = async (): Promise<LoggedEvent[]> => (await call('GET', 'events')).body
  // Leaves out id and at, which differ from run to run
  const logged = async () => (await listEvents()).map(({ id: _, at: __, ...event }) => event)
  const fromGoogle = { source: 'google', taskSource: 'google', oldValue: null, newValue: null, deliveryDateAtTime: null }
  const project = (id: string, fields: Partial<Project>): Project => ({
    id,
    name: `Project ${id}`,
    description: '',
    deliveryDate: null,
    taskIds: [],
    priority: 'medium',
    links: [],
    tagIds: [],
    ...fields,
  })

  // Imports event a, due in 2 days, and returns its task
  async function imported() {
    google.calendars.set('primary', { events: [allDay('a', inDays(2))] })
    await connect()
    await sync()
    return (await listTasks())[0]!
  }

  it('logs each task it adds as created by Google, with its due date', async () => {
    google.calendars.set('primary', { events: [allDay('a', inDays(2)), allDay('b', inDays(3))] })
    await connect()
    await sync()

    // Tasks made in one sync list in id order, so both go by due date
    const tasks = byName(await listTasks())
    expect((await logged()).sort((x, y) => x.newValue!.localeCompare(y.newValue!))).toEqual(
      tasks.map((t) => ({ ...fromGoogle, kind: 'task_created', taskId: t.id, projectId: null, newValue: t.dueDate })),
    )
  })

  it('logs a moved event as a due date change, with the old and new dates, for each project', async () => {
    const task = await imported()
    await call('PUT', 'projects/p', { project: project('p', { taskIds: [task.id], deliveryDate: inDays(30) }) })
    const before = (await listEvents()).length

    google.calendars.set('primary', { events: [allDay('a', inDays(4))] })
    await sync()

    expect((await logged()).slice(before)).toEqual([
      {
        ...fromGoogle,
        kind: 'due_date_changed',
        taskId: task.id,
        projectId: 'p',
        oldValue: inDays(2),
        newValue: inDays(4),
        deliveryDateAtTime: inDays(30),
      },
    ])
  })

  it('logs nothing when only the name or description changed', async () => {
    await imported()
    const before = await listEvents()

    google.calendars.set('primary', { events: [allDay('a', inDays(2), { summary: 'Renamed', description: 'More' })] })
    expect((await sync())[0]).toMatchObject({ updated: 1 })

    expect(await listEvents()).toEqual(before)
  })

  it('logs nothing for a due date kept because of a clash', async () => {
    const task = await imported()
    await call('PUT', 'projects/p', { project: project('p', { taskIds: [task.id], deliveryDate: inDays(5) }) })
    const before = await listEvents()

    google.calendars.set('primary', { events: [allDay('a', inDays(9))] })
    expect((await sync())[0]).toMatchObject({ updated: 0, keptDates: 1 })

    expect(await listEvents()).toEqual(before)
  })

  it('logs a deleted event as the task deleted and removed from each project, with or without a delivery date', async () => {
    const task = await imported()
    await call('PUT', 'projects/p', { project: project('p', { taskIds: [task.id], deliveryDate: inDays(30) }) })
    await call('PUT', 'projects/q', { project: project('q', { taskIds: [task.id] }) })
    const before = (await listEvents()).length

    google.calendars.set('primary', { events: [] })
    expect((await sync())[0]).toMatchObject({ removed: 1 })

    const inP = { taskId: task.id, projectId: 'p', deliveryDateAtTime: inDays(30) }
    const inQ = { taskId: task.id, projectId: 'q', deliveryDateAtTime: null }
    expect((await logged()).slice(before)).toEqual([
      { ...fromGoogle, ...inP, kind: 'task_deleted' },
      { ...fromGoogle, ...inQ, kind: 'task_deleted' },
      { ...fromGoogle, ...inP, kind: 'task_removed_from_project' },
      { ...fromGoogle, ...inQ, kind: 'task_removed_from_project' },
    ])
  })

  it('logs a deleted event for a task in no project once', async () => {
    const task = await imported()
    google.calendars.set('primary', { events: [] })
    await sync()

    expect((await logged()).map((e) => [e.kind, e.taskId, e.projectId])).toEqual([
      ['task_created', task.id, null],
      ['task_deleted', task.id, null],
    ])
  })

  it('logs nothing for a sync that changes nothing', async () => {
    await imported()
    const before = await listEvents()

    expect((await sync())[0]).toMatchObject({ added: 0, updated: 0, removed: 0 })

    expect(await listEvents()).toEqual(before)
  })

  it('logs what is done to an imported task in the app as from the app, on a Google task', async () => {
    const task = await imported()
    await call('PUT', 'projects/p', { project: project('p', { taskIds: [task.id] }) })

    expect((await listEvents()).at(-1)).toMatchObject({ kind: 'task_added_to_project', source: 'app', taskSource: 'google' })
  })
})

describe('event mapping', () => {
  it('turns HTML descriptions into plain text', () => {
    expect(htmlToText('Agenda:<br>1. Intro<br/><b>2.</b> Q&amp;A &#8211; <a href="https://x.test/doc">doc</a>')).toBe(
      'Agenda:\n1. Intro\n2. Q&A – doc (https://x.test/doc)',
    )
    expect(htmlToText('<ul><li>One</li><li>Two</li></ul>')).toBe('• One\n• Two')
    expect(htmlToText('<a href="https://x.test">https://x.test</a>')).toBe('https://x.test')
    expect(htmlToText('  plain 1 < 2  ')).toBe('plain 1 < 2')
  })

  it('names untitled events, and skips events without times', () => {
    expect(eventFields(allDay('a', '2026-11-02', { summary: '  ' }))?.name).toBe('(No title)')
    expect(eventFields({ id: 'a' })).toBeNull()
  })

  it('takes the date an event starts on in its own time zone', () => {
    const fields = eventFields(timed('a', '2026-11-02T23:30:00-05:00', '2026-11-03T01:00:00-05:00'))
    expect(fields).toMatchObject({
      dueDate: '2026-11-02',
      description: 'Ends 2026-11-03',
      startsAt: '2026-11-03T04:30:00.000Z',
    })
  })

  it('reads the answers of a batch by Content-ID, whatever order they come in', () => {
    const body = batchBody('b', ['/calendar/v3/calendars/a/events', '/calendar/v3/calendars/b/events'])
    expect(body).toBe(
      '--b\r\nContent-Type: application/http\r\nContent-ID: <0>\r\n\r\nGET /calendar/v3/calendars/a/events\r\n\r\n' +
        '--b\r\nContent-Type: application/http\r\nContent-ID: <1>\r\n\r\nGET /calendar/v3/calendars/b/events\r\n\r\n' +
        '--b--\r\n',
    )
    const reply =
      '--x\nContent-Type: application/http\nContent-ID: <response-1>\n\nHTTP/1.1 404 Not Found\nContent-Type: application/json\n\n{"error":{}}\n' +
      '--x\nContent-Type: application/http\nContent-ID: <response-0>\n\nHTTP/1.1 200 OK\n\n{"items":[]}\n--x--'
    expect(parseBatch('multipart/mixed; boundary="x"', reply)).toEqual(
      new Map([
        ['1', { status: 404, body: '{"error":{}}' }],
        ['0', { status: 200, body: '{"items":[]}' }],
      ]),
    )
  })
})
