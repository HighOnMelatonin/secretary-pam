import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import TaskTimeline from '../components/taskTimeline.vue'

const TODAY = '2026-11-17'

const timeline = (task: { startDate?: string; dueDate: string | null; completed?: boolean }) =>
  mount(TaskTimeline, { props: { task: { completed: false, ...task }, today: TODAY } })

const points = (wrapper: ReturnType<typeof timeline>) =>
  wrapper.findAll('.point').map((p) => [p.find('.label').text(), p.find('.date').text()])

describe('TaskTimeline', () => {
  it('places today, start and due in order with their dates', () => {
    const wrapper = timeline({ startDate: '2026-11-20', dueDate: '2026-11-28' })
    expect(points(wrapper)).toEqual([
      ['today', '17/11/2026'],
      ['start', '20/11/2026'],
      ['due', '28/11/2026'],
    ])
    expect(wrapper.find('.window').exists()).toBe(true)
  })

  it('puts today between start and due once work has started', () => {
    const wrapper = timeline({ startDate: '2026-11-10', dueDate: '2026-11-28' })
    expect(points(wrapper).map(([label]) => label)).toEqual(['start', 'today', 'due'])
  })

  it('shares a marker between points on the same day', () => {
    const wrapper = timeline({ startDate: TODAY, dueDate: '2026-11-28' })
    expect(points(wrapper)).toEqual([
      ['today · start', '17/11/2026'],
      ['due', '28/11/2026'],
    ])
  })

  it('shows just today and due when there is no start date', () => {
    const wrapper = timeline({ dueDate: '2026-11-28' })
    expect(points(wrapper).map(([label]) => label)).toEqual(['today', 'due'])
    expect(wrapper.find('.window').exists()).toBe(false)
  })

  it('marks a due date that has passed', () => {
    const wrapper = timeline({ dueDate: '2026-11-10' })
    expect(points(wrapper).map(([label]) => label)).toEqual(['due', 'today'])
    expect(wrapper.find('.point.late').exists()).toBe(true)
    expect(timeline({ dueDate: '2026-11-10', completed: true }).find('.point.late').exists()).toBe(false)
  })

  it('is hidden without a start or due date', () => {
    expect(timeline({ dueDate: null }).find('.timeline').exists()).toBe(false)
  })
})
