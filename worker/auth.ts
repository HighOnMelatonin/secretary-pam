// Accounts and sessions, for the routes under /api/auth:
//
//   POST /api/auth/signup  { email, password } -> creates an account and signs in; { email }
//   POST /api/auth/login   { email, password } -> signs in; { email }
//   POST /api/auth/logout                      -> signs out; 204
//   GET  /api/auth/me                          -> { email } of whoever is signed in, or 401
//   POST /api/auth/forgot  { email }           -> emails a reset link if the email has an account; 204
//   POST /api/auth/reset   { token, password } -> sets the password from a reset link; 204
//
// Passwords are stored as salted PBKDF2 hashes. Signing in sets an HttpOnly cookie holding a
// random session token; D1 keeps only the token's SHA-256 hash (see migrations/0004).
//
// Password reset follows OWASP's Forgot Password Cheat Sheet
// (https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html):
// - Asking for a link gets the same answer, in the same time, whether or not the email has an
//   account: the answer depends only on the email typed, and looking up the account, making the
//   link and sending it happen after the response is sent.
// - Each email can ask for a few links an hour, counted whether or not it has an account.
// - The link holds a random 256-bit token. D1 keeps only its SHA-256 hash, and it works once,
//   for 30 minutes. Asking for a link changes nothing about the account until a link is used.
// - The link is built from APP_ORIGIN, never from the request's Host header.
// - Using a link sets the password under the same rules as signing up, signs every device out,
//   deletes the account's other links, and emails a notice. It doesn't sign in: the user signs
//   in with the new password.
import { ARCHIVE_TAG_ID } from '../src/types/tag'
import { MAX_EMAIL_LENGTH, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../src/types/limits'
import { canSendEmail, mailer } from './email'

// Thrown for requests that can't be handled; becomes a response with this status
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export interface User {
  id: string
  email: string
}

const ITERATIONS = 100_000 // the most PBKDF2 iterations the Workers runtime allows
const SESSION_DAYS = 30
const COOKIE = 'pam_session'
// More failed sign-ins than this for one email within the window, and it is locked until they age out
const MAX_FAILURES = 10
const FAILURE_WINDOW = '-15 minutes'
// How long a reset link works, and how many links one email can ask for within the window
export const RESET_MINUTES = 30
const MAX_RESET_REQUESTS = 3
const RESET_REQUEST_WINDOW = '-1 hour'

// The account holding the data from before accounts existed; the first sign-up takes it over
const ORIGINAL_USER_ID = 'original'

// What a new account starts with, like a new database did before accounts
const STARTING_TAGS = [
  { id: 'school', name: 'School' },
  { id: 'work', name: 'Work' },
  { id: 'personal', name: 'Personal' },
  { id: ARCHIVE_TAG_ID, name: 'Archive' },
]

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`

// Checked against when an email has no account, so a wrong email takes as long as a wrong
// password and the timing doesn't give away which emails have accounts
const NO_ACCOUNT_HASH = `pbkdf2-sha256$${ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`

// Encoding

const toBase64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

// Passwords

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2-sha256$${ITERATIONS}$${toBase64(salt)}$${toBase64(await pbkdf2(password, salt, ITERATIONS))}`
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, iterations, salt, hash] = stored.split('$')
  if (scheme !== 'pbkdf2-sha256' || !iterations || !salt || !hash) return false
  const actual = await pbkdf2(password, fromBase64(salt), Number(iterations))
  const expected = fromBase64(hash)
  // Compared in constant time, so the time taken doesn't hint at how much of it matched
  return actual.byteLength === expected.byteLength && crypto.subtle.timingSafeEqual(actual, expected)
}

// Sessions

const sha256 = async (text: string) => toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))

function sessionToken(request: Request) {
  for (const cookie of (request.headers.get('Cookie') ?? '').split(';')) {
    const [name, ...value] = cookie.trim().split('=')
    if (name === COOKIE) return value.join('=')
  }
  return undefined
}

// Secure is left off for plain-http localhost, where browsers would refuse the cookie
function cookie(request: Request, value: string, maxAge: number) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${COOKIE}=${value}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

// 256 random bits, as hex, for session cookies and reset links
const randomToken = () => toHex(crypto.getRandomValues(new Uint8Array(32)).buffer)

