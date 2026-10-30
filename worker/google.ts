// Google Calendar import, for the routes under /api/google:
//
//   GET    /api/google/connect          -> sends the browser to Google to connect an account
//   GET    /api/google/callback         -> where Google sends it back: saves the account, then goes
//                                          to /?google=connected, or /?google=error&message=...
//   GET    /api/google/accounts         -> GoogleAccount[], the connected accounts
//   DELETE /api/google/accounts/:email  -> disconnects the account; 204
//   POST   /api/google/sync             -> imports every connected account's events; SyncResult[]
//
// A sync imports the events of every calendar shown in each account's Google Calendar, from now
// to a year ahead, as tasks in no project, with the account's email as Task.googleAccount. A task
// is due the day its event starts. Syncing again updates each task's name, due date and
// description from its event, keeping what was set in Pam (done, priority, relations, projects),
// adds tasks for new events and deletes the tasks whose events were deleted. A task in a project
// keeps its due date if its event moved past the project's delivery date, so the import never
// breaks the rule the task and project forms enforce.
//
// Each sync logs what it changed to task_events (src/types/events.ts) in the same batch, as
// source 'google': tasks it created, due dates it moved, and tasks it deleted, with the projects
// they leave. Changes to names and descriptions aren't logged.
//
// A user can only reach their own accounts and tasks: every query has the user_id of the session.
// Refresh tokens never leave the Worker.
import { forEachProject, newEvent, type ProjectDate, type TaskEvent } from '../src/types/events'
import type { GoogleAccount, SyncResult } from '../src/types/google'
import { MAX_EMAIL_LENGTH } from '../src/types/limits'
import { isPastDeadline } from '../src/types/project'
import { HttpError, type User } from './auth'
import { eventStatements } from './events'
import { jsonChunks } from './jsonChunks'
import {
  accessToken,
  authorizationUrl,
  eventFields,
  exchangeCode,
  GoogleError,
  listCalendars,
  listEvents,
  revoke,
  type OAuthClient,
  type TimeRange,
} from './googleCalendar'

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
const DAY = 24 * 60 * 60 * 1000
const SYNC_DAYS = 365 // how far ahead a sync looks
const STATE_MINUTES = 10 // how long the user has to connect at Google

// Encoding

const toBase64Url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const randomToken = () => toBase64Url(crypto.getRandomValues(new Uint8Array(32)))

// The PKCE code challenge for a verifier (S256)
const codeChallenge = async (verifier: string) =>
  toBase64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))

// The OAuth client, from the Worker's secrets. Google sends the browser back to this Worker, so
// the redirect URI follows wherever it is running (localhost in dev, the deployed domain live).
function oauthClient(env: Env, request: Request): OAuthClient {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new HttpError(503, 'Google Calendar isn’t set up yet: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are missing')
  }
  return {
    id: env.GOOGLE_CLIENT_ID,
    secret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: new URL('/api/google/callback', request.url).toString(),
  }
}

// Connecting

async function connect(db: D1Database, client: OAuthClient, userId: string) {
  const state = randomToken()
  const verifier = randomToken()
  await db.batch([
    db.prepare(`DELETE FROM google_auth_states WHERE expires_at <= ${NOW}`),
    db
      .prepare(
        `INSERT INTO google_auth_states (id, user_id, code_verifier, expires_at)
         VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?4))`,
      )
      .bind(state, userId, verifier, `+${STATE_MINUTES} minutes`),
  ])
  return Response.redirect(authorizationUrl(client, state, await codeChallenge(verifier)), 302)
}

// Takes the browser back to the app, which syncs straight away or shows the message
function backToApp(request: Request, query: Record<string, string>) {
  return Response.redirect(new URL(`/?${new URLSearchParams(query)}`, request.url).toString(), 302)
}

