import { afterEach, describe, it, expect, vi } from 'vitest'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TaskForm from '../components/task.vue'
import { useProjectList } from '../stores/projectList'
import { createEmptyProject, type Project } from '../types/project'
import { createEmptyTask, type Task } from '../types/task'

const task: Task = { ...createEmptyTask(), id: 't1', name: 'Write report' }
const project = (id: string, name: string, taskIds: string[] = []): Project => ({
  ...createEmptyProject(),
  id,
  name,
  taskIds,
})

describe('TaskForm project assignment', () => {
  const projects = [project('p1', 'Thesis', ['t1']), project('p2', 'Website')]

  it('shows the projects the task is already in', () => {
    const wrapper = mount(TaskForm, { props: { task, projects } })
    const assigned = wrapper.findAll('li').map((li) => li.text())
    expect(assigned).toEqual([expect.stringContaining('Thesis')])
    expect(wrapper.find('select option[value="p2"]').exists()).toBe(true)
  })

  it('emits the chosen project ids on save', async () => {
    const wrapper = mount(TaskForm, { props: { task, projects } })

    await wrapper.find('li button').trigger('click') // remove Thesis
    const projectSelect = wrapper.findAll('select').find((s) => s.find('option[value="p2"]').exists())
    await projectSelect!.setValue('p2')
    await wrapper.findAll('button').find((b) => b.text() === 'Assign')!.trigger('click')
    await wrapper.find('form').trigger('submit')

    expect(wrapper.emitted('save')?.[0]?.[1]).toEqual(['p2'])
  })

  it('uses projectIds over the projects when given, e.g. to restore an unsaved choice', () => {
    const wrapper = mount(TaskForm, { props: { task, projects, projectIds: ['p2'] } })
    expect(wrapper.findAll('li').map((li) => li.text())).toEqual([expect.stringContaining('Website')])
  })
})

describe('projectList.assignTask', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('saves only the projects whose membership changes', async () => {
    // The API echoes back whatever is saved
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      new Response(init?.body as string, { headers: { 'Content-Type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', fetch)
    setActivePinia(createPinia())
    const store = useProjectList()
    store.projects = [project('p1', 'Thesis', ['t1']), project('p2', 'Website'), project('p3', 'Other')]

    await store.assignTask('t1', ['p2'])
    await flushPromises()

    expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual(['/api/projects/p1', '/api/projects/p2'])
    expect(store.projects.map((p) => p.taskIds)).toEqual([[], ['t1'], []])
  })
})
