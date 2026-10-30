// The Sync Google Calendar buttons under Unassigned and in the taskbar, on the dashboard, and the
// badge on imported tasks
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import Dashboard from '../components/dashboard.vue'
import TaskDetails from '../components/taskDetails.vue'
import { browser } from '../stores/session'
import { syncSummary, type SyncResult } from '../types/google'
import { createEmptyTask, type Task } from '../types/task'
import { fakeApi } from './fakeApi'
import { button, memoryRouter, routerAt } from './helpers'

const EMAIL = 'me@gmail.com'
const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id, name: `Task ${id}`, ...fields })
const result = (fields: Partial<SyncResult> = {}): SyncResult => ({
  email: EMAIL,
  added: 0,
  updated: 0,
  removed: 0,
  keptDates: 0,
  failedCalendars: 0,
  ...fields,
})

async function mountDashboard(path = '/') {
  const router = await routerAt(path)
  const wrapper = mount(Dashboard, { global: { plugins: [createPinia(), router] } })
  await flushPromises()
  return { wrapper, router }
}

const unassignedNames = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('.unassigned .task-name').map((n) => n.text())
const syncButtons = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('button').filter((b) => ['Sync Google Calendar', 'Syncing…'].includes(b.text()))
const panelSync = (wrapper: ReturnType<typeof mount>) => wrapper.find('.google-sync button')

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Sync Google Calendar', () => {
  it('goes to Google to connect an account when none is connected', async () => {
    fakeApi()
    const load = vi.spyOn(browser, 'load').mockImplementation(() => {})
    const { wrapper } = await mountDashboard()

    await panelSync(wrapper).trigger('click')
    await flushPromises()
    expect(load).toHaveBeenCalledWith('/api/google/connect')
  })

  it('imports the events as unassigned tasks with the account as a tag, and says what changed', async () => {
    const api = fakeApi()
    api.google.accounts = [{ email: EMAIL, syncedAt: null }]
    api.google.imports = [task('e', { name: 'Dentist', googleAccount: EMAIL })]
    api.google.results = [result({ added: 1, failedCalendars: 1 })]
    const { wrapper } = await mountDashboard()

    await panelSync(wrapper).trigger('click')
    await flushPromises()

    expect(api.requests).toContain('POST /api/google/sync')
    expect(unassignedNames(wrapper)).toEqual(['Dentist'])
    expect(wrapper.find('.unassigned .project-tag').text()).toBe(EMAIL)
    expect(wrapper.find('.results').text()).toBe(`${EMAIL}: 1 added; 1 calendar couldn't be read`)
  })

  it('syncs from the taskbar too, showing the progress on both buttons and the outcome under Unassigned', async () => {
    const api = fakeApi()
    api.google.accounts = [{ email: EMAIL, syncedAt: null }]
    api.google.imports = [task('e', { name: 'Dentist', googleAccount: EMAIL })]
    api.google.results = [result({ added: 1 })]
    const { wrapper } = await mountDashboard()

    await wrapper.find('.taskbar .sync').trigger('click')
    expect(syncButtons(wrapper).map((b) => b.text())).toEqual(['Syncing…', 'Syncing…'])
    await flushPromises()

    expect(api.requests.filter((r) => r === 'POST /api/google/sync')).toHaveLength(1)
    expect(unassignedNames(wrapper)).toEqual(['Dentist'])
    expect(wrapper.find('.results').text()).toBe(`${EMAIL}: 1 added`)
    expect(syncButtons(wrapper).map((b) => b.text())).toEqual(['Sync Google Calendar', 'Sync Google Calendar'])
  })

  it('syncs straight away when Google sends the browser back, and drops the query', async () => {
    const api = fakeApi()
    api.google.accounts = [{ email: EMAIL, syncedAt: null }]
    api.google.results = [result()]
    const { wrapper, router } = await mountDashboard('/?google=connected')

    expect(api.requests).toContain('POST /api/google/sync')
    expect(router.currentRoute.value.fullPath).toBe('/')
    expect(wrapper.find('.results').text()).toBe(`${EMAIL}: up to date`)
  })

  it('says why an account was not connected', async () => {
    fakeApi()
    const { wrapper, router } = await mountDashboard('/?google=error&message=Google%20Calendar%20wasn%E2%80%99t%20connected.')
    expect(wrapper.find('.google-sync [role="alert"]').text()).toBe('Google Calendar wasn’t connected.')
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('offers to connect an account again when Google no longer accepts it', async () => {
    const api = fakeApi()
    api.google.accounts = [{ email: EMAIL, syncedAt: null }]
    api.google.results = [result({ error: 'Connect it again.', reconnect: true })]
    const load = vi.spyOn(browser, 'load').mockImplementation(() => {})
    const { wrapper } = await mountDashboard()

    await panelSync(wrapper).trigger('click')
    await flushPromises()
    await button(wrapper, 'Connect again').trigger('click')
    expect(load).toHaveBeenCalledWith('/api/google/connect')
  })

  it('shows an error when the sync fails', async () => {
    const api = fakeApi()
    const { wrapper } = await mountDashboard()
    api.failWith = 'Google Calendar isn’t set up yet'

    await panelSync(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.find('.google-sync [role="alert"]').text()).toBe("Couldn't sync Google Calendar: Google Calendar isn’t set up yet")
  })

  it('lists the connected accounts when opened, and disconnects one', async () => {
    const api = fakeApi()
    api.google.accounts = [{ email: EMAIL, syncedAt: null }]
    const { wrapper } = await mountDashboard()
    expect(api.requests).not.toContain('GET /api/google/accounts')

    const details = wrapper.find('.google-sync details')
    ;(details.element as HTMLDetailsElement).open = true
    await details.trigger('toggle')
    await flushPromises()
    expect(wrapper.find('.accounts').text()).toContain(`${EMAIL} not synced yet`)

    await button(wrapper, 'Disconnect').trigger('click')
    await flushPromises()
    expect(api.google.accounts).toEqual([])
    expect(wrapper.find('.accounts').text()).toBe('No account connected yet.')
  })
})

describe('imported tasks', () => {
  it('show their account and that syncing sets them from the event, on their page', () => {
    const imported = task('e', { googleAccount: EMAIL })
    const wrapper = mount(TaskDetails, {
      props: { task: imported, tasks: [imported], projects: [] },
      global: { plugins: [memoryRouter()] },
    })
    expect(wrapper.find('.meta .project-tag').text()).toBe(EMAIL)
    expect(wrapper.find('.source').text()).toContain('From Google Calendar')
  })

  it('have no badge when made in Pam', () => {
    const own = task('t')
    const wrapper = mount(TaskDetails, { props: { task: own, tasks: [own], projects: [] }, global: { plugins: [memoryRouter()] } })
    expect(wrapper.find('.project-tag').exists()).toBe(false)
    expect(wrapper.find('.source').exists()).toBe(false)
  })
})

describe('syncSummary', () => {
  it('lists the changes, or says the account is up to date', () => {
    expect(syncSummary(result({ added: 3, removed: 1 }))).toBe('3 added, 1 removed')
    expect(syncSummary(result())).toBe('up to date')
  })
})
