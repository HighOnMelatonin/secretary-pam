import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ProjectForm from '../components/project.vue'
import { createEmptyProject, type Project } from '../types/project'
import { createEmptyTask, type Task } from '../types/task'
import { button, listedIn, selectWithOption } from './helpers'

const tasks: Task[] = [
  { ...createEmptyTask(), id: 't1', name: 'Write report', completed: true },
  { ...createEmptyTask(), id: 't2', name: 'Review slides' },
  { ...createEmptyTask(), id: 't3', name: 'Book room' },
]
const existing: Project = {
  ...createEmptyProject(),
  id: 'p1',
  name: 'Thesis',
  taskIds: ['t1', 't2'],
  links: [{ label: 'Repo', url: 'https://example.com/repo' }],
}

const savedProject = (wrapper: ReturnType<typeof mount>) => wrapper.emitted<[Project]>('save')?.slice(-1)[0]?.[0]

describe('ProjectForm for a new project', () => {
  it('only allows adding once the project has a name', async () => {
    const wrapper = mount(ProjectForm, { props: { tasks } })
    expect(button(wrapper, 'Add').attributes('disabled')).toBeDefined()

    await wrapper.find('input[placeholder="Project"]').setValue('   ')
    expect(button(wrapper, 'Add').attributes('disabled')).toBeDefined()

    await wrapper.find('input[placeholder="Project"]').setValue('Thesis')
    expect(button(wrapper, 'Add').attributes('disabled')).toBeUndefined()
  })

  it('emits the filled-in project with a trimmed name, then clears the form', async () => {
    const wrapper = mount(ProjectForm, { props: { tasks } })
    await wrapper.find('input[placeholder="Project"]').setValue('  Thesis  ')
    await wrapper.find('input[type="date"]').setValue('2027-01-18')
    await wrapper.find('select').setValue('urgent')
    await wrapper.find('textarea').setValue('Final year project')
    await wrapper.find('form').trigger('submit')

    expect(savedProject(wrapper)).toEqual({
      id: expect.any(String),
      name: 'Thesis',
      description: 'Final year project',
      deliveryDate: '2027-01-18',
      taskIds: [],
      priority: 'urgent',
      links: [],
    })
    expect((wrapper.find('input[placeholder="Project"]').element as HTMLInputElement).value).toBe('')
  })

  it('stores a cleared delivery date as null', async () => {
    const wrapper = mount(ProjectForm, { props: { project: { ...existing, deliveryDate: '2027-01-18' }, tasks } })
    await wrapper.find('input[type="date"]').setValue('')
    await wrapper.find('form').trigger('submit')
    expect(savedProject(wrapper)!.deliveryDate).toBeNull()
  })
})

describe('ProjectForm tasks', () => {
  it("lists the project's tasks with the completed count", () => {
    const wrapper = mount(ProjectForm, { props: { project: existing, tasks } })
    expect(wrapper.find('legend').text()).toBe('Tasks (1 / 2 completed)')
    expect(listedIn(wrapper, 'Tasks')).toEqual(['Write report', 'Review slides'])
  })

  it('offers only tasks not already in the project', () => {
    const wrapper = mount(ProjectForm, { props: { project: existing, tasks } })
    const options = selectWithOption(wrapper, 't3').findAll('option:not([disabled])').map((o) => o.text())
    expect(options).toEqual(['Book room'])
  })

  it('adds and removes tasks', async () => {
    const wrapper = mount(ProjectForm, { props: { project: existing, tasks } })
    await selectWithOption(wrapper, 't3').setValue('t3')
    await button(wrapper, 'Add task').trigger('click')
    await wrapper.findAll('li button')[0]!.trigger('click') // remove Write report
    await wrapper.find('form').trigger('submit')

    expect(savedProject(wrapper)!.taskIds).toEqual(['t2', 't3'])
  })
})

describe('ProjectForm reference links', () => {
  it('adds a link, using the url as the label when none is given', async () => {
    const wrapper = mount(ProjectForm, { props: { tasks } })
    await wrapper.find('input[placeholder="Project"]').setValue('Thesis')
    await wrapper.find('input[placeholder="Label (e.g. GitHub repo)"]').setValue('Docs')
    await wrapper.find('input[placeholder="https://"]').setValue('https://example.com/docs')
    await button(wrapper, 'Add link').trigger('click')
    await wrapper.find('input[placeholder="https://"]').setValue('https://example.com/plain')
    await wrapper.find('input[placeholder="https://"]').trigger('keydown', { key: 'Enter' })
    await wrapper.find('form').trigger('submit')

    expect(savedProject(wrapper)!.links).toEqual([
      { label: 'Docs', url: 'https://example.com/docs' },
      { label: 'https://example.com/plain', url: 'https://example.com/plain' },
    ])
  })

  it('needs a url before a link can be added', async () => {
    const wrapper = mount(ProjectForm, { props: { tasks } })
    expect(button(wrapper, 'Add link').attributes('disabled')).toBeDefined()
    await wrapper.find('input[placeholder="https://"]').setValue('   ')
    expect(button(wrapper, 'Add link').attributes('disabled')).toBeDefined()
  })

  it('opens links in a new tab and removes them', async () => {
    const wrapper = mount(ProjectForm, { props: { project: existing, tasks } })
    const link = wrapper.find('a[href="https://example.com/repo"]')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toContain('noopener')

    const linksFieldset = wrapper.findAll('fieldset')[1]!
    await linksFieldset.find('li button').trigger('click')
    await wrapper.find('form').trigger('submit')
    expect(savedProject(wrapper)!.links).toEqual([])
  })
})

describe('ProjectForm for an existing project', () => {
  it('shows Save and does not change the original until saved', async () => {
    const original = structuredClone(existing)
    const wrapper = mount(ProjectForm, { props: { project: existing, tasks } })
    expect(button(wrapper, 'Save').exists()).toBe(true)

    await wrapper.find('input[placeholder="Project"]').setValue('Renamed')
    await wrapper.findAll('li button')[0]!.trigger('click')
    expect(existing).toEqual(original)

    await wrapper.find('form').trigger('submit')
    expect(savedProject(wrapper)).toMatchObject({ id: 'p1', name: 'Renamed', taskIds: ['t2'] })
    expect(savedProject(wrapper)).not.toBe(existing)
  })

  it('discards edits and emits cancel', async () => {
    const wrapper = mount(ProjectForm, { props: { project: existing, tasks } })
    await wrapper.find('input[placeholder="Project"]').setValue('Renamed')
    await button(wrapper, 'Cancel').trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect((wrapper.find('input[placeholder="Project"]').element as HTMLInputElement).value).toBe('Thesis')
  })

  it('shows a different project when the prop changes', async () => {
    const wrapper = mount(ProjectForm, { props: { project: existing, tasks } })
    await wrapper.setProps({ project: { ...existing, id: 'p2', name: 'Website' } })
    expect((wrapper.find('input[placeholder="Project"]').element as HTMLInputElement).value).toBe('Website')
  })
})
