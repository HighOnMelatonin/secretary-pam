import { afterEach, describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import Dashboard from '../components/dashboard.vue'
import { createEmptyProject, type Project } from '../types/project'
import { createEmptyTask, type Task } from '../types/task'
import { fakeApi } from './fakeApi'
import { button, listedIn, selectWithOption } from './helpers'

const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id, name: `Task ${id}`, ...fields })
const project = (id: string, fields: Partial<Project> = {}): Project => ({
  ...createEmptyProject(),
  id,
  name: `Project ${id}`,
  ...fields,
})

async function mountDashboard() {
  const wrapper = mount(Dashboard, { global: { plugins: [createPinia()] } })
  await flushPromises()
  return wrapper
}

const tileNames = (wrapper: ReturnType<typeof mount>) => wrapper.findAll('.tile-toggle').map((t) => t.text().replace('▸', '').trim())

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Dashboard loading', () => {
  it('shows a loading message until projects and tasks arrive', async () => {
    const api = fakeApi()
    const wrapper = mount(Dashboard, { global: { plugins: [createPinia()] } })
    expect(wrapper.text()).toContain('Loading your projects')

    await flushPromises()
    expect(api.requests.sort()).toEqual(['GET /api/projects', 'GET /api/tasks'])
    expect(wrapper.text()).not.toContain('Loading your projects')
  })

  it('prompts to create a project when there are none', async () => {
    fakeApi()
    const wrapper = await mountDashboard()
    expect(wrapper.text()).toContain('No projects yet')
  })

  it('shows an error when loading fails', async () => {
    const api = fakeApi()
    api.failWith = 'D1 is down'
    const wrapper = await mountDashboard()
    expect(wrapper.find('[role="alert"]').text()).toBe("Couldn't load your projects: D1 is down")
    // Nothing was loaded, so it can't say there are no projects or offer to create one
    expect(wrapper.text()).not.toContain('No projects yet')
    expect(wrapper.findAll('button')).toEqual([])
  })
})

describe('Dashboard project list', () => {
  it('shows live projects soonest first, and hides finished ones', async () => {
    fakeApi({
      tasks: [task('done', { completed: true }), task('open')],
      projects: [
        project('later', { deliveryDate: '2027-02-01', taskIds: ['open'] }),
        project('finished', { taskIds: ['done'] }),
        project('sooner', { deliveryDate: '2026-12-01' }),
      ],
    })
    const wrapper = await mountDashboard()
    expect(tileNames(wrapper)).toEqual(['Project sooner', 'Project later'])
  })

  it('says so when every project is finished', async () => {
    fakeApi({ tasks: [task('done', { completed: true })], projects: [project('p', { taskIds: ['done'] })] })
    const wrapper = await mountDashboard()
    expect(wrapper.text()).toContain('All projects are completed.')
    expect(tileNames(wrapper)).toEqual([])
  })
})

describe('Dashboard creating a project', () => {
  it('saves the new project and shows it as a tile', async () => {
    const api = fakeApi()
    const wrapper = await mountDashboard()

    await button(wrapper, 'Create a project').trigger('click')
    await wrapper.find('input[placeholder="Project"]').setValue('Thesis')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(api.requests).toContain(`PUT /api/projects/${api.data.projects[0]!.id}`)
    expect(api.data.projects[0]).toMatchObject({ name: 'Thesis' })
    expect(wrapper.find('form').exists()).toBe(false)
    expect(tileNames(wrapper)).toEqual(['Thesis'])
  })

  it('keeps the form open with what was typed when saving fails', async () => {
    const api = fakeApi()
    const wrapper = await mountDashboard()
    await button(wrapper, 'Create a project').trigger('click')
    await wrapper.find('input[placeholder="Project"]').setValue('Thesis')
    api.failWith = 'D1 is down'
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').text()).toBe('Couldn\'t save "Thesis": D1 is down')
    expect((wrapper.find('input[placeholder="Project"]').element as HTMLInputElement).value).toBe('Thesis')

    // Retrying once the API is back works and clears the error
    api.failWith = null
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(tileNames(wrapper)).toEqual(['Thesis'])
  })

  it('closes the form without saving on cancel', async () => {
    const api = fakeApi()
    const wrapper = await mountDashboard()
    await button(wrapper, 'Create a project').trigger('click')
    await button(wrapper, 'Cancel').trigger('click')

    expect(wrapper.find('form').exists()).toBe(false)
    expect(api.requests.filter((r) => r.startsWith('PUT'))).toEqual([])
  })
})

describe('Dashboard editing a project', () => {
  it('opens the form for the tile and saves the changes', async () => {
    const api = fakeApi({ projects: [project('p', { name: 'Thesis' })] })
    const wrapper = await mountDashboard()

    await button(wrapper, 'Edit').trigger('click')
    expect((wrapper.find('input[placeholder="Project"]').element as HTMLInputElement).value).toBe('Thesis')
    await wrapper.find('input[placeholder="Project"]').setValue('Final thesis')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(api.data.projects).toEqual([project('p', { name: 'Final thesis' })])
    expect(tileNames(wrapper)).toEqual(['Final thesis'])
  })
})

describe('Dashboard creating a task', () => {
  it('saves the task, then adds it to the chosen project', async () => {
    const api = fakeApi({ projects: [project('p', { name: 'Thesis' })] })
    const wrapper = await mountDashboard()

    await button(wrapper, 'New task').trigger('click')
    await wrapper.find('input[placeholder="Task"]').setValue('Write report')
    await selectWithOption(wrapper, 'p').setValue('p')
    await button(wrapper, 'Assign').trigger('click')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    const taskId = api.data.tasks[0]!.id
    expect(api.requests.filter((r) => r.startsWith('PUT'))).toEqual([`PUT /api/tasks/${taskId}`, 'PUT /api/projects/p'])
    expect(api.data.projects[0]!.taskIds).toEqual([taskId])
    expect(wrapper.text()).toContain('0 of 1 tasks completed')
  })

  it('keeps the chosen projects when saving fails', async () => {
    const api = fakeApi({ projects: [project('p', { name: 'Thesis' })] })
    const wrapper = await mountDashboard()

    await button(wrapper, 'New task').trigger('click')
    await wrapper.find('input[placeholder="Task"]').setValue('Write report')
    await selectWithOption(wrapper, 'p').setValue('p')
    await button(wrapper, 'Assign').trigger('click')
    api.failWith = 'D1 is down'
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').text()).toBe('Couldn\'t save "Write report": D1 is down')
    expect((wrapper.find('input[placeholder="Task"]').element as HTMLInputElement).value).toBe('Write report')
    expect(listedIn(wrapper, 'Projects')).toEqual(['Thesis'])
  })
})