async function callback(db: D1Database, client: OAuthClient, userId: string, request: Request) {
  const params = new URL(request.url).searchParams
  const failed = (message: string) => backToApp(request, { google: 'error', message })

  // The state must be one this user started, and is used up whoever brings it back, so a link to
  // this page can't connect someone else's Google account to theirs
  const state = await db
    .prepare(
      `DELETE FROM google_auth_states WHERE id = ?1
       RETURNING user_id, code_verifier, expires_at > ${NOW} AS live`,
    )
    .bind(params.get('state') ?? '')
    .first<{ user_id: string; code_verifier: string; live: 0 | 1 }>()
  if (!state || state.user_id !== userId || !state.live) {
    return failed('Connecting to Google took too long or was started elsewhere. Try again.')
  }

  const refused = params.get('error')
  if (refused) {
    return failed(refused === 'access_denied' ? 'Google Calendar wasn’t connected.' : `Google refused (${refused}).`)
  }
  const code = params.get('code')
  if (!code) return failed('Google didn’t say whether the account was connected. Try again.')

  try {
    const { email, refreshToken } = await exchangeCode(client, code, state.code_verifier)
    await db
      .prepare(
        `INSERT INTO google_accounts (user_id, email, refresh_token) VALUES (?1, ?2, ?3)
         ON CONFLICT (user_id, email) DO UPDATE SET refresh_token = excluded.refresh_token`,
      )
      .bind(userId, email, refreshToken)
      .run()
  } catch (e) {
    if (e instanceof GoogleError) return failed(e.message)
    throw e
  }
  return backToApp(request, { google: 'connected' })
}

async function listAccounts(db: D1Database, userId: string): Promise<GoogleAccount[]> {
  const { results } = await db
    .prepare('SELECT email, synced_at AS syncedAt FROM google_accounts WHERE user_id = ?1 ORDER BY email')
    .bind(userId)
    .all<GoogleAccount>()
  return results
}

// Leaves the account's tasks as they are; connecting it again picks them up again
async function disconnect(db: D1Database, userId: string, email: string) {
  const account = await db
    .prepare('DELETE FROM google_accounts WHERE user_id = ?1 AND email = ?2 RETURNING refresh_token')
    .bind(userId, email)
    .first<{ refresh_token: string }>()
  if (account) await revoke(account.refresh_token)
}

// Syncing

// An imported task as stored, with the event it came from
interface LinkedRow {
  task_id: string
  calendar_id: string
  event_id: string
  starts_at: string
  ends_at: string
  name: string
  description: string
  due_date: string | null
}

// A project an imported task is in, with its delivery date
interface MembershipRow {
  task_id: string
  project_id: string
  delivery_date: string | null
}

const eventKey = (calendarId: string, eventId: string) => `${calendarId}\n${eventId}`

// Whether a sync of `range` should have listed the event, if it still existed. An all-day event's
// stored times can be a day off (see eventFields), so events within a day of either end of the
// range are left alone rather than deleted by mistake.
const shouldBeListed = (row: LinkedRow, range: TimeRange) =>
  Date.parse(row.ends_at) > Date.parse(range.timeMin) + DAY && Date.parse(row.starts_at) < Date.parse(range.timeMax) - DAY

