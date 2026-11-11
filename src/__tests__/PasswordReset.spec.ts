// The forgot password page (forgotPassword.vue) and the page reset emails link to (resetPassword.vue)
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ForgotPassword from '../components/forgotPassword.vue'
import ResetPassword from '../components/resetPassword.vue'
import { browser } from '../stores/session'
import { button, routerAt } from './helpers'

const TOKEN = 'ab'.repeat(32)

// Stands in for /api/auth, answering every request with `reply`
function stubApi(reply: () => Response) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => reply())
  vi.stubGlobal('fetch', fetch)
  return fetch
}

async function mountAt(component: typeof ForgotPassword | typeof ResetPassword, path: string) {
  const router = await routerAt(path)
  const wrapper = mount(component, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return { wrapper, router }
}

async function submit(wrapper: Awaited<ReturnType<typeof mountAt>>['wrapper'], values: string[]) {
  const inputs = wrapper.findAll('input')
  for (const [i, value] of values.entries()) await inputs[i]!.setValue(value)
  await wrapper.find('form').trigger('submit')
  await flushPromises()
}

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.head.querySelectorAll('meta[name="referrer"]').forEach((m) => m.remove())
  document.body.innerHTML = ''
})

describe('ForgotPassword', () => {
  it('asks for a link, then says one is on its way without saying whether the account exists', async () => {
    const fetch = stubApi(() => new Response(null, { status: 204 }))
    const { wrapper } = await mountAt(ForgotPassword, '/forgot-password')
    await submit(wrapper, ['me@example.com'])

    expect(fetch).toHaveBeenCalledWith('/api/auth/forgot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'me@example.com' }),
    })
    expect(wrapper.find('[role="status"]').text()).toContain("If there's an account for me@example.com")
    expect(wrapper.find('form').exists()).toBe(false)
  })

  it("shows the API's error, such as too many requests", async () => {
    stubApi(() => Response.json({ error: 'Too many reset requests for this email. Try again in an hour.' }, { status: 429 }))
    const { wrapper } = await mountAt(ForgotPassword, '/forgot-password')
    await submit(wrapper, ['me@example.com'])
    expect(wrapper.find('[role="alert"]').text()).toBe('Too many reset requests for this email. Try again in an hour.')
    expect(wrapper.find('form').exists()).toBe(true)
  })
})

describe('ResetPassword', () => {
  it('takes the token out of the address bar and sends no Referer', async () => {
    stubApi(() => new Response(null, { status: 204 }))
    const { router } = await mountAt(ResetPassword, `/reset-password?token=${TOKEN}`)
    expect(router.currentRoute.value.fullPath).toBe('/reset-password')
    expect(document.head.querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe('no-referrer')
  })

  it('sets the new password, typed twice, then reloads at the sign-in page', async () => {
    const fetch = stubApi(() => new Response(null, { status: 204 }))
    const load = vi.spyOn(browser, 'load').mockImplementation(() => {})
    const { wrapper } = await mountAt(ResetPassword, `/reset-password?token=${TOKEN}`)
    expect(wrapper.findAll('input[type="password"]').map((i) => i.attributes('autocomplete'))).toEqual([
      'new-password',
      'new-password',
    ])
    await submit(wrapper, ['a new password', 'a new password'])

    // The token still goes with the request after leaving the address bar
    expect(fetch).toHaveBeenCalledWith('/api/auth/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN, password: 'a new password' }),
    })
    expect(load).toHaveBeenCalledWith('/login?reset=done')
  })

  it("doesn't send passwords that don't match", async () => {
    const fetch = stubApi(() => new Response(null, { status: 204 }))
    const { wrapper } = await mountAt(ResetPassword, `/reset-password?token=${TOKEN}`)
    await submit(wrapper, ['a new password', 'a new pasword'])
    expect(wrapper.find('[role="alert"]').text()).toBe("The passwords don't match")
    expect(fetch).not.toHaveBeenCalled()
  })

  it("shows the API's error with a way to ask for a new link, and clears the passwords", async () => {
    const message = 'This reset link has expired or has already been used. Ask for a new one.'
    stubApi(() => Response.json({ error: message }, { status: 400 }))
    const load = vi.spyOn(browser, 'load').mockImplementation(() => {})
    const { wrapper } = await mountAt(ResetPassword, `/reset-password?token=${TOKEN}`)
    await submit(wrapper, ['a new password', 'a new password'])

    expect(wrapper.find('[role="alert"]').text()).toBe(message)
    expect(wrapper.find('a[href="/forgot-password"]').exists()).toBe(true)
    expect((wrapper.find('input[type="password"]').element as HTMLInputElement).value).toBe('')
    expect(load).not.toHaveBeenCalled()
  })

  it('says a link without a token is incomplete, and offers a new one', async () => {
    stubApi(() => new Response(null, { status: 204 }))
    const { wrapper } = await mountAt(ResetPassword, '/reset-password')
    expect(wrapper.find('[role="alert"]').text()).toContain('This link is incomplete')
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.find('a[href="/forgot-password"]').exists()).toBe(true)
    expect(() => button(wrapper, 'Set new password')).toThrow()
  })
})
