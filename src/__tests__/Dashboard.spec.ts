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
  localStorage.clear()
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

describe('Dashboard sorting and filtering', () => {
  const projects = [
    project('report', { name: 'Report', deliveryDate: '2027-01-01', priority: 'low', tagId: 'work' }),
    project('thesis', { name: 'Thesis', deliveryDate: '2027-02-01', priority: 'urgent', tagId: 'school' }),
    project('gym', { name: 'Gym', priority: 'high' }),
  ]
  const tags = [
    { id: 'school', name: 'School (SUTD)' },
    { id: 'work', name: 'Work' },
  ]
  const chip = (wrapper: ReturnType<typeof mount>, text: string) =>
    wrapper.findAll('.chip').find((c) => c.text() === text)!

  it('sorts the tiles with the chosen order', async () => {
    fakeApi({ projects, tags })
    const wrapper = await mountDashboard()
    expect(tileNames(wrapper)).toEqual(['Report', 'Thesis', 'Gym'])

    await selectWithOption(wrapper, 'urgency-desc').setValue('urgency-desc')
    expect(tileNames(wrapper)).toEqual(['Thesis', 'Gym', 'Report'])
  })

  it('filters by tag and urgency, counting the filters that are on', async () => {
    fakeApi({ projects, tags })
    const wrapper = await mountDashboard()

    await chip(wrapper, 'Work').trigger('click')
    expect(chip(wrapper, 'Work').attributes('aria-pressed')).toBe('true')
    expect(tileNames(wrapper)).toEqual(['Report'])

    await chip(wrapper, 'No tag').trigger('click')
    await chip(wrapper, 'high').trigger('click')
    expect(tileNames(wrapper)).toEqual(['Gym'])
    expect(wrapper.find('summary').text()).toBe('Filter (3 on)')
  })

  it('says when nothing matches, and clears the filters', async () => {
    fakeApi({ projects, tags })
    const wrapper = await mountDashboard()
    await chip(wrapper, 'Work').trigger('click')
    await chip(wrapper, 'urgent').trigger('click')

    expect(tileNames(wrapper)).toEqual([])
    expect(wrapper.find('.no-match').text()).toContain('No projects match these filters.')

    await wrapper.find('.no-match button').trigger('click')
    expect(tileNames(wrapper)).toEqual(['Report', 'Thesis', 'Gym'])
    expect(wrapper.find('summary').text()).toBe('Filter')
  })
})