async function syncAccount(
  db: D1Database,
  client: OAuthClient,
  userId: string,
  account: { email: string; refresh_token: string },
  range: TimeRange,
): Promise<SyncResult> {
  const result: SyncResult = { email: account.email, added: 0, updated: 0, removed: 0, keptDates: 0, failedCalendars: 0 }

  let listings: Awaited<ReturnType<typeof listEvents>>
  try {
    const token = await accessToken(client, account.refresh_token)
    listings = await listEvents(token, await listCalendars(token), range)
  } catch (e) {
    if (e instanceof GoogleError) return { ...result, error: e.message, reconnect: e.reconnect || undefined }
    throw e
  }

  const [linked, memberships] = (await db.batch([
    db
      .prepare(
        `SELECT g.task_id, g.calendar_id, g.event_id, g.starts_at, g.ends_at, t.name, t.description, t.due_date
         FROM google_events g JOIN tasks t ON t.user_id = g.user_id AND t.id = g.task_id
         WHERE g.user_id = ?1 AND g.account_email = ?2`,
      )
      .bind(userId, account.email),
    // Every project, with or without a delivery date, as the events name each one. In the order
    // the app lists projects, as diffEvents logs them.
    db
      .prepare(
        `SELECT pt.task_id, pt.project_id, p.delivery_date FROM project_tasks pt
         JOIN projects p ON p.user_id = pt.user_id AND p.id = pt.project_id
         JOIN google_events g ON g.user_id = pt.user_id AND g.task_id = pt.task_id
         WHERE pt.user_id = ?1 AND g.account_email = ?2
         ORDER BY p.created_at, p.id`,
      )
      .bind(userId, account.email),
  ])) as [D1Result<LinkedRow>, D1Result<MembershipRow>]
  const byEvent = new Map(linked.results.map((row) => [eventKey(row.calendar_id, row.event_id), row]))
  const projectsOf = new Map<string, ProjectDate[]>()
  for (const row of memberships.results) {
    projectsOf.set(row.task_id, [...(projectsOf.get(row.task_id) ?? []), { id: row.project_id, deliveryDate: row.delivery_date }])
  }
  const projects = (taskId: string) => projectsOf.get(taskId) ?? []
  const isLate = (taskId: string, dueDate: string) => projects(taskId).some((p) => isPastDeadline(dueDate, p.deliveryDate))
  const syncEvent = (kind: TaskEvent['kind'], taskId: string, fields: Partial<TaskEvent> = {}) =>
    newEvent(kind, 'google', { taskId, taskSource: 'google', ...fields })

  const added: { id: string; name: string; description: string; dueDate: string }[] = []
  const updated: { id: string; name: string; description: string; dueDate: string | null }[] = []
  const links: { taskId: string; calendarId: string; eventId: string; startsAt: string; endsAt: string }[] = []
  const logged: TaskEvent[] = [] // what the sync logs
  const seen = new Set<string>()
  const listed = new Set<string>() // calendars whose events were all listed

  for (const [calendarId, events] of listings) {
    if (events instanceof GoogleError) {
      result.failedCalendars++
      continue
    }
    listed.add(calendarId)
    for (const event of events) {
      // Working locations ("Home", "Office") fill every day; they aren't things to do
      if (event.status === 'cancelled' || event.eventType === 'workingLocation') continue
      const fields = eventFields(event)
      const key = eventKey(calendarId, event.id)
      if (!fields || seen.has(key)) continue
      seen.add(key)
      const { startsAt, endsAt } = fields

      const row = byEvent.get(key)
      if (!row) {
        const id = crypto.randomUUID()
        added.push({ id, name: fields.name, description: fields.description, dueDate: fields.dueDate })
        logged.push(syncEvent('task_created', id, { newValue: fields.dueDate }))
        links.push({ taskId: id, calendarId, eventId: event.id, startsAt, endsAt })
        continue
      }

      let dueDate: string | null = fields.dueDate
      if (dueDate !== row.due_date && isLate(row.task_id, dueDate)) {
        dueDate = row.due_date
        result.keptDates++
      }
      if (fields.name !== row.name || fields.description !== row.description || dueDate !== row.due_date) {
        updated.push({ id: row.task_id, name: fields.name, description: fields.description, dueDate })
      }
      // A date kept because of a clash is unchanged, so it isn't logged
      if (dueDate !== row.due_date) {
        const moved = syncEvent('due_date_changed', row.task_id, { oldValue: row.due_date, newValue: dueDate })
        logged.push(...forEachProject(moved, projects(row.task_id)))
      }
      if (startsAt !== row.starts_at || endsAt !== row.ends_at) {
        links.push({ taskId: row.task_id, calendarId, eventId: event.id, startsAt, endsAt })
      }
    }
  }

  // Deleted events, which a calendar that was listed in full no longer has. Calendars that failed
  // or were hidden in Google Calendar keep their tasks.
  const removed = linked.results
    .filter((row) => listed.has(row.calendar_id) && !seen.has(eventKey(row.calendar_id, row.event_id)))
    .filter((row) => shouldBeListed(row, range))
    .map((row) => row.task_id)
  for (const taskId of removed) logged.push(...forEachProject(syncEvent('task_deleted', taskId), projects(taskId)))
  for (const taskId of removed) {
    for (const project of projects(taskId)) {
      logged.push(syncEvent('task_removed_from_project', taskId, { projectId: project.id, deliveryDateAtTime: project.deliveryDate }))
    }
  }

  // One batch, so the account's sync is saved in full or not at all. Deleting a task deletes its
  // google_events row and takes it out of its projects.
  try {
    await db.batch([
      ...jsonChunks(added).map((json) =>
        db
          .prepare(
            `INSERT INTO tasks (user_id, id, name, description, due_date)
             SELECT ?1, value ->> '$.id', value ->> '$.name', value ->> '$.description', value ->> '$.dueDate'
             FROM json_each(?2)`,
          )
          .bind(userId, json),
      ),
      ...jsonChunks(updated).map((json) =>
        db
          .prepare(
            `UPDATE tasks SET name = item.value ->> '$.name', description = item.value ->> '$.description',
               due_date = item.value ->> '$.dueDate', updated_at = ${NOW}
             FROM json_each(?2) AS item
             WHERE tasks.user_id = ?1 AND tasks.id = item.value ->> '$.id'`,
          )
          .bind(userId, json),
      ),
      ...jsonChunks(links).map((json) =>
        db
          .prepare(
            `INSERT INTO google_events (user_id, task_id, account_email, calendar_id, event_id, starts_at, ends_at)
             SELECT ?1, value ->> '$.taskId', ?2, value ->> '$.calendarId', value ->> '$.eventId',
               value ->> '$.startsAt', value ->> '$.endsAt'
             FROM json_each(?3) WHERE true
             ON CONFLICT (user_id, task_id) DO UPDATE SET starts_at = excluded.starts_at, ends_at = excluded.ends_at`,
          )
          .bind(userId, account.email, json),
      ),
      ...jsonChunks(removed).map((json) =>
        db
          .prepare('DELETE FROM tasks WHERE user_id = ?1 AND id IN (SELECT value FROM json_each(?2))')
          .bind(userId, json),
      ),
      ...eventStatements(db, userId, new Date().toISOString(), logged),
      db
        .prepare(`UPDATE google_accounts SET synced_at = ${NOW} WHERE user_id = ?1 AND email = ?2`)
        .bind(userId, account.email),
    ])
  } catch (e) {
    // Another sync of the account added the same events first
    if (String(e).includes('UNIQUE constraint failed: google_events')) {
      return { ...result, error: 'Another sync of this account ran at the same time. Sync again.' }
    }
    throw e
  }

  return { ...result, added: added.length, updated: updated.length, removed: removed.length }
}

