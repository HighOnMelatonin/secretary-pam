// Integration tests for password reset (worker/auth.ts), through the Worker's entry point.
// mailer.send is replaced, so the tests read the emails instead of anything being sent. Emails
// go out after the response, so the tests wait for them.
import { env, SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mailer, type Email } from '../email'
import { call, cookieOf, PASSWORD, signUp } from './helpers'

const NEW_PASSWORD = 'a brand new password'

let sent: Email[]

beforeEach(() => {
  sent = []
  vi.spyOn(mailer, 'send').mockImplementation(async (_env, email) => void sent.push(email))
})

afterEach(() => vi.restoreAllMocks())

const forgot = (email: string) => call('POST', 'auth/forgot', { email })
const reset = (token: string, password = NEW_PASSWORD) => call('POST', 'auth/reset', { token, password })
const logIn = (email: string, password: string) => call('POST', 'auth/login', { email, password })

// Waits for the nth email (1-based) and returns it
async function email(n = 1) {
  await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(n))
  return sent[n - 1]!
}

const tokenIn = (mail: Email) => mail.text.match(/\/reset-password\?token=([0-9a-f]{64})/)![1]!

// Asks for a link for the email and returns the token in it
async function askForLink(address = 'me@example.com') {
  const before = sent.length
  expect((await forgot(address)).status).toBe(204)
  return tokenIn(await email(before + 1))
}

describe('asking for a reset link', () => {
  it('emails a link to the account, built from APP_ORIGIN', async () => {
    await signUp('me@example.com')
    // The Host header names another site, which the link must not use
    const response = await SELF.fetch('https://evil.example/api/auth/forgot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ' ME@example.com ' }),
    })
    expect(response.status).toBe(204)

    const mail = await email()
    expect(mail.to).toBe('me@example.com')
    expect(mail.subject).toBe('Reset your Pam password')
    expect(mail.text).toMatch(/^https:\/\/pam\.example\/reset-password\?token=[0-9a-f]{64}$/m)
    expect(mail.text).not.toContain('evil.example')
  })

  it('stores only a hash of the token, which expires in 30 minutes', async () => {
    await signUp('me@example.com')
    const token = await askForLink()
    const row = (await env.DB.prepare(
      `SELECT id, (julianday(expires_at) - julianday('now')) * 24 * 60 AS minutes FROM password_resets`,
    ).first<{ id: string; minutes: number }>())!
    expect(row.id).toMatch(/^[0-9a-f]{64}$/)
    expect(row.id).not.toBe(token)
    expect(row.minutes).toBeGreaterThan(29)
    expect(row.minutes).toBeLessThanOrEqual(30)
  })

  it('gives the same answer for an email with no account, and sends nothing', async () => {
    await signUp('me@example.com')
    const noAccount = await forgot('nobody@example.com')
    const account = await forgot('me@example.com')
    expect(noAccount).toEqual(account)
    expect(noAccount).toMatchObject({ status: 204, body: null })

    // The account's email arrives, and is the only one
    await email()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(sent.map((m) => m.to)).toEqual(['me@example.com'])
    expect(await env.DB.prepare('SELECT count(*) AS n FROM password_resets').first('n')).toBe(1)
  })

  it("doesn't change the account: the old password still works", async () => {
    await signUp('me@example.com')
    await askForLink()
    expect((await logIn('me@example.com', PASSWORD)).status).toBe(200)
  })

  it.each<[string, unknown]>([
    ['an email without an @', { email: 'me' }],
    ['no email', {}],
    ['a body that is not an object', 'null'],
  ])('rejects %s', async (_, body) => {
    expect((await call('POST', 'auth/forgot', body)).status).toBe(400)
  })

  it('allows 3 requests an hour for each email, whether or not it has an account', async () => {
    await signUp('me@example.com')
    for (const address of ['me@example.com', 'nobody@example.com']) {
      for (let i = 0; i < 3; i++) expect((await forgot(address)).status).toBe(204)
      expect(await forgot(address)).toMatchObject({
        status: 429,
        body: { error: 'Too many reset requests for this email. Try again in an hour.' },
      })
    }
    expect((await forgot('other@example.com')).status).toBe(204)

    await env.DB.prepare("UPDATE reset_requests SET at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-61 minutes')").run()
    expect((await forgot('me@example.com')).status).toBe(204)
  })

  it('makes only the newest link work', async () => {
    await signUp('me@example.com')
    const first = await askForLink()
    const second = await askForLink()
    expect((await reset(first)).status).toBe(400)
    expect((await reset(second)).status).toBe(204)
  })
})

