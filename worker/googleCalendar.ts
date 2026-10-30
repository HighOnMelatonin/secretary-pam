// Client for the Google APIs the calendar import uses: OAuth 2.0 for web server apps, with PKCE
// and offline access (https://developers.google.com/identity/protocols/oauth2/web-server), and
// the Calendar API's calendarList.list and events.list. Everything goes through the global fetch.
//
// The events of all of an account's calendars are listed in batch requests, as Google recommends
// (https://developers.google.com/workspace/calendar/api/guides/batch): one HTTP request holds an
// events.list call per calendar, rather than a request each. Google may run the calls in any
// order and answers in one multipart/mixed response, so each answer is matched to its call by
// its Content-ID rather than its position. A calendar with more events than fit on one page gets
// its next page in a further batch, which holds only the calendars that have more. Each call
// still counts towards the quota on its own, so calls that are rate limited are tried again after
// a pause, in the next batch.
import { MAX_DESCRIPTION_LENGTH, MAX_NAME_LENGTH } from '../src/types/limits'
import { addDays } from '../src/types/upcoming'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const CALENDAR_URL = 'https://www.googleapis.com/calendar/v3'
const BATCH_URL = 'https://www.googleapis.com/batch/calendar/v3'

// The narrowest scopes the sync can use: calendarList.list for the shown calendars, and
// events.list for their events. Neither scope covers the other's call.
const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
]
// Covers both calls. Accounts connected before Pam asked for the narrower scopes granted this,
// and Google keeps it in a new grant (include_granted_scopes) until Pam's access is revoked.
const BROAD_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'
// Reading calendars, and the account's email for the imported tasks' badge
const SCOPES = ['openid', 'email', ...CALENDAR_SCOPES]

const MAX_BATCH_CALLS = 1000 // the most calls Google takes in one batch
const PAGE_SIZE = 2500 // the most events events.list returns on one page
const MAX_ATTEMPTS = 4 // for a request that was rate limited or failed on Google's side
// Only the fields the import uses, so Google sends less
const EVENT_FIELDS = 'items(id,status,eventType,summary,description,start,end),nextPageToken'

// Waits between attempts. An object so tests can replace it.
export const timing = {
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}

// Google refused or couldn't be reached
export class GoogleError extends Error {
  constructor(
    message: string,
    readonly reconnect = false, // Pam's access was revoked or has expired
  ) {
    super(message)
  }
}

export interface OAuthClient {
  id: string
  secret: string
  redirectUri: string // /api/google/callback on this Worker; must be listed on the client in Google Cloud
}

// OAuth

// Where to send the browser to connect an account. `state` comes back with the browser, and
// `codeChallenge` is the SHA-256 of the PKCE verifier that exchangeCode sends.
export function authorizationUrl(client: OAuthClient, state: string, codeChallenge: string) {
  const params = new URLSearchParams({
    client_id: client.id,
    redirect_uri: client.redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline', // for a refresh token, so later syncs don't need the user at Google
    prompt: 'consent select_account', // Google only sends a refresh token when it asks for consent
    include_granted_scopes: 'true',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })
  return `${AUTH_URL}?${params}`
}

async function tokenRequest(fields: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await withRetries(() =>
    fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
    }),
  )
  const body = await response.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>)
  if (response.ok) return body
  // The refresh token was revoked, expired or belongs to another client
  if (body.error === 'invalid_grant') {
    throw new GoogleError('Google no longer accepts Pam’s access to this account. Connect it again.', true)
  }
  throw new GoogleError(`Google refused to sign in (${body.error ?? response.status})`)
}

export interface Connection {
  email: string
  refreshToken: string
}

