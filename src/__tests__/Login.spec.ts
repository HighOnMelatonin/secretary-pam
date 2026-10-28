import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import Login from '../components/login.vue'
import { button, routerAt } from './helpers'

// Stands in for /api/auth: `reply` answers sign-up and sign-in
function stubAuth(reply: () => Response) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => reply())
  vi.stubGlobal('fetch', fetch)
  return fetch
}

async function mountAt(path: string, mode: 'login' | 'signup') {
  const router = await routerAt(path)
  const wrapper = mount(Login, { props: { mode }, global: { plugins: [router] } })
  return { wrapper, router }
}

async function fill(wrapper: Awaited<ReturnType<typeof mountAt>>['wrapper'], fields: Record<string, string>) {
  const inputs = wrapper.findAll('input')
  for (const [i, value] of Object.values(fields).entries()) await inputs[i]!.setValue(value)
  await wrapper.find('form').trigger('submit')
  await flushPromises()
}

describe('Login', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.unstubAllGlobals())

  it('signs in and goes on to the page that was asked for', async () => {
    const fetch = stubAuth(() => Response.json({ email: 'me@example.com' }))
    const { wrapper, router } = await mountAt('/login?redirect=/tasks/new', 'login')
    await fill(wrapper, { email: 'me@example.com', password: 'secret password' })

    expect(fetch).toHaveBeenCalledWith('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'me@example.com', password: 'secret password' }),
    })
    expect(router.currentRoute.value.fullPath).toBe('/tasks/new')
  })

  it.each(['//example.com', '/\\example.com', 'https://example.com'])(
    'goes to the dashboard instead of a redirect to another site (%s)',
    async (redirect) => {
      stubAuth(() => Response.json({ email: 'me@example.com' }))
      const { wrapper, router } = await mountAt(`/login?redirect=${encodeURIComponent(redirect)}`, 'login')
      await fill(wrapper, { email: 'me@example.com', password: 'secret password' })
      expect(router.currentRoute.value.fullPath).toBe('/')
    },
  )

  it("shows the API's error and clears the password when signing in fails", async () => {
    stubAuth(() => Response.json({ error: 'Wrong email or password' }, { status: 401 }))
    const { wrapper, router } = await mountAt('/login', 'login')
    await fill(wrapper, { email: 'me@example.com', password: 'wrong password' })

    expect(wrapper.find('[role="alert"]').text()).toBe('Wrong email or password')
    expect((wrapper.find('input[type="password"]').element as HTMLInputElement).value).toBe('')
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('uses the browser password manager hints for each page', async () => {
    stubAuth(() => Response.json({}))
    const login = (await mountAt('/login', 'login')).wrapper
    expect(login.find('input[type="email"]').attributes('autocomplete')).toBe('username')
    expect(login.find('input[type="password"]').attributes('autocomplete')).toBe('current-password')

    const signup = (await mountAt('/signup', 'signup')).wrapper
    expect(signup.findAll('input[type="password"]').map((i) => i.attributes('autocomplete'))).toEqual([
      'new-password',
      'new-password',
    ])
  })

  it('creates an account, with the password typed twice', async () => {
    const fetch = stubAuth(() => Response.json({ email: 'me@example.com' }))
    const { wrapper, router } = await mountAt('/signup', 'signup')
    expect(button(wrapper, 'Create account').exists()).toBe(true)
    await fill(wrapper, { email: 'me@example.com', password: 'secret password', confirmation: 'secret password' })

    expect(fetch.mock.calls[0]![0]).toBe('/api/auth/signup')
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it("doesn't send a sign-up whose passwords don't match", async () => {
    const fetch = stubAuth(() => Response.json({ email: 'me@example.com' }))
    const { wrapper } = await mountAt('/signup', 'signup')
    await fill(wrapper, { email: 'me@example.com', password: 'secret password', confirmation: 'secret pasword' })

    expect(wrapper.find('[role="alert"]').text()).toBe("The passwords don't match")
    expect(fetch).not.toHaveBeenCalled()
  })

  it('links between the two pages, keeping where to go afterwards', async () => {
    stubAuth(() => Response.json({}))
    const { wrapper } = await mountAt('/login?redirect=/tags', 'login')
    expect(wrapper.find('a').attributes('href')).toBe('/signup?redirect=/tags')
  })
})