// Syncs the accounts one after another, so their requests to Google and D1 don't pile up at once
async function sync(db: D1Database, client: OAuthClient, userId: string): Promise<SyncResult[]> {
  const { results: accounts } = await db
    .prepare('SELECT email, refresh_token FROM google_accounts WHERE user_id = ?1 ORDER BY email')
    .bind(userId)
    .all<{ email: string; refresh_token: string }>()
  const now = Date.now()
  const range = { timeMin: new Date(now).toISOString(), timeMax: new Date(now + SYNC_DAYS * DAY).toISOString() }
  const results: SyncResult[] = []
  for (const account of accounts) results.push(await syncAccount(db, client, userId, account, range))
  return results
}

// Routing

function decodeEmail(raw: string) {
  let email: string
  try {
    email = decodeURIComponent(raw)
  } catch {
    throw new HttpError(400, 'The email in the URL is not correctly encoded')
  }
  if (email.length > MAX_EMAIL_LENGTH) throw new HttpError(400, `email must be at most ${MAX_EMAIL_LENGTH} characters`)
  return email
}

// Handles /api/google/<path> for the signed-in user. readBody reads and checks a JSON body: a
// sync is a POST with a JSON body, like the other saves, so a form on another site can't start one.
export async function handleGoogle(
  env: Env,
  request: Request,
  user: User,
  path: (string | undefined)[],
  readBody: () => Promise<unknown>,
): Promise<Response> {
  const [action, rawEmail, ...rest] = path
  const method = request.method
  const route = rest.length > 0 ? undefined : rawEmail === undefined ? action : `${action}/:email`

  switch (route) {
    case 'connect':
      if (method !== 'GET') break
      return connect(env.DB, oauthClient(env, request), user.id)
    case 'callback':
      if (method !== 'GET') break
      return callback(env.DB, oauthClient(env, request), user.id, request)
    case 'accounts':
      if (method !== 'GET') break
      return Response.json(await listAccounts(env.DB, user.id))
    case 'accounts/:email':
      if (method !== 'DELETE') break
      await disconnect(env.DB, user.id, decodeEmail(rawEmail!))
      return new Response(null, { status: 204 })
    case 'sync': {
      if (method !== 'POST') break
      const client = oauthClient(env, request)
      await readBody()
      return Response.json(await sync(env.DB, client, user.id))
    }
    default:
      throw new HttpError(404, 'Not found')
  }
  throw new HttpError(405, 'Method not allowed')
}
