import { afterEach, describe, it, expect, vi } from 'vitest'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '../App.vue'
import { browser, useSession } from '../stores/session'
import { button, routerAt } from './helpers'

// Stands in for the Worker API: every list request returns no items
function stubEmptyApi() {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
}

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('prompts to create a project when there are none', async () => {
    stubEmptyApi()
    const wrapper = mount(App, { global: { plugins: [createPinia(), await routerAt()] } })
    expect(wrapper.text()).toContain('Hi, its Pam')

    await flushPromises()
    expect(fetch).toHaveBeenCalledWith('/api/projects', undefined)
    expect(fetch).toHaveBeenCalledWith('/api/tasks', undefined)
    expect(wrapper.text()).toContain('Create a project')
  })

  it('shows who is signed in, with a button to sign out', async () => {
    stubEmptyApi()
    const load = vi.spyOn(browser, 'load').mockImplementation(() => {})
    const pinia = createPinia()
    setActivePinia(pinia)
    useSession().account = { email: 'me@example.com' }
    const wrapper = mount(App, { global: { plugins: [pinia, await routerAt()] } })

    expect(wrapper.find('.account').text()).toContain('me@example.com')
    await button(wrapper, 'Sign out').trigger('click')
    await flushPromises()
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' })
    expect(load).toHaveBeenCalledWith('/login')
    load.mockRestore()
  })

  it('shows no account or Sign out button when signed out', async () => {
    stubEmptyApi()
    const wrapper = mount(App, { global: { plugins: [createPinia(), await routerAt()] } })
    expect(wrapper.find('.account').exists()).toBe(false)
    expect(wrapper.find('.app-nav').exists()).toBe(false)
  })

  it('links to the projects and the calendar from the header, marking the open one', async () => {
    stubEmptyApi()
    const pinia = createPinia()
    setActivePinia(pinia)
    useSession().account = { email: 'me@example.com' }
    const router = await routerAt()
    const wrapper = mount(App, { global: { plugins: [pinia, router] } })
    const links = () => wrapper.findAll('.app-nav a').map((a) => [a.text(), a.attributes('href'), a.attributes('aria-current')])
    expect(links()).toEqual([
      ['Projects', '/', 'page'],
      ['Calendar', '/calendar', undefined],
    ])

    await wrapper.findAll('.app-nav a')[1]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('calendar')
    expect(links()[1]![2]).toBe('page')
    expect(wrapper.find('#calendar-heading').exists()).toBe(true)
  })

  it('shows an error when the projects cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'D1 is down' }, { status: 500 })))
    const wrapper = mount(App, { global: { plugins: [createPinia(), await routerAt()] } })

    await flushPromises()
    expect(wrapper.text()).toContain("Couldn't load your projects: D1 is down")
  })
})