describe('Dashboard editing a task', () => {
  it("opens a task's form from its project's tile and saves the changes", async () => {
    const api = fakeApi({
      tasks: [task('t', { name: 'Write report' })],
      projects: [project('p', { name: 'Thesis', taskIds: ['t'] })],
    })
    const wrapper = await mountDashboard()

    await wrapper.find('.tile-toggle').trigger('click')
    await wrapper.find('button[aria-label="Edit task Write report"]').trigger('click')
    await flushPromises()
    expect(wrapper.vm.$route.fullPath).toBe('/tasks/t/edit')
    const name = wrapper.find('input[placeholder="Task"]')
    expect((name.element as HTMLInputElement).value).toBe('Write report')
    expect(listedIn(wrapper, 'Projects')).toEqual(['Thesis'])

    await name.setValue('Write final report')
    await wrapper.find('input[type="checkbox"]').setValue(true)
    expect(button(wrapper, 'Save').exists()).toBe(true)
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(api.data.tasks).toEqual([task('t', { name: 'Write final report', completed: true })])
    expect(api.data.projects[0]!.taskIds).toEqual(['t'])
    expect(wrapper.vm.$route.fullPath).toBe('/')
  })

  it("marks a task done and not done from its check mark in the tile", async () => {
    const api = fakeApi({
      tasks: [task('t', { name: 'Write report' }), task('u', { name: 'Review slides' })],
      projects: [project('p', { name: 'Thesis', taskIds: ['t', 'u'] })],
    })
    const wrapper = await mountDashboard()
    await wrapper.find('.tile-toggle').trigger('click')
    const check = () => wrapper.find('button[aria-label="Done: Write report"]')

    await check().trigger('click')
    await flushPromises()
    expect(api.data.tasks[0]).toEqual(task('t', { name: 'Write report', completed: true }))
    expect(check().attributes('aria-pressed')).toBe('true')
    expect(wrapper.text()).toContain('1 of 2 tasks completed')

    await check().trigger('click')
    await flushPromises()
    expect(api.data.tasks[0]!.completed).toBe(false)
    expect(wrapper.text()).toContain('0 of 2 tasks completed')
  })

  it("shows an error and keeps the task as it was when marking it done fails", async () => {
    const api = fakeApi({
      tasks: [task('t', { name: 'Write report' })],
      projects: [project('p', { name: 'Thesis', taskIds: ['t'] })],
    })
    const wrapper = await mountDashboard()
    await wrapper.find('.tile-toggle').trigger('click')

    api.failWith = 'D1 is down'
    await wrapper.find('button[aria-label="Done: Write report"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').text()).toBe('Couldn\'t save "Write report": D1 is down')
    expect(wrapper.find('button[aria-label="Done: Write report"]').attributes('aria-pressed')).toBe('false')
  })

  it("opens a task's edit link directly, and goes to the list for one that does not exist", async () => {
    fakeApi({ tasks: [task('t', { name: 'Write report' })], projects: [project('p', { taskIds: ['t'] })] })
    const wrapper = await mountDashboard('/tasks/t/edit')
    expect((wrapper.find('input[placeholder="Task"]').element as HTMLInputElement).value).toBe('Write report')

    fakeApi({ projects: [project('p')] })
    const missing = await mountDashboard('/tasks/missing/edit')
    expect(missing.vm.$route.fullPath).toBe('/')
  })
})

describe('Dashboard details pages', () => {
  const path = (wrapper: ReturnType<typeof mount>) => wrapper.vm.$route.fullPath
  const pageHeading = (wrapper: ReturnType<typeof mount>) => wrapper.find('.page-header h2').text()
  const relations = (wrapper: ReturnType<typeof mount>) =>
    wrapper.findAll('.related li').map((li) => li.findAll('li > *').map((part) => part.text()).join(' '))

  const thesis = () =>
    fakeApi({
      tasks: [
        task('t1', {
          name: 'Write report',
          description: 'Chapters 1 to 3',
          dueDate: '2026-11-02',
          relations: [{ taskId: 't2', type: 'blocks' }],
        }),
        task('t2', { name: 'Review slides', completed: true }),
      ],
      projects: [
        project('p', {
          name: 'Thesis',
          description: 'Final year thesis',
          taskIds: ['t1', 't2'],
          links: [{ label: 'GitHub repo', url: 'https://example.com/repo' }],
        }),
      ],
    })

  it("opens a project's page from View more, with every task's description, and back returns to the list", async () => {
    thesis()
    const wrapper = await mountDashboard()

    await wrapper.find('a[aria-label="View more of Thesis"]').trigger('click')
    await flushPromises()
    expect(path(wrapper)).toBe('/projects/p')
    expect(pageHeading(wrapper)).toBe('Thesis')
    expect(wrapper.text()).toContain('Final year thesis')
    expect(wrapper.text()).toContain('1 of 2 tasks completed')
    expect(wrapper.find('.timeline').text()).toContain('Write report')
    expect(wrapper.find('.task-description').text()).toBe('Chapters 1 to 3')
    expect(wrapper.find('a[href="https://example.com/repo"]').text()).toBe('GitHub repo')

    wrapper.vm.$router.back()
    await flushPromises()
    expect(path(wrapper)).toBe('/')
    expect(tileNames(wrapper)).toEqual(['Thesis'])
  })

  it("goes from a project's page to a task's page, which shows its projects and both sides of its relations", async () => {
    thesis()
    const wrapper = await mountDashboard('/projects/p')

    await wrapper.find('.task .task-name[href="/tasks/t2"]').trigger('click')
    await flushPromises()
    expect(path(wrapper)).toBe('/tasks/t2')
    expect(pageHeading(wrapper)).toBe('Review slides (completed)')
    expect(wrapper.find('.meta').text()).toContain('✓ done')
    expect(wrapper.text()).toContain('No description.')
    // Recorded on Write report, so read from this side
    expect(relations(wrapper)).toEqual(['blocked by Write report'])

    await wrapper.find('a[href="/tasks/t1"]').trigger('click')
    await flushPromises()
    expect(pageHeading(wrapper)).toBe('Write report')
    expect(relations(wrapper)).toEqual(['blocks Review slides (completed)'])

    await wrapper.find('a[href="/projects/p"]').trigger('click')
    await flushPromises()
    expect(pageHeading(wrapper)).toBe('Thesis')
  })

  it("opens a task's form from its page, and saving returns to the page with the changes", async () => {
    const api = thesis()
    const wrapper = await mountDashboard('/tasks/t1')

    await button(wrapper, 'Edit').trigger('click')
    await flushPromises()
    expect(path(wrapper)).toBe('/tasks/t1/edit')
    await wrapper.find('input[placeholder="Task"]').setValue('Write final report')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(api.data.tasks[0]!.name).toBe('Write final report')
    expect(path(wrapper)).toBe('/tasks/t1')
    expect(pageHeading(wrapper)).toBe('Write final report')
  })

  it("opens a project's form from its page, and cancelling returns to the page", async () => {
    thesis()
    const wrapper = await mountDashboard('/projects/p')

    await wrapper.find('.page-header button').trigger('click')
    await flushPromises()
    expect(path(wrapper)).toBe('/projects/p/edit')
    await button(wrapper, 'Cancel').trigger('click')
    await flushPromises()
    expect(path(wrapper)).toBe('/projects/p')
  })

  it('goes to the list for a page whose project or task does not exist', async () => {
    thesis()
    expect(path(await mountDashboard('/projects/missing'))).toBe('/')
    thesis()
    expect(path(await mountDashboard('/tasks/missing'))).toBe('/')
  })
})