// Swaps the code Google sent back with the browser for a refresh token and the account's email
export async function exchangeCode(client: OAuthClient, code: string, codeVerifier: string): Promise<Connection> {
  const body = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    redirect_uri: client.redirectUri,
    client_id: client.id,
    client_secret: client.secret,
  })
  // Google lets the user untick a permission on the consent screen
  const granted = new Set(String(body.scope ?? '').split(' '))
  if (!granted.has(BROAD_CALENDAR_SCOPE) && !CALENDAR_SCOPES.every((scope) => granted.has(scope))) {
    throw new GoogleError('Pam needs permission to see your calendars. Connect again and allow it.')
  }
  if (typeof body.refresh_token !== 'string') throw new GoogleError('Google didn’t give Pam lasting access. Try again.')
  return { email: idTokenEmail(body.id_token), refreshToken: body.refresh_token }
}

// The ID token came straight from Google's token endpoint over HTTPS, so its claims can be read
// without checking its signature
// (https://developers.google.com/identity/openid-connect/openid-connect#obtainuserinfo)
function idTokenEmail(idToken: unknown): string {
  let claims: Record<string, unknown> = {}
  try {
    // The payload is the middle part, in base64url without padding
    const base64 = String(idToken).split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')
    const bytes = Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (c) => c.charCodeAt(0))
    claims = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    // claims stays empty
  }
  if (typeof claims.email !== 'string' || claims.email_verified !== true) {
    throw new GoogleError('Google didn’t share a verified email for the account')
  }
  return claims.email.toLowerCase()
}

// A short-lived access token for the account's refresh token
export async function accessToken(client: OAuthClient, refreshToken: string): Promise<string> {
  const body = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: client.id,
    client_secret: client.secret,
  })
  if (typeof body.access_token !== 'string') throw new GoogleError('Google didn’t send an access token')
  return body.access_token
}

// Tells Google to drop Pam's access. Best effort: the account is disconnected in Pam either way.
export async function revoke(refreshToken: string) {
  await fetch(REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken }),
  }).catch(() => undefined)
}

// Requests

// Whether Google asks for the request to be tried again later: rate limits (429, or 403 with a
// rate limit reason) and errors on its side
function isRetryable(status: number, body: string) {
  if (status === 429 || status >= 500) return true
  return status === 403 && /"reason":\s*"(rateLimitExceeded|userRateLimitExceeded)"/.test(body)
}

// Pauses for 1, 2, 4… seconds between attempts, as Google suggests (exponential backoff)
const backoff = (attempt: number) => timing.sleep(1000 * 2 ** (attempt - 1))

// Sends the request, trying again after a pause while Google says to
async function withRetries(send: () => Promise<Response>): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    let response: Response
    try {
      response = await send()
    } catch {
      throw new GoogleError('Couldn’t reach Google')
    }
    if (attempt === MAX_ATTEMPTS || !isRetryable(response.status, await response.clone().text())) return response
    await backoff(attempt)
  }
}

// The message in one of Google's error replies
function errorMessage(status: number, body: string) {
  try {
    const message = JSON.parse(body)?.error?.message
    if (typeof message === 'string') return `${message} (${status})`
  } catch {
    // not JSON
  }
  return `Google answered ${status}`
}

async function getJson<T>(url: string, token: string): Promise<T> {
  const response = await withRetries(() => fetch(url, { headers: { Authorization: `Bearer ${token}` } }))
  const body = await response.text()
  if (!response.ok) throw new GoogleError(errorMessage(response.status, body), response.status === 401)
  return JSON.parse(body)
}

// Calendars

interface CalendarListPage {
  items?: { id: string; selected?: boolean }[]
  nextPageToken?: string
}

// The calendars shown in the account's Google Calendar, among those whose events it can read
export async function listCalendars(token: string): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({
      minAccessRole: 'reader', // free/busy-only calendars don't show their events' details
      maxResults: '250',
      fields: 'items(id,selected),nextPageToken',
      ...(pageToken ? { pageToken } : {}),
    })
    const page = await getJson<CalendarListPage>(`${CALENDAR_URL}/users/me/calendarList?${params}`, token)
    ids.push(...(page.items ?? []).filter((c) => c.selected).map((c) => c.id))
    pageToken = page.nextPageToken
  } while (pageToken)
  return ids
}

