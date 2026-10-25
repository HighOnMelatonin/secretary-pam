import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TaskForm from '../components/task.vue'
import { createEmptyProject, type Project } from '../types/project'
import { createEmptyTask, type Task } from '../types/task'
import { button, listedIn, selectWithOption } from './helpers'

const task: Task = { ...createEmptyTask(), id: 't1', name: 'Write report' }
const otherTasks = [
  { id: 't1', name: 'Write report' },
  { id: 't2', name: 'Review slides' },
  { id: 't3', name: 'Book room' },
]
const project = (id: string, name: string, taskIds: string[] = []): Project => ({
  ...createEmptyProject(),
  id,
  name,
  taskIds,
})
const projects = [project('p1', 'Thesis', ['t1']), project('p2', 'Website')]

const saved = (wrapper: ReturnType<typeof mount>) => wrapper.emitted<[Task, string[]]>('save')?.slice(-1)[0]

describe('TaskForm for a new task', () => {
  it('only allows adding once the task has a name', async () => {
    const wrapper = mount(TaskForm)
    expect(button(wrapper, 'Add').attributes('disabled')).toBeDefined()
    await wrapper.find('input[placeholder="Task"]').setValue('Write report')
    expect(button(wrapper, 'Add').attributes('disabled')).toBeUndefined()
  })

  it('emits the filled-in task with a trimmed name, then clears the form', async () => {
    const wrapper = mount(TaskForm)
    await wrapper.find('input[placeholder="Task"]').setValue('  Write report ')
    await wrapper.find('input[type="date"]').setValue('2026-11-02')
    await wrapper.find('select').setValue('high')
    await wrapper.find('textarea').setValue('Chapter 3')
    await wrapper.find('input[type="checkbox"]').setValue(true)
    await wrapper.find('form').trigger('submit')

    expect(saved(wrapper)).toEqual([
      {
        id: expect.any(String),
        name: 'Write report',
        description: 'Chapter 3',
        dueDate: '2026-11-02',
        relations: [],
        priority: 'high',
        completed: true,
      },
      [],
    ])
    expect((wrapper.find('input[placeholder="Task"]').element as HTMLInputElement).value).toBe('')
  })
})

describe('TaskForm project assignment', () => {
  it('shows the projects the task is already in', () => {
    const wrapper = mount(TaskForm, { props: { task, projects } })
    expect(listedIn(wrapper, 'Projects')).toEqual(['Thesis'])
    expect(selectWithOption(wrapper, 'p2').exists()).toBe(true)
  })

  it('emits the chosen project ids on save', async () => {
    const wrapper = mount(TaskForm, { props: { task, projects } })

    await wrapper.find('li button').trigger('click') // remove Thesis
    await selectWithOption(wrapper, 'p2').setValue('p2')
    await button(wrapper, 'Assign').trigger('click')
    await wrapper.find('form').trigger('submit')

    expect(saved(wrapper)?.[1]).toEqual(['p2'])
  })

  it('uses projectIds over the projects when given, e.g. to restore an unsaved choice', () => {
    const wrapper = mount(TaskForm, { props: { task, projects, projectIds: ['p2'] } })
    expect(listedIn(wrapper, 'Projects')).toEqual(['Website'])
  })

  it('starts a new task in no projects', () => {
    const wrapper = mount(TaskForm, { props: { projects } })
    expect(listedIn(wrapper, 'Projects')).toEqual([])
    expect(wrapper.text()).toContain('Not in any project.')
  })
})

describe('TaskForm relations', () => {
  it('links other tasks with a relation type, but never the task itself', async () => {
    const wrapper = mount(TaskForm, { props: { task, availableTasks: otherTasks } })
    expect(selectWithOption(wrapper, 't2').find('option[value="t1"]').exists()).toBe(false)

    await selectWithOption(wrapper, 'blocks').setValue('blocks')
    await selectWithOption(wrapper, 't2').setValue('t2')
    await button(wrapper, 'Link').trigger('click')

    expect(listedIn(wrapper, 'Related tasks')).toEqual(['blocks: Review slides'])
    // A task can only be related once
    expect(selectWithOption(wrapper, 't3').find('option[value="t2"]').exists()).toBe(false)

    await wrapper.find('form').trigger('submit')
    expect(saved(wrapper)?.[0].relations).toEqual([{ taskId: 't2', type: 'blocks' }])
  })

  it('names related tasks, falling back to the id for unknown ones', () => {
    const wrapper = mount(TaskForm, {
      props: {
        task: { ...task, relations: [{ taskId: 't2', type: 'blocked_by' }, { taskId: 'gone', type: 'related_to' }] },
        availableTasks: otherTasks,
      },
    })
    expect(listedIn(wrapper, 'Related tasks')).toEqual(['blocked by: Review slides', 'related to: gone'])
  })

  it('removes a relation', async () => {
    const wrapper = mount(TaskForm, {
      props: { task: { ...task, relations: [{ taskId: 't2', type: 'blocks' }] }, availableTasks: otherTasks },
    })
    const relations = wrapper.findAll('fieldset')[1]!
    await relations.find('li button').trigger('click')
    expect(listedIn(wrapper, 'Related tasks')).toEqual([])
  })
})

describe('TaskForm for an existing task', () => {
  it('does not change the original until saved', async () => {
    const original = structuredClone(task)
    const wrapper = mount(TaskForm, { props: { task, projects } })
    expect(button(wrapper, 'Save').exists()).toBe(true)

    await wrapper.find('input[placeholder="Task"]').setValue('Renamed')
    await wrapper.find('input[type="checkbox"]').setValue(true)
    expect(task).toEqual(original)

    await wrapper.find('form').trigger('submit')
    expect(saved(wrapper)?.[0]).toMatchObject({ id: 't1', name: 'Renamed', completed: true })
  })

  it('discards edits, including project changes, and emits cancel', async () => {
    const wrapper = mount(TaskForm, { props: { task, projects } })
    await wrapper.find('input[placeholder="Task"]').setValue('Renamed')
    await wrapper.find('li button').trigger('click') // remove Thesis
    await button(wrapper, 'Cancel').trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect((wrapper.find('input[placeholder="Task"]').element as HTMLInputElement).value).toBe('Write report')
    expect(listedIn(wrapper, 'Projects')).toEqual(['Thesis'])
  })
})