describe('Dashboard expanding tiles', () => {
  const expandedTiles = (wrapper: ReturnType<typeof mount>) =>
    wrapper.findAll('.project-tile.expanded .tile-toggle').map((t) => t.text().replace('▸', '').trim())

  it('expands every tile, then collapses them all', async () => {
    fakeApi({ projects: [project('a', { name: 'Thesis' }), project('b', { name: 'Internship' })] })
    const wrapper = await mountDashboard()
    expect(expandedTiles(wrapper)).toEqual([])

    await button(wrapper, 'Expand all').trigger('click')
    expect(expandedTiles(wrapper).sort()).toEqual(['Internship', 'Thesis'])

    await button(wrapper, 'Collapse all').trigger('click')
    expect(expandedTiles(wrapper)).toEqual([])
  })

  it('offers Collapse all once every tile has been opened by hand', async () => {
    fakeApi({ projects: [project('a', { name: 'Thesis' }), project('b', { name: 'Internship' })] })
    const wrapper = await mountDashboard()

    const toggles = wrapper.findAll('.tile-toggle')
    await toggles[0]!.trigger('click')
    expect(button(wrapper, 'Expand all').exists()).toBe(true)
    await toggles[1]!.trigger('click')
    expect(button(wrapper, 'Collapse all').exists()).toBe(true)
  })

  it("keeps tiles open after a visit to a project's page", async () => {
    fakeApi({ projects: [project('a', { name: 'Thesis' })] })
    const wrapper = await mountDashboard()
    await button(wrapper, 'Expand all').trigger('click')

    await wrapper.find('a[aria-label="View more of Thesis"]').trigger('click')
    await flushPromises()
    wrapper.vm.$router.back()
    await flushPromises()
    expect(expandedTiles(wrapper)).toEqual(['Thesis'])
  })

  it('hides the button when no tiles are showing', async () => {
    fakeApi({ projects: [project('a', { priority: 'low' })] })
    localStorage.setItem('pam.projectView', JSON.stringify({ priorities: ['urgent'] }))
    const wrapper = await mountDashboard()
    expect(wrapper.find('.toggle-all').exists()).toBe(false)
  })
})