// Events

export interface EventTime {
  date?: string // an all-day event's date
  dateTime?: string // a timed event's time, with the offset of its time zone
}

export interface GoogleEvent {
  id: string
  status?: string // "cancelled" once deleted
  eventType?: string // "default", "workingLocation", "outOfOffice", ...
  summary?: string
  description?: string
  start?: EventTime
  end?: EventTime
}

export interface TimeRange {
  timeMin: string // events that end after this UTC timestamp...
  timeMax: string // ...and start before this one
}

// One events.list call in a batch
interface Call {
  calendarId: string
  pageToken?: string
  attempt: number
}

// The calendar's events, or why they couldn't be listed
export type Listing = GoogleEvent[] | GoogleError

// Lists the events in the range of every calendar, in batches, each repeating event as its own
// events. A calendar that fails doesn't stop the others.
export async function listEvents(token: string, calendarIds: string[], range: TimeRange) {
  const listings = new Map<string, Listing>(calendarIds.map((id) => [id, []]))
  let calls: Call[] = calendarIds.map((calendarId) => ({ calendarId, attempt: 1 }))

  while (calls.length > 0) {
    const retries = calls.filter((c) => c.attempt > 1)
    if (retries.length > 0) await backoff(Math.max(...retries.map((c) => c.attempt)) - 1)

    const next: Call[] = []
    for (let start = 0; start < calls.length; start += MAX_BATCH_CALLS) {
      const batch = calls.slice(start, start + MAX_BATCH_CALLS)
      const answers = await sendBatch(token, batch.map((call) => eventsPath(call, range)))
      batch.forEach((call, i) => {
        const answer = answers.get(String(i)) ?? { status: 0, body: '' } // left out of the reply
        const events = listings.get(call.calendarId)
        if (events instanceof GoogleError) return
        if (answer.status === 200) {
          const page = JSON.parse(answer.body) as { items?: GoogleEvent[]; nextPageToken?: string }
          events!.push(...(page.items ?? []))
          if (page.nextPageToken) next.push({ calendarId: call.calendarId, pageToken: page.nextPageToken, attempt: 1 })
        } else if ((answer.status === 0 || isRetryable(answer.status, answer.body)) && call.attempt < MAX_ATTEMPTS) {
          next.push({ ...call, attempt: call.attempt + 1 })
        } else {
          listings.set(call.calendarId, new GoogleError(errorMessage(answer.status, answer.body)))
        }
      })
    }
    calls = next
  }
  return listings
}

// The path of an events.list call. A batch's calls give only their path, not the whole URL.
function eventsPath({ calendarId, pageToken }: Call, range: TimeRange) {
  const params = new URLSearchParams({
    singleEvents: 'true', // each occurrence of a repeating event on its own, with its own date
    timeMin: range.timeMin,
    timeMax: range.timeMax,
    maxResults: String(PAGE_SIZE),
    fields: EVENT_FIELDS,
    ...(pageToken ? { pageToken } : {}),
  })
  return `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`
}

interface Answer {
  status: number
  body: string
}

