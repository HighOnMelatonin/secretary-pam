import { afterEach, describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import Dashboard from '../components/dashboard.vue'
import { createEmptyProject, type Project } from '../types/project'
import { createEmptyTask, type Task } from '../types/task'
import { fakeApi } from './fakeApi'
import { button, listedIn, routerAt, selectWithOption } from './helpers'

const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id, name: `Task ${id}`, ...fields })
const project = (id: string, fields: Partial<Project> = {}): Project => ({
  ...createEmptyProject(),
  id,
  name: `Project ${id}`,
  ...fields,
})

// Mounts the dashboard at `path` and waits for its data; the route is wrapper.vm.$route
async function mountDashboard(path = '/') {
  const wrapper = mount(Dashboard, { global: { plugins: [createPinia(), await routerAt(path)] } })
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
    const wrapper = mount(Dashboard, { global: { plugins: [createPinia(), await routerAt()] } })
    expect(wrapper.text()).toContain('Loading your projects')

    await flushPromises()
    expect(api.requests.sort()).toEqual(['GET /api/projects', 'GET /api/tags', 'GET /api/tasks'])
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

    await flushPromises()
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
    await flushPromises()
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
    await flushPromises()
    await button(wrapper, 'Cancel').trigger('click')
    await flushPromises()

    expect(wrapper.find('form').exists()).toBe(false)
    expect(api.requests.filter((r) => r.startsWith('PUT'))).toEqual([])
  })
})

describe('Dashboard editing a project', () => {
  it('opens the form for the tile and saves the changes', async () => {
    const api = fakeApi({ projects: [project('p', { name: 'Thesis' })] })
    const wrapper = await mountDashboard()

    await button(wrapper, 'Edit').trigger('click')

    await flushPromises()
    expect((wrapper.find('input[placeholder="Project"]').element as HTMLInputElement).value).toBe('Thesis')
    await wrapper.find('input[placeholder="Project"]').setValue('Final thesis')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(api.data.projects).toEqual([project('p', { name: 'Final thesis' })])
    expect(tileNames(wrapper)).toEqual(['Final thesis'])
  })
})

describe('Dashboard tags', () => {
  const tags = [
    { id: 'school', name: 'School (SUTD)' },
    { id: 'work', name: 'Work' },
  ]

  it('shows each tile with its tag', async () => {
    fakeApi({ tags, projects: [project('p', { name: 'Thesis', tagId: 'school' }), project('q', { name: 'Gym' })] })
    const wrapper = await mountDashboard()
    expect(wrapper.findAll('.project-tag').map((t) => t.text())).toEqual(['School (SUTD)'])
  })

  it('tags a project from its form', async () => {
    const api = fakeApi({ tags, projects: [project('p', { name: 'Thesis' })] })
    const wrapper = await mountDashboard()

    await button(wrapper, 'Edit').trigger('click')

    await flushPromises()
    await selectWithOption(wrapper, 'work').setValue('work')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(api.data.projects[0]!.tagId).toBe('work')
    expect(wrapper.find('.project-tag').text()).toBe('Work')
  })

  it('opens the tag list from the taskbar, and its changes show on the tiles', async () => {
    fakeApi({ tags, projects: [project('p', { name: 'Thesis', tagId: 'school' })] })
    const wrapper = await mountDashboard()

    await button(wrapper, 'Tags').trigger('click')

    await flushPromises()
    await wrapper.find('input[aria-label="Name of School (SUTD)"]').setValue('SUTD')
    await wrapper.find('li form').trigger('submit')
    await flushPromises()
    await button(wrapper, 'Done').trigger('click')
    await flushPromises()

    expect(wrapper.find('.project-tag').text()).toBe('SUTD')
  })
})

describe('Dashboard creating a task', () => {
  it('saves the task, then adds it to the chosen project', async () => {
    const api = fakeApi({ projects: [project('p', { name: 'Thesis' })] })
    const wrapper = await mountDashboard()

    await button(wrapper, 'Add task').trigger('click')

    await flushPromises()
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

    await button(wrapper, 'Add task').trigger('click')

    await flushPromises()
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

describe('Dashboard routes', () => {
  const path = (wrapper: ReturnType<typeof mount>) => wrapper.vm.$route.fullPath

  it('gives each form its own URL, and back closes it', async () => {
    fakeApi({ projects: [project('p', { name: 'Thesis' })] })
    const wrapper = await mountDashboard()

    await button(wrapper, 'Add task').trigger('click')
    await flushPromises()
    expect(path(wrapper)).toBe('/tasks/new')
    expect(wrapper.find('input[placeholder="Task"]').exists()).toBe(true)

    wrapper.vm.$router.back()
    await flushPromises()
    expect(path(wrapper)).toBe('/')
    expect(tileNames(wrapper)).toEqual(['Thesis'])
  })

  it('goes back to the list after saving, without leaving the form in history', async () => {
    fakeApi()
    const wrapper = await mountDashboard()
    await button(wrapper, 'Create a project').trigger('click')
    await flushPromises()
    expect(path(wrapper)).toBe('/projects/new')

    await wrapper.find('input[placeholder="Project"]').setValue('Thesis')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(path(wrapper)).toBe('/')
    expect(tileNames(wrapper)).toEqual(['Thesis'])
  })

  it("opens a project's edit link directly, once the projects have loaded", async () => {
    fakeApi({ projects: [project('p', { name: 'Thesis' })] })
    const wrapper = await mountDashboard('/projects/p/edit')
    expect((wrapper.find('input[placeholder="Project"]').element as HTMLInputElement).value).toBe('Thesis')

    // Opened by link rather than from the list, so closing replaces it with the list
    await button(wrapper, 'Cancel').trigger('click')
    await flushPromises()
    expect(path(wrapper)).toBe('/')
  })

  it('goes to the list for an edit link to a project that does not exist', async () => {
    fakeApi({ projects: [project('p', { name: 'Thesis' })] })
    const wrapper = await mountDashboard('/projects/missing/edit')
    expect(path(wrapper)).toBe('/')
    expect(tileNames(wrapper)).toEqual(['Thesis'])
  })

  it('opens the tag list from its link', async () => {
    fakeApi({ tags: [{ id: 'w', name: 'Work' }] })
    const wrapper = await mountDashboard('/tags')
    expect(wrapper.find('input[aria-label="Name of Work"]').exists()).toBe(true)
  })

  it('hides the + button while a form is open', async () => {
    fakeApi({ projects: [project('p')] })
    const wrapper = await mountDashboard()
    expect(wrapper.find('.fab').exists()).toBe(true)

    await button(wrapper, 'Add task').trigger('click')
    await flushPromises()
    expect(wrapper.find('.fab').exists()).toBe(false)
  })
})