// Starts a session for the user, returning the Set-Cookie header that signs the browser in
async function startSession(db: D1Database, request: Request, userId: string) {
  const token = randomToken()
  await db.batch([
    db.prepare(`DELETE FROM sessions WHERE expires_at <= ${NOW}`),
    db
      .prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?3))`)
      .bind(await sha256(token), userId, `+${SESSION_DAYS} days`),
  ])
  return cookie(request, token, SESSION_DAYS * 24 * 60 * 60)
}

// The user whose session cookie came with the request, if it is still valid
export async function currentUser(db: D1Database, request: Request): Promise<User | null> {
  const token = sessionToken(request)
  if (!token) return null
  return db
    .prepare(
      `SELECT users.id, users.email FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.id = ?1 AND sessions.expires_at > ${NOW}`,
    )
    .bind(await sha256(token))
    .first<User>()
}

// Request bodies

function parseObject(body: unknown) {
  if (typeof body !== 'object' || body === null) throw new HttpError(400, 'Body must be a JSON object')
  return body as Record<string, unknown>
}

function parseEmail(email: unknown) {
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(email.trim()) || email.length > MAX_EMAIL_LENGTH) {
    throw new HttpError(400, 'Enter a valid email address')
  }
  return email.trim().toLowerCase()
}

function parsePassword(password: unknown) {
  // Capped because hashing a very long password takes longer
  if (typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH) {
    throw new HttpError(400, `Password must be at most ${MAX_PASSWORD_LENGTH} characters`)
  }
  return password
}

// A password being set, by signing up or resetting, which must also be long enough
function parseNewPassword(password: unknown) {
  const parsed = parsePassword(password)
  if (parsed.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }
  return parsed
}

function parseCredentials(body: unknown) {
  const { email, password } = parseObject(body)
  return { email: parseEmail(email), password: parsePassword(password) }
}

// Routes

const signedIn = (user: Pick<User, 'email'>, setCookie: string) =>
  Response.json({ email: user.email }, { headers: { 'Set-Cookie': setCookie } })

async function signUp(db: D1Database, request: Request, body: unknown) {
  const { email, password } = parseCredentials(body)
  const hash = await hashPassword(parseNewPassword(password))

  // The first account takes over the data from before accounts existed
  const claimed = await db
    .prepare('UPDATE users SET email = ?1, password_hash = ?2 WHERE id = ?3 AND email IS NULL')
    .bind(email, hash, ORIGINAL_USER_ID)
    .run()
  let id = ORIGINAL_USER_ID
  if (claimed.meta.changes === 0) {
    id = crypto.randomUUID()
    await db.batch([
      db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?1, ?2, ?3)').bind(id, email, hash),
      ...STARTING_TAGS.map((tag) =>
        db.prepare('INSERT INTO tags (user_id, id, name) VALUES (?1, ?2, ?3)').bind(id, tag.id, tag.name),
      ),
    ])
  }
  return signedIn({ email }, await startSession(db, request, id))
}

async function logIn(db: D1Database, request: Request, body: unknown) {
  const { email, password } = parseCredentials(body)
  const failures = await db
    .prepare(`SELECT count(*) AS n FROM login_failures WHERE email = ?1 AND at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?2)`)
    .bind(email, FAILURE_WINDOW)
    .first<number>('n')
  if (failures! >= MAX_FAILURES) {
    throw new HttpError(429, 'Too many failed sign-ins for this email. Try again in 15 minutes.')
  }

  const user = await db
    .prepare('SELECT id, email, password_hash FROM users WHERE email = ?1')
    .bind(email)
    .first<User & { password_hash: string | null }>()
  if (!(await verifyPassword(password, user?.password_hash ?? NO_ACCOUNT_HASH)) || !user) {
    await db.batch([
      db.prepare(`DELETE FROM login_failures WHERE at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?1)`).bind(FAILURE_WINDOW),
      db.prepare('INSERT INTO login_failures (email) VALUES (?1)').bind(email),
    ])
    // The same message either way, so it doesn't say whether the email has an account
    throw new HttpError(401, 'Wrong email or password')
  }

  await db.prepare('DELETE FROM login_failures WHERE email = ?1').bind(email).run()
  return signedIn(user, await startSession(db, request, user.id))
}

async function logOut(db: D1Database, request: Request) {
  const token = sessionToken(request)
  if (token) await db.prepare('DELETE FROM sessions WHERE id = ?1').bind(await sha256(token)).run()
  return new Response(null, { status: 204, headers: { 'Set-Cookie': cookie(request, '', 0) } })
}

// Password reset

// Where reset links point: APP_ORIGIN, the app's own address, never the request's Host header,
// which a request could set to another site. Checked before anything about the email, so a
// missing setting gives the same answer for every email.
function appOrigin(env: Env) {
  if (!env.APP_ORIGIN || !canSendEmail(env)) {
    throw new HttpError(503, 'Password reset isn’t set up yet: APP_ORIGIN, EMAIL_FROM or the EMAIL binding is missing')
  }
  return new URL(env.APP_ORIGIN).origin
}

// Sending mail happens after the response, so a failure is logged rather than answered
function inBackground(ctx: ExecutionContext, work: Promise<unknown>, what: string) {
  ctx.waitUntil(work.catch((e) => console.error(`${what} failed`, e)))
}

async function requestReset(env: Env, ctx: ExecutionContext, body: unknown) {
  const origin = appOrigin(env)
  const email = parseEmail(parseObject(body).email)
  const db = env.DB

  const requests = await db
    .prepare(`SELECT count(*) AS n FROM reset_requests WHERE email = ?1 AND at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?2)`)
    .bind(email, RESET_REQUEST_WINDOW)
    .first<number>('n')
  if (requests! >= MAX_RESET_REQUESTS) {
    throw new HttpError(429, 'Too many reset requests for this email. Try again in an hour.')
  }
  await db.batch([
    db.prepare(`DELETE FROM reset_requests WHERE at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?1)`).bind(RESET_REQUEST_WINDOW),
    db.prepare('INSERT INTO reset_requests (email) VALUES (?1)').bind(email),
  ])

  // Everything that depends on whether the email has an account happens after the response
  inBackground(ctx, sendResetLink(env, origin, email), 'Sending a reset link')
  return new Response(null, { status: 204 })
}

async function sendResetLink(env: Env, origin: string, email: string) {
  const db = env.DB
  const user = await db.prepare('SELECT id FROM users WHERE email = ?1').bind(email).first<{ id: string }>()
  if (!user) return

  // Replaces the account's earlier link, so only the newest one works, and clears out expired ones
  const token = randomToken()
  await db.batch([
    db.prepare(`DELETE FROM password_resets WHERE user_id = ?1 OR expires_at <= ${NOW}`).bind(user.id),
    db
      .prepare(`INSERT INTO password_resets (id, user_id, expires_at) VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?3))`)
      .bind(await sha256(token), user.id, `+${RESET_MINUTES} minutes`),
  ])

  const link = `${origin}/reset-password?${new URLSearchParams({ token })}`
  await mailer.send(env, {
    to: email,
    subject: 'Reset your Pam password',
    text: [
      'Someone, hopefully you, asked to reset the password for your Pam account.',
      '',
      `To choose a new password, open this link within ${RESET_MINUTES} minutes:`,
      '',
      link,
      '',
      'The link works once. If you didn’t ask for it, ignore this email: your password stays as it is.',
    ].join('\n'),
  })
}

async function resetPassword(env: Env, ctx: ExecutionContext, request: Request, body: unknown) {
  const origin = appOrigin(env)
  const { token, password } = parseObject(body)
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) throw new HttpError(400, 'This reset link isn’t valid')
  const hash = await hashPassword(parseNewPassword(password))
  const db = env.DB

  // One transaction, with every statement finding the account through the link, so the link is
  // used at most once even when two requests bring it at the same time: the second finds it gone
  // and changes nothing. The link is deleted last, along with the account's others.
  const link = `SELECT user_id FROM password_resets WHERE id = ?1 AND expires_at > ${NOW}`
  const id = await sha256(token)
  const [updated] = await db.batch<User>([
    db.prepare(`UPDATE users SET password_hash = ?2 WHERE id = (${link}) RETURNING id, email`).bind(id, hash),
    // Signs out every device, in case someone else had the old password
    db.prepare(`DELETE FROM sessions WHERE user_id = (${link})`).bind(id),
    // Lifts any lock from failed sign-ins, which were guesses at the old password
    db.prepare(`DELETE FROM login_failures WHERE email = (SELECT email FROM users WHERE id = (${link}))`).bind(id),
    db.prepare(`DELETE FROM password_resets WHERE user_id = (${link})`).bind(id),
  ])
  const user = updated!.results[0]
  if (!user) throw new HttpError(400, 'This reset link has expired or has already been used. Ask for a new one.')

  inBackground(
    ctx,
    mailer.send(env, {
      to: user.email,
      subject: 'Your Pam password was changed',
      text: [
        `The password for your Pam account (${user.email}) was changed at ${new Date().toISOString()} (UTC), using a reset link sent to this address.`,
        '',
        'Every device signed in to Pam has been signed out. Sign in again with the new password.',
        '',
        `If you didn’t change it, someone else may have access to this email account. Secure it, then reset your Pam password again at ${origin}/forgot-password`,
      ].join('\n'),
    }),
    'Sending a password changed notice',
  )
  // This browser's session was deleted with the others, so its cookie goes too
  return new Response(null, { status: 204, headers: { 'Set-Cookie': cookie(request, '', 0) } })
}

// Handles /api/auth/<action>; readBody reads and checks the JSON body
export async function handleAuth(
  env: Env,
  ctx: ExecutionContext,
  request: Request,
  action: string | undefined,
  readBody: () => Promise<unknown>,
): Promise<Response> {
  const db = env.DB
  const method = request.method
  if (action === 'signup' && method === 'POST') return signUp(db, request, await readBody())
  if (action === 'login' && method === 'POST') return logIn(db, request, await readBody())
  if (action === 'logout' && method === 'POST') return logOut(db, request)
  if (action === 'forgot' && method === 'POST') return requestReset(env, ctx, await readBody())
  if (action === 'reset' && method === 'POST') return resetPassword(env, ctx, request, await readBody())
  if (action === 'me' && method === 'GET') {
    const user = await currentUser(db, request)
    if (!user) throw new HttpError(401, 'Not signed in')
    return Response.json({ email: user.email })
  }
  if (['signup', 'login', 'logout', 'forgot', 'reset', 'me'].includes(action ?? '')) {
    throw new HttpError(405, 'Method not allowed')
  }
  throw new HttpError(404, 'Not found')
}
