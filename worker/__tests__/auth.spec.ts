// Integration tests for accounts and sessions (worker/auth.ts), through the Worker's entry point
import { env, SELF } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import { call, cookieOf, PASSWORD, signUp } from './helpers'

const logIn = (email: string, password = PASSWORD) => call('POST', 'auth/login', { email, password })
const me = (cookie?: string) => call('GET', 'auth/me', undefined, cookie)

describe('signing up', () => {
  it('creates an account, signs it in and starts it with the example tags and the Archive tag', async () => {
    const response = await call('POST', 'auth/signup', { email: '  Me@Example.com ', password: PASSWORD })
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ email: 'me@example.com' })

    const cookie = cookieOf(response.headers)
    expect((await me(cookie)).body).toEqual({ email: 'me@example.com' })
    expect((await call('GET', 'tags', undefined, cookie)).body).toEqual([
      { id: 'archive', name: 'Archive' },
      { id: 'personal', name: 'Personal' },
      { id: 'school', name: 'School (SUTD)' },
      { id: 'work', name: 'Work' },
    ])
  })

  it('stores the password only as a salted hash', async () => {
    await signUp('a@example.com')
    await signUp('b@example.com')
    const rows = (await env.DB.prepare('SELECT password_hash FROM users ORDER BY email').all<{ password_hash: string }>()).results
    for (const { password_hash } of rows) {
      expect(password_hash).toMatch(/^pbkdf2-sha256\$100000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
      expect(password_hash).not.toContain(PASSWORD)
    }
    // Different salts, so the same password hashes differently
    expect(rows[0]!.password_hash).not.toBe(rows[1]!.password_hash)
  })

  it('rejects an email that already has an account, ignoring case', async () => {
    await signUp('me@example.com')
    const response = await call('POST', 'auth/signup', { email: 'ME@example.com', password: PASSWORD })
    expect(response).toMatchObject({ status: 400, body: { error: 'There is already an account with that email' } })
  })

  it.each<[string, unknown]>([
    ['a password under 8 characters', { email: 'me@example.com', password: 'short' }],
    ['a password over 256 characters', { email: 'me@example.com', password: 'x'.repeat(257) }],
    ['an email without an @', { email: 'me', password: PASSWORD }],
    ['an email over 254 characters', { email: `${'x'.repeat(250)}@example.com`, password: PASSWORD }],
    ['no password', { email: 'me@example.com' }],
    ['a body that is not an object', 'null'],
  ])('rejects %s', async (_, body) => {
    expect((await call('POST', 'auth/signup', body)).status).toBe(400)
    expect(await env.DB.prepare('SELECT count(*) AS n FROM users').first('n')).toBe(0)
  })
})

describe('signing in', () => {
  it('signs in with the right password, ignoring the case of the email', async () => {
    await signUp('me@example.com')
    const response = await logIn('ME@example.com')
    expect(response).toMatchObject({ status: 200, body: { email: 'me@example.com' } })
    expect((await me(cookieOf(response.headers))).status).toBe(200)
  })

  it('gives the same answer for a wrong password and an email with no account', async () => {
    await signUp('me@example.com')
    const wrongPassword = await logIn('me@example.com', 'wrong password')
    const noAccount = await logIn('nobody@example.com')
    expect(wrongPassword).toMatchObject({ status: 401, body: { error: 'Wrong email or password' } })
    expect(noAccount).toMatchObject({ status: 401, body: wrongPassword.body })
    expect(wrongPassword.headers.get('Set-Cookie')).toBeNull()
  })

  it('locks an email for 15 minutes after 10 failed sign-ins, even with the right password', async () => {
    await signUp('me@example.com')
    for (let i = 0; i < 10; i++) expect((await logIn('me@example.com', 'wrong password')).status).toBe(401)
    expect((await logIn('me@example.com')).status).toBe(429)

    // Other emails aren't affected, and the lock lifts once the failures are 15 minutes old
    await signUp('other@example.com')
    expect((await logIn('other@example.com')).status).toBe(200)
    await env.DB.prepare("UPDATE login_failures SET at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-16 minutes')").run()
    expect((await logIn('me@example.com')).status).toBe(200)
  })

  it('forgets failed sign-ins after a successful one', async () => {
    await signUp('me@example.com')
    for (let i = 0; i < 9; i++) await logIn('me@example.com', 'wrong password')
    await logIn('me@example.com')
    await logIn('me@example.com', 'wrong password')
    expect((await logIn('me@example.com')).status).toBe(200)
  })

  it("can't sign in to the original account before it is claimed", async () => {
    await env.DB.prepare("INSERT INTO users (id) VALUES ('original')").run()
    expect((await call('POST', 'auth/login', { email: '', password: '' })).status).toBe(400)
    expect((await logIn('me@example.com', '')).status).toBe(401)
  })
})

