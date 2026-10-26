import { afterEach, describe, it, expect, vi } from 'vitest'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import App from '../App.vue'
import { routerAt } from './helpers'

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

  it('shows an error when the projects cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'D1 is down' }, { status: 500 })))
    const wrapper = mount(App, { global: { plugins: [createPinia(), await routerAt()] } })

    await flushPromises()
    expect(wrapper.text()).toContain("Couldn't load your projects: D1 is down")
  })
})