describe('resetting the password with a link', () => {
  it('sets the new password and asks the user to sign in with it', async () => {
    await signUp('me@example.com')
    const response = await reset(await askForLink())
    expect(response).toMatchObject({ status: 204, body: null })
    // Not signed in: the only cookie it sets is the one that clears this browser's
    expect(response.headers.get('Set-Cookie')).toMatch(/^pam_session=; .*Max-Age=0/)

    expect((await logIn('me@example.com', PASSWORD)).status).toBe(401)
    expect((await logIn('me@example.com', NEW_PASSWORD)).status).toBe(200)
  })

  it('signs out every device', async () => {
    const laptop = await signUp('me@example.com')
    const phone = cookieOf((await logIn('me@example.com', PASSWORD)).headers)
    await reset(await askForLink())
    expect((await call('GET', 'auth/me', undefined, laptop)).status).toBe(401)
    expect((await call('GET', 'auth/me', undefined, phone)).status).toBe(401)
  })

  it('emails a notice that the password changed, without the password', async () => {
    await signUp('me@example.com')
    await reset(await askForLink())
    const notice = await email(2)
    expect(notice.to).toBe('me@example.com')
    expect(notice.subject).toBe('Your Pam password was changed')
    expect(notice.text).toContain('https://pam.example/forgot-password')
    expect(notice.text).not.toContain(NEW_PASSWORD)
  })

  it('works only once, even when used twice at the same time', async () => {
    await signUp('me@example.com')
    const token = await askForLink()
    const [a, b] = await Promise.all([reset(token, 'first new password'), reset(token, 'second new password')])
    expect([a.status, b.status].sort()).toEqual([204, 400])
    expect((await reset(token)).body).toEqual({
      error: 'This reset link has expired or has already been used. Ask for a new one.',
    })
    expect(await env.DB.prepare('SELECT count(*) AS n FROM password_resets').first('n')).toBe(0)
  })

  it('refuses a link after 30 minutes', async () => {
    await signUp('me@example.com')
    const token = await askForLink()
    await env.DB.prepare("UPDATE password_resets SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 second')").run()
    expect((await reset(token)).status).toBe(400)
    expect((await logIn('me@example.com', PASSWORD)).status).toBe(200)
  })

  it('needs a new password that follows the sign-up rules, and keeps the link until then', async () => {
    await signUp('me@example.com')
    const token = await askForLink()
    expect(await reset(token, 'short')).toMatchObject({
      status: 400,
      body: { error: 'Password must be at least 8 characters' },
    })
    expect((await reset(token, 'x'.repeat(257))).status).toBe(400)
    expect((await reset(token)).status).toBe(204)
  })

  it.each<[string, unknown]>([
    ['a made-up token', { token: 'a'.repeat(64), password: NEW_PASSWORD }],
    ['a token that is not hex', { token: 'not a token', password: NEW_PASSWORD }],
    ['no token', { password: NEW_PASSWORD }],
  ])('refuses %s', async (_, body) => {
    expect((await call('POST', 'auth/reset', body)).status).toBe(400)
  })

  it('lifts the lock from failed sign-ins', async () => {
    await signUp('me@example.com')
    for (let i = 0; i < 10; i++) await logIn('me@example.com', 'wrong password')
    expect((await logIn('me@example.com', PASSWORD)).status).toBe(429)
    await reset(await askForLink())
    expect((await logIn('me@example.com', NEW_PASSWORD)).status).toBe(200)
  })

  it("resets only the link's account", async () => {
    await signUp('me@example.com')
    await signUp('other@example.com')
    const other = await signUp('third@example.com')
    await reset(await askForLink('me@example.com'))
    expect((await logIn('other@example.com', PASSWORD)).status).toBe(200)
    expect((await call('GET', 'auth/me', undefined, other)).status).toBe(200)
  })

  it.each([
    ['GET', 'auth/forgot'],
    ['GET', 'auth/reset'],
  ])('answers %s /api/%s with 405', async (method, path) => {
    expect((await call(method, path)).status).toBe(405)
  })
})
