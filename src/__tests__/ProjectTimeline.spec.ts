import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'

import { mount } from '@vue/test-utils'
import ProjectTimeline from '../components/projectTimeline.vue'
import { createEmptyTask, type Task } from '../types/task'
import { memoryRouter } from './helpers'

const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id, name: id, ...fields })

const mountTimeline = (tasks: Task[], deliveryDate: string | null = null) =>
  mount(ProjectTimeline, { props: { tasks, deliveryDate }, global: { plugins: [memoryRouter()] } })

// Each stop's date (or "No due date") and labels, then its tasks with their check marks
const stopsOf = (wrapper: ReturnType<typeof mountTimeline>) =>
  wrapper.findAll('.stop').map((stop) => ({
    when: stop.findAll('.when > *').map((part) => part.text()).join(' '),
    tasks: stop.findAll('.stop-tasks li').map((li) => `${li.find('.check').text()} ${li.find('.task-name').text()}`),
  }))

describe('ProjectTimeline', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 26, 12)) // 26 Oct 2026, local time
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('puts the tasks in date order, sharing a stop per day, with today, delivery and undated tasks', () => {
    const wrapper = mountTimeline(
      [
        task('Draft', { dueDate: '2026-11-02' }),
        task('Research', { dueDate: '2026-10-20', completed: true }),
        task('Someday'),
        task('Polish', { dueDate: '2026-11-02' }),
        task('Submit', { dueDate: '2027-01-15' }),
      ],
      '2026-12-01',
    )

    expect(stopsOf(wrapper)).toEqual([
      { when: '20 Oct', tasks: ['✓ Research (completed)'] },
      { when: '26 Oct Today', tasks: [] },
      { when: '2 Nov', tasks: ['○ Draft', '○ Polish'] },
      { when: '1 Dec Delivery', tasks: [] },
      { when: '15 Jan 2027', tasks: ['○ Submit'] },
      { when: 'No due date', tasks: ['○ Someday'] },
    ])
  })

  it('marks a past stop overdue only while it has work left, and a past delivery date', () => {
    const wrapper = mountTimeline(
      [task('Late', { dueDate: '2026-10-01' }), task('Finished', { dueDate: '2026-10-10', completed: true })],
      '2026-10-20',
    )
    const [late, finished, delivery] = wrapper.findAll('.stop')

    expect(late!.classes()).toContain('overdue')
    expect(late!.text()).toContain('(overdue)')
    expect(finished!.classes()).toEqual(expect.arrayContaining(['done']))
    expect(finished!.classes()).not.toContain('overdue')
    expect(delivery!.classes()).toEqual(expect.arrayContaining(['delivery', 'overdue']))
  })

  it('shares a stop when a task is due today or on the delivery date', () => {
    const wrapper = mountTimeline([task('Now', { dueDate: '2026-10-26' })], '2026-10-26')
    expect(stopsOf(wrapper)).toEqual([{ when: '26 Oct Today Delivery', tasks: ['○ Now'] }])
  })

  it('suggests adding due dates when nothing has a date', () => {
    const wrapper = mountTimeline([task('Someday')])
    expect(wrapper.find('.timeline').exists()).toBe(false)
    expect(wrapper.text()).toContain('due dates')
  })
})
