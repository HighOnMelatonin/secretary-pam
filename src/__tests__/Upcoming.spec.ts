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

describe('UpcomingPanel Suggested', () => {
  // A Monday; the default capacity is 8 hours Monday to Friday
  const today = '2026-11-16'
  const tasks = [
    task('Late', { dueDate: '2026-11-13' }),
    task('Crunch', { dueDate: '2026-11-17', effortMinutes: 16 * 60 }),
    task('Pinned', { pinnedDate: today, effortMinutes: 60 }),
    task('Soon', { dueDate: '2026-11-17', priority: 'urgent' }),
    task('Someday', { priority: 'low', effortMinutes: 30 }),
    task('Waiting', { relations: [{ taskId: 'Someday', type: 'blocked_by' }] }),
    task('Later', { startDate: '2026-11-18' }),
  ]
  const projects = [project('p', { name: 'Thesis', taskIds: ['Crunch'] })]
  const mountPanel = (props: Record<string, unknown> = {}) =>
    mount(UpcomingPanel, { props: { tasks, projects, today, ...props }, global: { plugins: [memoryRouter()] } })
  const suggested = async (props: Record<string, unknown> = {}) => {
    const wrapper = mountPanel(props)
    await wrapper.findAll('.mode-switch button').find((b) => b.text() === 'Suggested')!.trigger('click')
    return wrapper
  }
  const shown = (wrapper: ReturnType<typeof mount>) =>
    wrapper.findAll('.group').map((s) => [s.find('h3').text(), s.findAll('.task-name').map((n) => n.text())])
  const row = (wrapper: ReturnType<typeof mount>, name: string) =>
    wrapper.findAll('li.task').find((li) => li.find('.task-name').text() === name)!
  const rowButton = (wrapper: ReturnType<typeof mount>, name: string, text: string) =>
    row(wrapper, name).findAll('button').find((b) => b.text() === text)!

  afterEach(() => localStorage.clear())

  it('starts by date, and switches to the ranked categories, which this browser remembers', async () => {
    const byDate = mountPanel()
    expect(byDate.findAll('.mode-switch button').map((b) => [b.text(), b.attributes('aria-pressed')])).toEqual([
      ['By date', 'true'],
      ['Suggested', 'false'],
    ])
    expect(shown(byDate).map(([heading]) => heading)).toEqual(['Overdue', 'Next 14 days'])

    const wrapper = await suggested()
    expect(shown(wrapper)).toEqual([
      ['Overdue', ['Late']],
      ['Do nowww', ['Crunch', 'Pinned']],
      ['Do next', ['Soon', 'Someday']],
    ])
    expect(localStorage.getItem('pam.upcomingMode')).toBe('suggested')
    expect(shown(mountPanel())[1]![0]).toBe('Do nowww')
  })

  it('says why each task is there, marks pinned, unestimated and looped tasks, and counts the hidden ones', async () => {
    const looped = [
      ...tasks,
      task('A', { relations: [{ taskId: 'B', type: 'blocks' }] }),
      task('B', { relations: [{ taskId: 'A', type: 'blocks' }] }),
    ]
    const wrapper = await suggested({ tasks: looped })
    const reason = (name: string) => [
      row(wrapper, name).find('.reason small').text(),
      row(wrapper, name).findAll('.reason .tag').map((t) => t.text()),
    ]
    expect(reason('Late')).toEqual(['Was due 3 days ago', ['no estimate']])
    expect(reason('Crunch')).toEqual(["Needs all the working time left before it's due", []])
    expect(reason('Pinned')).toEqual(['Pinned to today', ['pinned']])
    expect(reason('A')[1]).toEqual(['no estimate', 'in a loop'])
    expect(row(wrapper, 'Crunch').find('.task-projects').text()).toBe('Thesis')
    expect(wrapper.text()).toContain('Hidden: 1 waiting on other tasks and 1 not started yet.')
  })

  it('shows the first 10 of Do next, then the rest on request', async () => {
    const many = Array.from({ length: 13 }, (_, i) => task(`Task ${String(i).padStart(2, '0')}`))
    const wrapper = await suggested({ tasks: many })
    expect(shown(wrapper)[0]![1]).toHaveLength(10)
    await wrapper.findAll('button').find((b) => b.text() === 'Show 3 more')!.trigger('click')
    expect(shown(wrapper)[0]![1]).toHaveLength(13)
  })

  it('collapses to its first two rows, like the list by date', async () => {
    const wrapper = await suggested()
    await wrapper.find('button.collapse-toggle').trigger('click')
    expect(shown(wrapper)).toEqual([
      ['Overdue', ['Late']],
      ['Do nowww', ['Crunch']],
    ])
    expect(wrapper.find('button.collapse-toggle').text()).toBe('Show all 5')
  })

  it('ranks with the settings it is given', async () => {
    // With 16 hours a day, Crunch has time to spare
    const roomy = {
      capacityMinutes: { mon: 960, tue: 960, wed: 960, thu: 960, fri: 960, sat: 0, sun: 0 },
      buffer: 1,
      wU: 1,
      k: 1,
      horizonDays: 2,
      preset: 'balanced',
    }
    const wrapper = await suggested({ settings: roomy })
    expect(shown(wrapper)[1]).toEqual(['Do nowww', ['Pinned']])
  })

  it('emits the quick actions, never a whole task save', async () => {
    const wrapper = await suggested()
    await rowButton(wrapper, 'Soon', 'Do today').trigger('click')
    await rowButton(wrapper, 'Pinned', 'Unpin').trigger('click')
    await rowButton(wrapper, 'Someday', 'Not today').trigger('click')
    await rowButton(wrapper, 'Someday', 'Priority ↑').trigger('click')
    await rowButton(wrapper, 'Soon', 'Priority ↓').trigger('click')
    const emitted = wrapper.emitted<[Task, unknown]>('action')!.map(([t, action]) => [t.name, action])
    expect(emitted).toEqual([
      ['Soon', { action: 'do_today', today }],
      ['Pinned', { action: 'unpin' }],
      ['Someday', { action: 'not_today', today }],
      ['Someday', { action: 'importance', direction: 'up' }],
      ['Soon', { action: 'importance', direction: 'down' }],
    ])
    expect(wrapper.emitted('toggleTask')).toBeUndefined()
  })

  it('greys out Not today for a task due today or overdue, saying why, and priority past either end', async () => {
    const wrapper = await suggested({ tasks: [...tasks, task('Today', { dueDate: today })] })
    expect(rowButton(wrapper, 'Late', 'Not today').attributes('disabled')).toBeDefined()
    expect(row(wrapper, 'Late').find('.action-note').text()).toBe("It's overdue, so it can't wait until tomorrow")
    expect(row(wrapper, 'Today').find('.action-note').text()).toBe("It's due today, so it can't wait until tomorrow")
    expect(rowButton(wrapper, 'Pinned', 'Not today').attributes('disabled')).toBeUndefined()
    expect(rowButton(wrapper, 'Soon', 'Priority ↑').attributes('disabled')).toBeDefined()
    expect(rowButton(wrapper, 'Someday', 'Priority ↓').attributes('disabled')).toBeDefined()
  })

  it('edits the estimate in place, in hours', async () => {
    const wrapper = await suggested()
    await rowButton(wrapper, 'Pinned', 'Estimate: 1 h').trigger('click')
    const input = row(wrapper, 'Pinned').find<HTMLInputElement>('input')
    expect(input.element.value).toBe('1')

    await input.setValue('abc')
    expect(row(wrapper, 'Pinned').find('[role="alert"]').exists()).toBe(true)
    expect(rowButton(wrapper, 'Pinned', 'Save').attributes('disabled')).toBeDefined()

    await input.setValue('2,5')
    await row(wrapper, 'Pinned').find('form').trigger('submit')
    await rowButton(wrapper, 'Soon', 'Add estimate').trigger('click')
    await row(wrapper, 'Soon').find('form').trigger('submit') // left blank: no estimate
    await rowButton(wrapper, 'Someday', 'Estimate: 0.5 h').trigger('click')
    await rowButton(wrapper, 'Someday', 'Cancel').trigger('click')

    expect(wrapper.emitted<[Task, unknown]>('action')!.map(([t, action]) => [t.name, action])).toEqual([
      ['Pinned', { action: 'estimate', effortMinutes: 150 }],
      ['Soon', { action: 'estimate', effortMinutes: null }],
    ])
    expect(row(wrapper, 'Someday').find('form').exists()).toBe(false)
  })
})
