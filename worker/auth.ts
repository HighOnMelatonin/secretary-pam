// Accounts and sessions, for the routes under /api/auth:
//
//   POST /api/auth/signup  { email, password } -> creates an account and signs in; { email }
//   POST /api/auth/login   { email, password } -> signs in; { email }
//   POST /api/auth/logout                      -> signs out; 204
//   GET  /api/auth/me                          -> { email } of whoever is signed in, or 401
//
// Passwords are stored as salted PBKDF2 hashes. Signing in sets an HttpOnly cookie holding a
// random session token; D1 keeps only the token's SHA-256 hash (see migrations/0004).
import { ARCHIVE_TAG_ID } from '../src/types/tag'
import { MAX_EMAIL_LENGTH, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../src/types/limits'

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

// The account holding the data from before accounts existed; the first sign-up takes it over
const ORIGINAL_USER_ID = 'original'

// What a new account starts with, like a new database did before accounts
const STARTING_TAGS = [
  { id: 'school', name: 'School (SUTD)' },
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

// Starts a session for the user, returning the Set-Cookie header that signs the browser in
async function startSession(db: D1Database, request: Request, userId: string) {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)).buffer)
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

function parseCredentials(body: unknown) {
  if (typeof body !== 'object' || body === null) throw new HttpError(400, 'Body must be a JSON object')
  const { email, password } = body as Record<string, unknown>
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(email.trim()) || email.length > MAX_EMAIL_LENGTH) {
    throw new HttpError(400, 'Enter a valid email address')
  }
  // Capped because hashing a very long password takes longer
  if (typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH) {
    throw new HttpError(400, `Password must be at most ${MAX_PASSWORD_LENGTH} characters`)
  }
  return { email: email.trim().toLowerCase(), password }
}

// Routes

const signedIn = (user: Pick<User, 'email'>, setCookie: string) =>
  Response.json({ email: user.email }, { headers: { 'Set-Cookie': setCookie } })

async function signUp(db: D1Database, request: Request, body: unknown) {
  const { email, password } = parseCredentials(body)
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }
  const hash = await hashPassword(password)

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

// Handles /api/auth/<action>; readBody reads and checks the JSON body
export async function handleAuth(
  db: D1Database,
  request: Request,
  action: string | undefined,
  readBody: () => Promise<unknown>,
): Promise<Response> {
  const method = request.method
  if (action === 'signup' && method === 'POST') return signUp(db, request, await readBody())
  if (action === 'login' && method === 'POST') return logIn(db, request, await readBody())
  if (action === 'logout' && method === 'POST') return logOut(db, request)
  if (action === 'me' && method === 'GET') {
    const user = await currentUser(db, request)
    if (!user) throw new HttpError(401, 'Not signed in')
    return Response.json({ email: user.email })
  }
  if (['signup', 'login', 'logout', 'me'].includes(action ?? '')) throw new HttpError(405, 'Method not allowed')
  throw new HttpError(404, 'Not found')
}
