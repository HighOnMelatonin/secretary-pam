import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ProjectForm from '../components/project.vue'
import { createEmptyProject, type Project } from '../types/project'
import type { Tag } from '../types/tag'
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
const dateInput = (wrapper: ReturnType<typeof mount>) => wrapper.find<HTMLInputElement>('input[type="date"]')

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
      tagIds: [],
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

describe('ProjectForm tags', () => {
  const tags: Tag[] = [
    { id: 'archive', name: 'Archive', color: '#343ca6' },
    { id: 'school', name: 'School (SUTD)', color: '#343ca6' },
    { id: 'work', name: 'Work', color: '#343ca6' },
  ]
  const checkbox = (wrapper: ReturnType<typeof mount>, id: string) =>
    wrapper.find<HTMLInputElement>(`input[type="checkbox"][value="${id}"]`)

  it('offers every tag, with the project’s own ticked', () => {
    const wrapper = mount(ProjectForm, { props: { project: { ...existing, tagIds: ['work'] }, tasks, tags } })
    expect(wrapper.findAll('.tags label').map((l) => l.text())).toEqual(['Archive', 'School (SUTD)', 'Work'])
    expect(tags.map((t) => checkbox(wrapper, t.id).element.checked)).toEqual([false, false, true])
  })

  it('saves the ticked tags, including adding or removing Archive', async () => {
    const wrapper = mount(ProjectForm, { props: { project: { ...existing, tagIds: ['work'] }, tasks, tags } })
    await checkbox(wrapper, 'archive').setValue(true)
    await wrapper.find('form').trigger('submit')
    expect(savedProject(wrapper)!.tagIds).toEqual(['work', 'archive'])

    await checkbox(wrapper, 'archive').setValue(false)
    await checkbox(wrapper, 'work').setValue(false)
    await wrapper.find('form').trigger('submit')
    expect(savedProject(wrapper)!.tagIds).toEqual([])
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

describe("ProjectForm checks its tasks' due dates against the delivery date", () => {
  const dated: Task[] = [
    { ...createEmptyTask(), id: 't1', name: 'Write report' },
    { ...createEmptyTask(), id: 't2', name: 'Review slides', dueDate: '2027-01-10' },
    { ...createEmptyTask(), id: 't3', name: 'Book room', dueDate: '2027-02-01' },
  ]

  it('blocks adding a task due after the delivery date, but only once both dates are set', async () => {
    const wrapper = mount(ProjectForm, { props: { project: existing, tasks: dated } })
    await selectWithOption(wrapper, 't3').setValue('t3')
    expect(wrapper.find('.date-error').exists()).toBe(false)

    await dateInput(wrapper).setValue('2027-01-18')
    expect(wrapper.find('.date-error').text()).toContain(
      "Book room is due 2027-02-01, after this project's delivery date (2027-01-18).",
    )
    expect(button(wrapper, 'Add task').attributes('disabled')).toBeDefined()

    await button(wrapper, 'Extend project to 2027-02-01').trigger('click')
    expect(dateInput(wrapper).element.value).toBe('2027-02-01')
    expect(wrapper.find('.date-error').exists()).toBe(false)
    expect(button(wrapper, 'Add task').attributes('disabled')).toBeUndefined()
  })

  it("moves the task's due date when the project is saved", async () => {
    const wrapper = mount(ProjectForm, { props: { project: { ...existing, deliveryDate: '2027-01-18' }, tasks: dated } })
    await selectWithOption(wrapper, 't3').setValue('t3')
    await button(wrapper, 'Move Book room to 2027-01-18').trigger('click')
    await button(wrapper, 'Add task').trigger('click')

    expect(listedIn(wrapper, 'Tasks')).toContain('Book room due date moves to 2027-01-18')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('save')?.slice(-1)[0]?.[1]).toEqual({ t3: '2027-01-18' })
  })

  it("blocks saving while a task is due after the delivery date", async () => {
    const wrapper = mount(ProjectForm, { props: { project: existing, tasks: dated } })
    await dateInput(wrapper).setValue('2027-01-05')
    expect(wrapper.find('.date-error').text()).toContain('Review slides is due 2027-01-10')
    expect(button(wrapper, 'Save').attributes('disabled')).toBeDefined()
    await wrapper.find('form').trigger('submit')
    expect(savedProject(wrapper)).toBeUndefined()

    await dateInput(wrapper).setValue('')
    expect(wrapper.find('.date-error').exists()).toBe(false)
    expect(button(wrapper, 'Save').attributes('disabled')).toBeUndefined()
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

  it.each(['javascript:alert(1)', 'data:text/html,hi', 'example.com'])('refuses to add the link %s', async (url) => {
    const wrapper = mount(ProjectForm, { props: { tasks } })
    await wrapper.find('input[placeholder="https://"]').setValue(url)
    await button(wrapper, 'Add link').trigger('click')

    expect(wrapper.find('[role="alert"]').text()).toContain('https://')
    await wrapper.find('input[placeholder="Project"]').setValue('Thesis')
    await wrapper.find('form').trigger('submit')
    expect(savedProject(wrapper)!.links).toEqual([])
  })

  it('does not make a stored unsafe link clickable', () => {
    const project = { ...existing, links: [{ label: 'Bad', url: 'javascript:alert(1)' }] }
    const wrapper = mount(ProjectForm, { props: { project, tasks } })
    expect(wrapper.find('a').attributes('href')).toBeUndefined()
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
