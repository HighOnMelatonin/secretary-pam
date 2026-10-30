import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Taskbar from '../components/taskbar.vue'
import { button } from './helpers'

const strip = (wrapper: ReturnType<typeof mount>) => wrapper.find('button[aria-label="Show actions"]')

describe('Taskbar', () => {
  it('emits the action for each button', async () => {
    const wrapper = mount(Taskbar)
    await button(wrapper, 'Tags').trigger('click')
    await button(wrapper, 'Add task').trigger('click')
    await button(wrapper, 'Add project').trigger('click')
    await button(wrapper, 'Sync Google Calendar').trigger('click')

    expect(Object.keys(wrapper.emitted())).toEqual(expect.arrayContaining(['tags', 'addTask', 'addProject', 'sync']))
  })

  it('shows a sync under way, and offers no second one meanwhile', () => {
    const wrapper = mount(Taskbar, { props: { syncing: true } })
    const sync = button(wrapper, 'Syncing…')
    expect(sync.attributes('aria-busy')).toBe('true')
    expect(sync.attributes('disabled')).toBeDefined()
  })

  it('opens from the strip, and closes again from the strip or once an action is chosen', async () => {
    const wrapper = mount(Taskbar)
    expect(strip(wrapper).attributes('aria-expanded')).toBe('false')

    await strip(wrapper).trigger('click')
    expect(wrapper.find('nav').classes()).toContain('open')
    expect(strip(wrapper).attributes('aria-expanded')).toBe('true')
    await strip(wrapper).trigger('click')
    expect(wrapper.find('nav').classes()).not.toContain('open')

    await strip(wrapper).trigger('click')
    await button(wrapper, 'Add task').trigger('click')
    expect(wrapper.find('nav').classes()).not.toContain('open')
  })

  it('closes on a tap outside it, and when the pointer leaves', async () => {
    const wrapper = mount(Taskbar, { attachTo: document.body })
    await strip(wrapper).trigger('click')
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('nav').classes()).not.toContain('open')

    await strip(wrapper).trigger('click')
    await wrapper.find('nav').trigger('mouseleave')
    expect(wrapper.find('nav').classes()).not.toContain('open')
    wrapper.unmount()
  })
})

describe('Taskbar + button', () => {
  const fab = (wrapper: ReturnType<typeof mount>) => wrapper.find('button.fab')
  const menuButtons = (wrapper: ReturnType<typeof mount>) => wrapper.findAll('.fab-actions button')

  it('opens a menu of the actions, and closes it again', async () => {
    const wrapper = mount(Taskbar)
    expect(menuButtons(wrapper)).toHaveLength(0)

    await fab(wrapper).trigger('click')
    expect(fab(wrapper).attributes('aria-expanded')).toBe('true')
    expect(menuButtons(wrapper).map((b) => b.text())).toEqual(['Tags', 'Add task', 'Add project', 'Sync Google Calendar'])

    await fab(wrapper).trigger('click')
    expect(menuButtons(wrapper)).toHaveLength(0)
  })

  it('emits the chosen action and closes the menu', async () => {
    const wrapper = mount(Taskbar)
    await fab(wrapper).trigger('click')
    await menuButtons(wrapper)[2]!.trigger('click')

    expect(wrapper.emitted('addProject')).toHaveLength(1)
    expect(menuButtons(wrapper)).toHaveLength(0)
  })

  it('closes the menu on a tap outside it', async () => {
    const wrapper = mount(Taskbar, { attachTo: document.body })
    await fab(wrapper).trigger('click')
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(menuButtons(wrapper)).toHaveLength(0)
    wrapper.unmount()
  })

  it('is left out while a form is open', () => {
    expect(fab(mount(Taskbar, { props: { formOpen: true } })).exists()).toBe(false)
  })
})
