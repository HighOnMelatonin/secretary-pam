import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import * as api from '../api'
import { requireSignIn } from '../router'
import { browser, redirectTarget, useSession } from '../stores/session'
import { createEmptyTask } from '../types/task'
import { memoryRouter } from './helpers'

// Stands in for the API, with `me` signed in, or no one when null
function stubApi(me: { email: string } | null) {
  const fetch = vi.fn(async (url: string) => {
    if (url === '/api/auth/me') return me ? Response.json(me) : Response.json({ error: 'Not signed in' }, { status: 401 })
    if (url === '/api/auth/logout') return new Response(null, { status: 204 })
    return me ? Response.json([]) : Response.json({ error: 'Sign in to continue' }, { status: 401 })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

// A memory router with the sign-in guard
async function guardedRouterAt(path: string) {
  const router = memoryRouter()
  requireSignIn(router)
  await router.push(path)
  return router
}

describe('redirectTarget', () => {
  it.each([
    ['/tasks/new', '/tasks/new'],
    ['/projects/p?x=1', '/projects/p?x=1'],
    ['//example.com', '/'],
    ['/\\example.com', '/'],
    ['https://example.com', '/'],
    ['javascript:alert(1)', '/'],
    [undefined, '/'],
    [['/a', '/b'], '/'],
  ])('turns %j into %j', (redirect, expected) => {
    expect(redirectTarget(redirect)).toBe(expected)
  })
})

describe('session', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('asks the API who is signed in only once', async () => {
    const fetch = stubApi({ email: 'me@example.com' })
    const session = useSession()
    await session.check()
    await session.check()
    expect(session.account).toEqual({ email: 'me@example.com' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('signs out through the API, then reloads at the sign-in page so no data stays in memory', async () => {
    const fetch = stubApi({ email: 'me@example.com' })
    const load = vi.spyOn(browser, 'load').mockImplementation(() => {})
    const session = useSession()
    await session.check()
    await session.logOut()

    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' })
    expect(session.account).toBeNull()
    expect(load).toHaveBeenCalledWith('/login')
  })

  it('sends a signed-out user to the sign-in page, remembering where they were going', async () => {
    stubApi(null)
    expect((await guardedRouterAt('/tasks/new')).currentRoute.value.fullPath).toBe('/login?redirect=/tasks/new')
    expect((await guardedRouterAt('/')).currentRoute.value.fullPath).toBe('/login')
  })

  it('lets a signed-out user open the sign-up page', async () => {
    stubApi(null)
    expect((await guardedRouterAt('/signup')).currentRoute.value.name).toBe('signup')
  })

  it('lets a signed-in user through, and sends them away from the sign-in pages', async () => {
    stubApi({ email: 'me@example.com' })
    expect((await guardedRouterAt('/tasks/new')).currentRoute.value.name).toBe('new-task')
    expect((await guardedRouterAt('/login')).currentRoute.value.name).toBe('dashboard')
  })

  it('reloads at the sign-in page when the session ends while the app is open', async () => {
    stubApi({ email: 'me@example.com' })
    const load = vi.spyOn(browser, 'load').mockImplementation(() => {})
    await guardedRouterAt('/tasks/new')

    stubApi(null)
    await expect(api.save('tasks', { ...createEmptyTask(), id: 't', name: 'T' })).rejects.toThrow('Sign in to continue')
    expect(load).toHaveBeenCalledWith('/login?redirect=%2Ftasks%2Fnew')
  })

  it("doesn't reload when signing in itself is refused", async () => {
    stubApi(null)
    const load = vi.spyOn(browser, 'load').mockImplementation(() => {})
    await guardedRouterAt('/login')
    await expect(api.auth.me()).rejects.toThrow('Not signed in')
    expect(load).not.toHaveBeenCalled()
  })
})
