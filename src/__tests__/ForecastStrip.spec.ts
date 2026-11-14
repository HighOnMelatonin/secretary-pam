import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ForecastStrip from '../components/forecastStrip.vue'
import { forecast } from '../types/forecast'
import { DEFAULT_SETTINGS } from '../types/settings'
import { createEmptyTask, type Task } from '../types/task'

// A Monday; the default capacity is 8 hours Monday to Friday
const today = '2026-11-16'
const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id, name: id, ...fields })

describe('ForecastStrip', () => {
  // 20 hours due Tuesday: Monday and Tuesday full, Wednesday half; Tuesday is overbooked
  const result = forecast([task('Report', { dueDate: '2026-11-17', effortMinutes: 20 * 60 })], [], DEFAULT_SETTINGS, today)
  const wrapper = mount(ForecastStrip, { props: { forecast: result } })
  const days = wrapper.findAll('.strip li')

  it('shows the brief', () => {
    expect(wrapper.find('.brief').text()).toBe(result.brief.text)
    expect(wrapper.find('.brief').text()).toContain('Today: 1 task, 8 h of 8 h.')
  })

  it('shows the next seven days, with the hours planned of the hours there are', () => {
    expect(days.map((d) => [d.find('.day').text(), d.find('small').text()])).toEqual([
      ['Mon 16', '8/8 h'],
      ['Tue 17', '8/8 h'],
      ['Wed 18', '4/8 h'],
      ['Thu 19', '0/8 h'],
      ['Fri 20', '0/8 h'],
      ['Sat 21', 'off'],
      ['Sun 22', 'off'],
    ])
    expect(days.map((d) => d.find('.planned').attributes('style'))).toEqual([
      'width: 100%;',
      'width: 100%;',
      'width: 50%;',
      'width: 0%;',
      'width: 0%;',
      'width: 0%;',
      'width: 0%;',
    ])
  })

  it('marks overbooked days in words as well as colour, and describes each day for screen readers', () => {
    expect(days.map((d) => d.classes('overbooked'))).toEqual([false, true, false, false, false, false, false])
    expect(days[1]!.find('.over').text()).toBe('over')
    expect(days[1]!.attributes('aria-label')).toBe('2026-11-17: 8 of 8 hours planned, overbooked')
    expect(days[5]!.attributes('aria-label')).toBe('2026-11-21: day off')
  })
})
