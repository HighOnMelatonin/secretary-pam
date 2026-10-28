// Shared helpers for the integration tests: requests through the Worker's entry point, signed in
// or not
import { SELF } from 'cloudflare:test'

export const PASSWORD = 'correct horse battery'

// Sends a request as the browser holding `cookie`, or as one that isn't signed in. A string body
// is sent as it is, anything else as JSON.
export async function call(method: string, path: string, body?: unknown, cookie?: string) {
  const response = await SELF.fetch(`http://localhost/api/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers }
}

// The "name=value" part of a response's Set-Cookie header, to send back as a Cookie header
export const cookieOf = (headers: Headers) => headers.get('Set-Cookie')!.split(';')[0]!

// Signs up a new account and returns its session cookie
export async function signUp(email = 'me@example.com', password = PASSWORD) {
  const response = await call('POST', 'auth/signup', { email, password })
  if (response.status !== 200) throw new Error(`Sign-up failed: ${JSON.stringify(response.body)}`)
  return cookieOf(response.headers)
}
