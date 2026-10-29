import { afterEach, describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import UpcomingPanel from '../components/upcomingPanel.vue'
import { createEmptyProject, type Project } from '../types/project'
import { ARCHIVE_TAG_ID } from '../types/tag'
import { createEmptyTask, type Task } from '../types/task'
import { addDays, upcomingTasks } from '../types/upcoming'
import { memoryRouter } from './helpers'

const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id, name: id, ...fields })
const project = (id: string, fields: Partial<Project> = {}): Project => ({ ...createEmptyProject(), id, name: id, ...fields })

describe('addDays', () => {
  it('counts calendar days across month and year ends', () => {
    expect(addDays('2026-10-27', 14)).toBe('2026-11-10')
    expect(addDays('2026-12-25', 7)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('upcomingTasks', () => {
  const today = '2026-10-27'
  const ids = (items: { task: Task }[]) => items.map((i) => i.task.id)

  it('splits unfinished tasks due within two weeks into overdue and upcoming, soonest first', () => {
    const { overdue, upcoming } = upcomingTasks(
      [
        task('next week', { dueDate: '2026-11-03' }),
        task('today', { dueDate: '2026-10-27' }),
        task('last day', { dueDate: '2026-11-10' }),
        task('too far', { dueDate: '2026-11-11' }),
        task('late', { dueDate: '2026-10-20' }),
        task('later', { dueDate: '2026-10-26' }),
        task('done', { dueDate: '2026-10-28', completed: true }),
        task('undated'),
      ],
      [],
      today,
    )
    expect(ids(overdue)).toEqual(['late', 'later'])
    expect(ids(upcoming)).toEqual(['today', 'next week', 'last day'])
  })

  it('puts the most urgent first among tasks due the same day', () => {
    const { upcoming } = upcomingTasks(
      [
        task('b', { dueDate: '2026-10-28', priority: 'low' }),
        task('a', { dueDate: '2026-10-28', priority: 'low' }),
        task('c', { dueDate: '2026-10-28', priority: 'urgent' }),
      ],
      [],
      today,
    )
    expect(ids(upcoming)).toEqual(['c', 'a', 'b'])
  })

  it('lists each task with its live projects, and leaves out tasks only in archived ones', () => {
    const tasks = [
      task('both', { dueDate: '2026-10-28' }),
      task('archived only', { dueDate: '2026-10-28' }),
      task('no project', { dueDate: '2026-10-28' }),
    ]
    const projects = [
      project('Thesis', { taskIds: ['both'] }),
      project('Old', { taskIds: ['both', 'archived only'], tagIds: [ARCHIVE_TAG_ID] }),
    ]
    const { upcoming } = upcomingTasks(tasks, projects, today)
    expect(upcoming.map((i) => [i.task.id, i.projects.map((p) => p.id)])).toEqual([
      ['both', ['Thesis']],
      ['no project', []],
    ])
  })
})


describe('UpcomingPanel', () => {
  const today = new Date().toLocaleDateString('en-CA')
  const tasks = [
    task('Write report', { dueDate: addDays(today, -2) }),
    task('Review slides', { dueDate: addDays(today, 3) }),
    task('Book room', { dueDate: addDays(today, 30) }),
  ]
  const projects = [project('p', { name: 'Thesis', taskIds: ['Write report'] })]
  const mountPanel = (props: { tasks?: Task[] } = {}) =>
    mount(UpcomingPanel, { props: { tasks, projects, ...props }, global: { plugins: [memoryRouter()] } })
  const counter = (wrapper: ReturnType<typeof mount>) => wrapper.find('button.overdue-counter')

  // Stands in for the browser's IntersectionObserver; scrollPanel tells the panel whether it's on screen
  let report: (visible: boolean) => void
  function stubObserver() {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
          report = (visible) => callback([{ isIntersecting: visible }])
        }
        observe() {}
        disconnect() {}
      },
    )
  }
  const scrollPanel = async (wrapper: ReturnType<typeof mount>, visible: boolean) => {
    report(visible)
    await wrapper.vm.$nextTick()
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  const shownTasks = (wrapper: ReturnType<typeof mount>) =>
    wrapper.findAll('.group').map((s) => [s.find('h3').text(), s.findAll('.task-name').map((n) => n.text())])
  const toggle = (wrapper: ReturnType<typeof mount>) => wrapper.find('button.collapse-toggle')
  // Two overdue and two coming up, besides the one too far off
  const manyTasks = [
    ...tasks,
    task('Print poster', { dueDate: addDays(today, -1) }),
    task('Send invites', { dueDate: addDays(today, 5) }),
  ]

  it('lists overdue and upcoming tasks with their projects', () => {
    const wrapper = mountPanel()
    const sections = wrapper.findAll('.group').map((s) => [
      s.find('h3').text(),
      s.findAll('.task-name').map((n) => n.text()),
    ])
    expect(sections).toEqual([
      ['Overdue', ['Write report']],
      ['Next 14 days', ['Review slides']],
    ])
    expect(wrapper.findAll('.task-projects').map((p) => p.text())).toEqual(['Thesis', 'No project'])
  })

  it('says when nothing is coming up', () => {
    const wrapper = mountPanel({ tasks: [tasks[2]!] })
    expect(wrapper.findAll('.group')).toEqual([])
    expect(wrapper.text()).toContain('Nothing due in the next 14 days.')
  })

  it('collapses to the first two tasks, keeping their headings, and expands again', async () => {
    const wrapper = mountPanel({ tasks: manyTasks })
    expect(toggle(wrapper).text()).toBe('Show fewer')
    expect(toggle(wrapper).attributes('aria-expanded')).toBe('true')
    expect(toggle(wrapper).attributes('aria-controls')).toBe('upcoming-tasks')

    await toggle(wrapper).trigger('click')
    expect(shownTasks(wrapper)).toEqual([['Overdue', ['Write report', 'Print poster']]])
    expect(toggle(wrapper).text()).toBe('Show all 4')
    expect(toggle(wrapper).attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.more').text()).toBe('2 more hidden')

    await toggle(wrapper).trigger('click')
    expect(shownTasks(wrapper)).toEqual([
      ['Overdue', ['Write report', 'Print poster']],
      ['Next 14 days', ['Review slides', 'Send invites']],
    ])
    expect(wrapper.find('.more').exists()).toBe(false)
  })

  it('fills a collapsed preview from the next section when fewer than two are overdue', async () => {
    const wrapper = mountPanel({ tasks: [...tasks, task('Send invites', { dueDate: addDays(today, 5) })] })
    await toggle(wrapper).trigger('click')
    expect(shownTasks(wrapper)).toEqual([
      ['Overdue', ['Write report']],
      ['Next 14 days', ['Review slides']],
    ])
  })

  it('offers no collapse button when there are no more than two tasks', () => {
    expect(toggle(mountPanel()).exists()).toBe(false)
  })

  it('remembers being collapsed, and shows every task once there are only two again', async () => {
    await toggle(mountPanel({ tasks: manyTasks })).trigger('click')
    expect(localStorage.getItem('pam.upcomingCollapsed')).toBe('true')

    const wrapper = mountPanel({ tasks: manyTasks })
    expect(toggle(wrapper).text()).toBe('Show all 4')
    await wrapper.setProps({ tasks })
    expect(shownTasks(wrapper)).toEqual([
      ['Overdue', ['Write report']],
      ['Next 14 days', ['Review slides']],
    ])
    expect(wrapper.find('.more').exists()).toBe(false)
  })

  it('starts expanded when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(toggle(mountPanel({ tasks: manyTasks })).text()).toBe('Show fewer')
    vi.restoreAllMocks()
  })

  it('emits toggleTask from a check mark, and editTask from Edit', async () => {
    const wrapper = mountPanel()
    await wrapper.find('button[aria-label="Done: Review slides"]').trigger('click')
    await wrapper.find('button[aria-label="Edit task Write report"]').trigger('click')
    expect(wrapper.emitted('toggleTask')).toEqual([[tasks[1]]])
    expect(wrapper.emitted('editTask')).toEqual([[tasks[0]]])
  })

  it('floats an overdue counter once the panel scrolls out of view, which scrolls back to it', async () => {
    stubObserver()
    const wrapper = mountPanel()
    expect(counter(wrapper).exists()).toBe(false)

    await scrollPanel(wrapper, false)
    expect(counter(wrapper).text()).toBe('1 overdue ↑')
    expect(counter(wrapper).attributes('aria-label')).toBe('1 overdue task: back to upcoming tasks')

    const scrollIntoView = vi.fn()
    wrapper.find('section.upcoming').element.scrollIntoView = scrollIntoView
    await counter(wrapper).trigger('click')
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })

    await scrollPanel(wrapper, true)
    expect(counter(wrapper).exists()).toBe(false)
  })

  it('shows no counter when nothing is overdue', async () => {
    stubObserver()
    const wrapper = mountPanel({ tasks: [tasks[1]!] })
    await scrollPanel(wrapper, false)
    expect(counter(wrapper).exists()).toBe(false)
  })
})