describe('sessions', () => {
  it('sets an HttpOnly, SameSite cookie for the API only, Secure over https', async () => {
    const response = await call('POST', 'auth/signup', { email: 'me@example.com', password: PASSWORD })
    const header = response.headers.get('Set-Cookie')!
    expect(header).toMatch(/^pam_session=[0-9a-f]{64}; Path=\/api; HttpOnly; SameSite=Lax; Max-Age=2592000$/)

    const secure = await SELF.fetch('https://pam.example.com/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'me@example.com', password: PASSWORD }),
    })
    expect(secure.headers.get('Set-Cookie')).toMatch(/; Secure$/)
  })

  it('stores only a hash of the session token', async () => {
    const token = (await signUp()).split('=')[1]!
    const { id } = (await env.DB.prepare('SELECT id FROM sessions').first<{ id: string }>())!
    expect(id).toMatch(/^[0-9a-f]{64}$/)
    expect(id).not.toBe(token)
  })

  it('signs out by ending the session, so its cookie stops working', async () => {
    const cookie = await signUp()
    const response = await call('POST', 'auth/logout', undefined, cookie)
    expect(response.status).toBe(204)
    expect(response.headers.get('Set-Cookie')).toMatch(/^pam_session=; .*Max-Age=0/)
    expect((await me(cookie)).status).toBe(401)
    expect((await call('GET', 'tasks', undefined, cookie)).status).toBe(401)
  })

  it('ends only the session that signed out', async () => {
    await signUp('me@example.com')
    const phone = cookieOf((await logIn('me@example.com')).headers)
    const laptop = cookieOf((await logIn('me@example.com')).headers)
    await call('POST', 'auth/logout', undefined, phone)
    expect((await me(laptop)).status).toBe(200)
  })

  it('stops accepting a session after it expires', async () => {
    const cookie = await signUp()
    await env.DB.prepare("UPDATE sessions SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 second')").run()
    expect((await me(cookie)).status).toBe(401)
  })

  it('answers 401 for /api/auth/me when not signed in', async () => {
    expect(await me()).toMatchObject({ status: 401, body: { error: 'Not signed in' } })
  })
})

describe('auth routing', () => {
  it.each([
    ['GET', 'auth/login', 405],
    ['POST', 'auth/me', 405],
    ['GET', 'auth/users', 404],
    ['POST', 'auth', 404],
  ])('answers %s /api/%s with %i', async (method, path, status) => {
    expect((await call(method, path, method === 'POST' ? {} : undefined)).status).toBe(status)
  })

  it('needs sign-up and sign-in details sent as JSON', async () => {
    const response = await SELF.fetch('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `email=me@example.com&password=${PASSWORD}`,
    })
    expect(response.status).toBe(400)
  })
})

describe('the original account', () => {
  it('is taken over by the first sign-up, keeping its data, and only by the first', async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id) VALUES ('original')"),
      env.DB.prepare("INSERT INTO tasks (user_id, id, name) VALUES ('original', 't', 'From before accounts')"),
      env.DB.prepare("INSERT INTO tags (user_id, id, name) VALUES ('original', 'archive', 'Archive')"),
    ])

    const first = await signUp('me@example.com')
    expect((await call('GET', 'tasks', undefined, first)).body.map((t: { name: string }) => t.name)).toEqual(['From before accounts'])
    // It already has its tags, so it isn't given the starting ones
    expect((await call('GET', 'tags', undefined, first)).body).toEqual([{ id: 'archive', name: 'Archive' }])

    const second = await signUp('other@example.com')
    expect((await call('GET', 'tasks', undefined, second)).body).toEqual([])
  })
})
