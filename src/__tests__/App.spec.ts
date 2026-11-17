import { afterEach, describe, it, expect, vi } from 'vitest'

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '../App.vue'
import { browser, useSession } from '../stores/session'
import { DEFAULT_SETTINGS } from '../types/settings'
import { THEME_KEY, useTheme } from '../stores/theme'
import { button, routerAt } from './helpers'

async function openMenu(wrapper: VueWrapper) {
  await wrapper.find('.menu-button').trigger('click')
}

// Stands in for the Worker API: every list request returns no items, and the settings are the defaults
function stubEmptyApi() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url === '/api/settings' ? DEFAULT_SETTINGS : [])))
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

    expect(wrapper.find('.account').exists()).toBe(false)
    await openMenu(wrapper)
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
    expect(wrapper.find('.menu-button').exists()).toBe(false)
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

  it('links to the settings page from the menu, closing it on the way', async () => {
    stubEmptyApi()
    const pinia = createPinia()
    setActivePinia(pinia)
    useSession().account = { email: 'me@example.com' }
    const router = await routerAt()
    const wrapper = mount(App, { global: { plugins: [pinia, router] } })
    await openMenu(wrapper)
    const link = wrapper.find('.account a')
    expect([link.text(), link.attributes('href')]).toEqual(['Settings', '/settings'])

    await link.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('settings')
    expect(wrapper.find('.account').exists()).toBe(false)
  })

  it('opens and closes the menu from the hamburger button, and closes it on Escape', async () => {
    stubEmptyApi()
    const pinia = createPinia()
    setActivePinia(pinia)
    useSession().account = { email: 'me@example.com' }
    const wrapper = mount(App, { global: { plugins: [pinia, await routerAt()] } })
    const menuButton = wrapper.find('.menu-button')
    expect(menuButton.attributes('aria-expanded')).toBe('false')

    await openMenu(wrapper)
    expect(menuButton.attributes('aria-expanded')).toBe('true')
    await menuButton.trigger('click')
    expect(wrapper.find('.account').exists()).toBe(false)

    await openMenu(wrapper)
    await wrapper.find('.account').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.account').exists()).toBe(false)
  })

  it('switches between the dark and light themes from the menu, remembering the choice', async () => {
    stubEmptyApi()
    localStorage.removeItem(THEME_KEY)
    const pinia = createPinia()
    setActivePinia(pinia)
    useSession().account = { email: 'me@example.com' }
    const wrapper = mount(App, { global: { plugins: [pinia, await routerAt()] } })
    expect(document.documentElement.dataset.theme).toBe('dark')

    await openMenu(wrapper)
    const toggle = button(wrapper, 'Theme')
    expect(toggle.attributes('aria-label')).toBe('Theme: dark (switch to light)')
    await toggle.trigger('click')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem(THEME_KEY)).toBe('light')
    expect(button(wrapper, 'Theme').attributes('aria-label')).toBe('Theme: light (switch to dark)')
    expect(wrapper.find('.account').exists()).toBe(true) // stays open to switch back

    // A new visit starts in the remembered theme
    setActivePinia(createPinia())
    expect(useTheme().theme).toBe('light')

    await button(wrapper, 'Theme').trigger('click')
    expect(document.documentElement.dataset.theme).toBe('dark')
    localStorage.removeItem(THEME_KEY)
  })

  it('shows an error when the projects cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'D1 is down' }, { status: 500 })))
    const wrapper = mount(App, { global: { plugins: [createPinia(), await routerAt()] } })

    await flushPromises()
    expect(wrapper.text()).toContain("Couldn't load your projects: D1 is down")
  })
})
