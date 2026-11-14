import { afterEach, describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import SettingsForm from '../components/settings.vue'
import { useProjectList } from '../stores/projectList'
import { useSettings } from '../stores/settings'
import { useTaskList } from '../stores/taskList'
import { DEFAULT_SETTINGS, type UserSettings } from '../types/settings'
import { createEmptyProject, type Project } from '../types/project'
import { createEmptyTask, type Task } from '../types/task'
import { fakeApi } from './fakeApi'
import { button } from './helpers'

// A Monday
const today = '2026-11-16'
const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id, name: id, ...fields })
// Balanced and Importance-driven put Important first; Deadline-driven looks further ahead and
// weighs deadlines more, so Due tomorrow overtakes it
const tasks = [task('Important', { priority: 'high' }), task('Due tomorrow', { dueDate: '2026-11-17' })]
const saved: UserSettings = { ...DEFAULT_SETTINGS, capacityMinutes: { ...DEFAULT_SETTINGS.capacityMinutes, sat: 90 } }

async function mountSettings(options: { failSettings?: boolean; tasks?: Task[]; projects?: Project[] } = {}) {
  const api = fakeApi({ tasks: options.tasks ?? tasks, projects: options.projects ?? [], settings: saved })
  setActivePinia(createPinia())
  await useTaskList().load()
  await useProjectList().load()
  if (options.failSettings) {
    api.failWith = 'D1 is down'
    api.failOn = 'settings'
  }
  await useSettings().load().catch(() => {})
  const wrapper = mount(SettingsForm, { props: { today } })
  await flushPromises()
  // Only what the tests do counts, not what the page asks for as it opens
  api.requests.length = 0
  return { api, wrapper }
}

const dayInputs = (wrapper: ReturnType<typeof mount>) => wrapper.findAll<HTMLInputElement>('.days input')
const bufferInput = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('label').find((l) => l.text().startsWith('Buffer'))!.find<HTMLInputElement>('input')
const preset = (wrapper: ReturnType<typeof mount>, label: string) =>
  wrapper.findAll('label.preset').find((l) => l.text().startsWith(label))!.find<HTMLInputElement>('input')
const previewRows = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('.preview-list li').map((li) => [li.find('.row > span').text(), li.find('.tag').exists() ? li.find('.tag').text() : null])

afterEach(() => vi.unstubAllGlobals())

describe('Settings page', () => {
  it('shows the saved settings, in hours', async () => {
    const { wrapper } = await mountSettings()
    expect(dayInputs(wrapper).map((i) => i.element.value)).toEqual(['8', '8', '8', '8', '8', '1.5', '0'])
    expect(bufferInput(wrapper).element.value).toBe('1')
    expect(preset(wrapper, 'Balanced').element.checked).toBe(true)
    expect(button(wrapper, 'Apply').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.preview').exists()).toBe(false)
  })

  it('previews a preset, marking the rows that move, before anything is saved', async () => {
    const { api, wrapper } = await mountSettings()
    await preset(wrapper, 'Deadline-driven').setValue(true)
    expect(previewRows(wrapper)).toEqual([
      ['Due tomorrow', 'up 1'],
      ['Important', 'down 1'],
    ])
    expect(wrapper.find('.preview').text()).toContain('2 of 2 tasks move in Suggested')

    await preset(wrapper, 'Importance-driven').setValue(true)
    expect(previewRows(wrapper)).toEqual([
      ['Important', null],
      ['Due tomorrow', null],
    ])
    expect(wrapper.find('.preview').text()).toContain('The Suggested list stays in the same order.')
    expect(api.requests).toEqual([])
  })

  it("adds the projects whose forecast pace or finish would change to the preview", async () => {
    // Other (high) comes first; Report then finishes Tuesday, a working day before Thesis delivers
    const forecastTasks = [task('Other', { priority: 'high', effortMinutes: 360 }), task('Report', { effortMinutes: 360 })]
    const thesis: Project = { ...createEmptyProject(), id: 'p', name: 'Thesis', deliveryDate: '2026-11-18', taskIds: ['Report'] }
    const { wrapper } = await mountSettings({ tasks: forecastTasks, projects: [thesis] })

    // 12 hours on Monday fits both tasks in
    await dayInputs(wrapper)[0]!.setValue('12')
    expect(wrapper.findAll('.forecast-changes li').map((li) => li.text())).toEqual([
      'Thesis: Tight, finishing 2026-11-17 → On pace, finishing 2026-11-16',
      'Everything: done by 2026-11-17 → done by 2026-11-16',
    ])

    await dayInputs(wrapper)[0]!.setValue('8')
    await preset(wrapper, 'Blockers-first').setValue(true)
    expect(wrapper.find('.preview').text()).toContain("No project's pace or finish changes.")
  })

  it('applies the changes, saving the preset weights, then closes', async () => {
    const { api, wrapper } = await mountSettings()
    await preset(wrapper, 'Blockers-first').setValue(true)
    await dayInputs(wrapper)[0]!.setValue('6.5')
    await bufferInput(wrapper).setValue('1,25')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(api.requests).toEqual(['PUT /api/settings'])
    expect(api.settings).toEqual({
      capacityMinutes: { ...saved.capacityMinutes, mon: 390 },
      buffer: 1.25,
      wU: 1,
      k: 2,
      horizonDays: 2,
      preset: 'blockers',
    })
    expect(useSettings().settings).toEqual(api.settings)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('discards the changes on Cancel', async () => {
    const { api, wrapper } = await mountSettings()
    await preset(wrapper, 'Blockers-first').setValue(true)
    await button(wrapper, 'Cancel').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(api.requests).toEqual([])
    expect(useSettings().settings).toEqual(saved)
  })

  it('blocks applying hours or a buffer it can not save', async () => {
    const { wrapper } = await mountSettings()
    await dayInputs(wrapper)[0]!.setValue('25')
    expect(wrapper.find('[role="alert"]').text()).toBe('Each day needs a number of hours from 0 to 24.')
    expect(button(wrapper, 'Apply').attributes('disabled')).toBeDefined()

    for (const input of dayInputs(wrapper)) await input.setValue('0')
    expect(wrapper.find('[role="alert"]').text()).toBe('At least one day needs some hours.')

    await dayInputs(wrapper)[0]!.setValue('8')
    await bufferInput(wrapper).setValue('0.2')
    expect(wrapper.find('[role="alert"]').text()).toBe('The buffer must be from 0.5 to 5.')
    expect(button(wrapper, 'Apply').attributes('disabled')).toBeDefined()
  })

  it("won't save over settings it couldn't load, and tries again", async () => {
    const { api, wrapper } = await mountSettings({ failSettings: true })
    expect(wrapper.find('[role="alert"]').text()).toContain("Couldn't load your settings: D1 is down")
    await preset(wrapper, 'Blockers-first').setValue(true)
    expect(button(wrapper, 'Apply').attributes('disabled')).toBeDefined()

    api.failWith = null
    await button(wrapper, 'Try again').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(button(wrapper, 'Apply').attributes('disabled')).toBeUndefined()
  })

  it('says why saving failed, and stays open', async () => {
    const { api, wrapper } = await mountSettings()
    await preset(wrapper, 'Blockers-first').setValue(true)
    api.failWith = 'D1 is down'
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toBe("Couldn't save your settings: D1 is down")
    expect(wrapper.emitted('close')).toBeUndefined()
  })
})