// Sends GET requests for the paths as one batch, returning each answer by the index of its path.
// The Authorization header on the batch applies to every call in it.
async function sendBatch(token: string, paths: string[]): Promise<Map<string, Answer>> {
  const boundary = `batch_${crypto.randomUUID()}`
  const response = await withRetries(() =>
    fetch(BATCH_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/mixed; boundary=${boundary}` },
      body: batchBody(boundary, paths),
    }),
  )
  const body = await response.text()
  if (!response.ok) throw new GoogleError(errorMessage(response.status, body), response.status === 401)
  return parseBatch(response.headers.get('Content-Type') ?? '', body)
}

// Each call is a part of type application/http holding the request, with a Content-ID that its
// answer repeats as <response-…>
export function batchBody(boundary: string, paths: string[]) {
  const parts = paths.map(
    (path, i) => `--${boundary}\r\nContent-Type: application/http\r\nContent-ID: <${i}>\r\n\r\nGET ${path}\r\n\r\n`,
  )
  return `${parts.join('')}--${boundary}--\r\n`
}

// Splits a multipart/mixed batch response into its answers, by the Content-ID of the call each
// answers. Each part holds a whole HTTP response: a status line, headers, a blank line and the body.
export function parseBatch(contentType: string, body: string): Map<string, Answer> {
  const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1]
  if (!boundary) throw new GoogleError('Google’s answer to a batch request couldn’t be read')
  const answers = new Map<string, Answer>()
  for (const part of body.split(`--${boundary}`).slice(1)) {
    if (part.startsWith('--')) break // the closing delimiter
    const [headers, http] = splitAtBlankLine(part.replace(/^\r?\n/, ''))
    const [head, content] = splitAtBlankLine(http)
    const id = /^content-id:\s*<response-([^>]*)>/im.exec(headers)?.[1]
    const status = Number(/^HTTP\/[\d.]+ (\d{3})/.exec(head)?.[1] ?? 0)
    if (id !== undefined) answers.set(id, { status, body: content.trim() })
  }
  return answers
}

function splitAtBlankLine(text: string): [string, string] {
  const match = /\r?\n\r?\n/.exec(text)
  return match ? [text.slice(0, match.index), text.slice(match.index + match[0].length)] : [text, '']
}

// Events as tasks

export interface EventFields {
  name: string
  description: string
  dueDate: string
  startsAt: string // UTC timestamps of the event's start and end
  endsAt: string
}

// What a task takes from its event, or null for an event without times. The task is due the day
// the event starts, in the time zone Google gives its times in. An event that ends on a later day
// starts its description with the day it ends.
export function eventFields(event: GoogleEvent): EventFields | null {
  const { start, end } = event
  if (!start || !end || !(start.date || start.dateTime) || !(end.date || end.dateTime)) return null
  const startDate = start.date ?? start.dateTime!.slice(0, 10)
  const endDate = lastDay(end)
  const notes = htmlToText(event.description ?? '')
  const description = [endDate > startDate ? `Ends ${endDate}` : '', notes].filter(Boolean).join('\n\n')
  return {
    name: (event.summary?.trim() || '(No title)').slice(0, MAX_NAME_LENGTH),
    description: description.slice(0, MAX_DESCRIPTION_LENGTH),
    dueDate: startDate,
    startsAt: instant(start),
    endsAt: instant(end),
  }
}

// The last day the event takes up. Google's end dates are exclusive: an all-day event ends at
// the start of the day after its last, and so does a timed event that ends at midnight.
function lastDay(end: EventTime) {
  if (end.date) return addDays(end.date, -1)
  const date = end.dateTime!.slice(0, 10)
  return end.dateTime!.slice(11, 19) === '00:00:00' ? addDays(date, -1) : date
}

// An all-day event's date is taken as midnight UTC, which can be up to a day off its calendar's
// midnight; worker/google.ts allows for that
const instant = (time: EventTime) =>
  time.dateTime ? new Date(time.dateTime).toISOString() : `${time.date}T00:00:00.000Z`

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

// Descriptions written in Google Calendar are HTML; ones from other apps are plain text. Pam's
// are plain text, so the tags go: line breaks become new lines, list items bullets, and links
// keep their address after their text.
export function htmlToText(html: string) {
  if (!/<[a-z][^>]*>/i.test(html)) return html.trim()
  return html
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, text: string) =>
      text.replace(/<[^>]+>/g, '') === href ? href : `${text} (${href})`,
    )
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
      if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? entity
      const point = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : entity
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
