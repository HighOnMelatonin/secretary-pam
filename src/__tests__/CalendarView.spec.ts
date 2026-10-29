// The calendar as the app shows it: the dashboard at /calendar, over a fake API, on 10 November 2026
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import Dashboard from '../components/dashboard.vue'
import { createEmptyProject, type Project } from '../types/project'
import { ARCHIVE_TAG_ID, type Tag } from '../types/tag'
import { createEmptyTask, type Task } from '../types/task'
import { fakeApi } from './fakeApi'
import { button, routerAt } from './helpers'

const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id, name: id, ...fields })
const project = (id: string, fields: Partial<Project> = {}): Project => ({ ...createEmptyProject(), id, name: id, ...fields })

const tags: Tag[] = [
  { id: 'work', name: 'Work', color: '#17646a' },
  { id: 'school', name: 'School', color: '#f5d76e' },
  { id: ARCHIVE_TAG_ID, name: 'Archive', color: '#343ca6' },
]
const tasks = [
  ...['a', 'b', 'c', 'd'].map((id) => task(id, { dueDate: '2026-11-12' })),
  task('late', { dueDate: '2026-11-03' }),
  task('essay', { dueDate: '2026-11-17' }),
  task('finished', { dueDate: '2026-11-13', completed: true }),
  task('old work', { dueDate: '2026-11-14' }),
  task('Plan'),
]
const projects = [
  project('Thesis', { tagIds: ['work'], taskIds: ['a', 'b', 'c', 'd', 'late', 'finished', 'Plan'], deliveryDate: '2026-11-20' }),
  project('Course', { tagIds: ['school'], taskIds: ['essay'] }),
  project('Done', { tagIds: [ARCHIVE_TAG_ID], taskIds: ['old work'], deliveryDate: '2026-11-18' }),
]

async function mountCalendar(path = '/calendar') {
  const router = await routerAt(path)
  const wrapper = mount(Dashboard, { global: { plugins: [createPinia(), router] } })
  await flushPromises()
  return { wrapper, router }
}

type Wrapper = Awaited<ReturnType<typeof mountCalendar>>['wrapper']
const day = (wrapper: Wrapper, date: string) => wrapper.find(`[data-date="${date}"]`)
const chips = (wrapper: Wrapper, date: string) => day(wrapper, date).findAll('.item-chip')
const chipTitles = (wrapper: Wrapper, date: string) => chips(wrapper, date).map((c) => c.find('span:not(.sr-only):not([aria-hidden])').text())
const heading = (wrapper: Wrapper) => wrapper.find('#calendar-heading').text()

// Stands in for a phone's screen width, which shows the compact grid
const stubPhone = () =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 10, 12))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('Calendar', () => {
  it("shows the month in the URL, or this month when there's none or it isn't a month", async () => {
    fakeApi({ tasks, projects, tags })
    expect(heading((await mountCalendar('/calendar?month=2026-12')).wrapper)).toBe('December 2026')
    expect(heading((await mountCalendar('/calendar?month=2026-13')).wrapper)).toBe('November 2026')
    expect(heading((await mountCalendar('/calendar')).wrapper)).toBe('November 2026')
  })

  it('moves between months with the toolbar, keeping the month in the URL', async () => {
    fakeApi({ tasks, projects, tags })
    const { wrapper, router } = await mountCalendar()
    const month = () => router.currentRoute.value.query.month
    expect(button(wrapper, 'Today').attributes('disabled')).toBeDefined()

    await wrapper.find('button[aria-label="Next month"]').trigger('click')
    await flushPromises()
    expect([month(), heading(wrapper)]).toEqual(['2026-12', 'December 2026'])

    await wrapper.find('button[aria-label="Previous month"]').trigger('click')
    await flushPromises()
    await wrapper.find('button[aria-label="Previous month"]').trigger('click')
    await flushPromises()
    expect(month()).toBe('2026-10')

    await button(wrapper, 'Today').trigger('click')
    await flushPromises()
    expect([month(), heading(wrapper)]).toEqual(['2026-11', 'November 2026'])
    expect(router.currentRoute.value.name).toBe('calendar')
  })

  it('shows up to three chips a day, then "+N more", which expands the day', async () => {
    fakeApi({ tasks, projects, tags })
    const { wrapper } = await mountCalendar()
    expect(chipTitles(wrapper, '2026-11-12')).toEqual(['a', 'b', 'c'])

    await day(wrapper, '2026-11-12').find('button.more').trigger('click')
    expect(chipTitles(wrapper, '2026-11-12')).toEqual(['a', 'b', 'c', 'd'])
    await button(wrapper, 'Show fewer').trigger('click')
    expect(chips(wrapper, '2026-11-12')).toHaveLength(3)
    expect(day(wrapper, '2026-11-12').find('button.more').text()).toBe('+1 more')
  })

  it("links each chip to its page, coloured by its tag with readable text", async () => {
    fakeApi({ tasks, projects, tags })
    const { wrapper } = await mountCalendar()
    const [work] = chips(wrapper, '2026-11-12')
    expect(work!.attributes('href')).toBe('/tasks/a')
    expect(work!.attributes('style')).toBe('--chip-fill: #17646a; --chip-text: #faefe0;')

    const [school] = chips(wrapper, '2026-11-17')
    expect(school!.attributes('style')).toBe('--chip-fill: #f5d76e; --chip-text: #204030;') // green on the light yellow
  })

  it('shows a delivery date as a flag linking to its project', async () => {
    fakeApi({ tasks, projects, tags })
    const { wrapper } = await mountCalendar()
    const [flag] = chips(wrapper, '2026-11-20')
    expect(flag!.classes()).toContain('flag')
    expect(flag!.attributes('href')).toBe('/projects/Thesis')
    expect(flag!.text()).toContain('Thesis')
    expect(flag!.text()).toContain('(delivery date)')
  })

  it('marks today, and items past their date as overdue', async () => {
    fakeApi({ tasks, projects, tags })
    const { wrapper } = await mountCalendar()
    expect(day(wrapper, '2026-11-10').classes()).toContain('today')
    const [late] = chips(wrapper, '2026-11-03')
    expect(late!.classes()).toContain('overdue')
    expect(late!.text()).toContain('(overdue)')
    expect(chips(wrapper, '2026-11-12')[0]!.classes()).not.toContain('overdue')
  })

  it('leaves out completed tasks and archived projects', async () => {
    fakeApi({ tasks, projects, tags })
    const { wrapper } = await mountCalendar()
    expect(chips(wrapper, '2026-11-13')).toEqual([]) // finished
    expect(chips(wrapper, '2026-11-14')).toEqual([]) // only in the archived project
    expect(chips(wrapper, '2026-11-18')).toEqual([]) // the archived project's delivery date
  })

  it('starts weeks on Monday, or on Sunday once chosen, which this browser remembers', async () => {
    fakeApi({ tasks, projects, tags })
    const { wrapper } = await mountCalendar()
    const firstColumn = () => [wrapper.find('th').text(), wrapper.find('td').attributes('data-date')]
    expect(firstColumn()).toEqual(['Mon', '2026-10-26'])

    await wrapper.find('.week-start select').setValue('0')
    expect(firstColumn()).toEqual(['Sun', '2026-11-01'])
    expect(localStorage.getItem('pam.calendar.weekStart')).toBe('0')

    const again = (await mountCalendar()).wrapper
    expect(again.find('td').attributes('data-date')).toBe('2026-11-01')
  })

  it('starts on Monday when the remembered week start is not one it offers', async () => {
    localStorage.setItem('pam.calendar.weekStart', '3')
    fakeApi({ tasks, projects, tags })
    expect((await mountCalendar()).wrapper.find('th').text()).toBe('Mon')
  })

  it('filters by tag, offering every tag but Archive', async () => {
    fakeApi({ tasks, projects, tags })
    const { wrapper } = await mountCalendar()
    const tagChips = wrapper.findAll('.filters .chip')
    expect(tagChips.map((c) => c.text())).toEqual(['Work', 'School', 'No tag'])

    await tagChips[1]!.trigger('click')
    expect(tagChips[1]!.attributes('aria-pressed')).toBe('true')
    expect(chips(wrapper, '2026-11-17')).toHaveLength(1) // the essay, in Course
    expect(chips(wrapper, '2026-11-12')).toEqual([])
    expect(wrapper.find('.undated-tray summary').text()).toBe('No due date (0)')
  })

  it('lists the tasks with no due date in a tray below, each with its projects and Edit', async () => {
    fakeApi({ tasks, projects, tags })
    const { wrapper, router } = await mountCalendar('/calendar?month=2026-12')
    const tray = wrapper.find('.undated-tray')
    expect(tray.find('summary').text()).toBe('No due date (1)')
    expect(tray.find('.task-name').text()).toBe('Plan')
    expect(tray.find('.task-projects').text()).toBe('Thesis')

    // Editing from the calendar, then cancelling, returns to the same month
    await tray.find('button[aria-label="Edit task Plan"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/tasks/Plan/edit')
    await button(wrapper, 'Cancel').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/calendar?month=2026-12')
    expect(heading(wrapper)).toBe('December 2026')
  })

  it("shows a compact grid on phones, with the selected day's tasks listed below", async () => {
    stubPhone()
    fakeApi({ tasks, projects, tags })
    const { wrapper } = await mountCalendar()
    expect(wrapper.find('.calendar-grid').classes()).toContain('compact')
    expect(wrapper.find('.item-chip').exists()).toBe(false)
    expect(day(wrapper, '2026-11-12').findAll('.dot')).toHaveLength(4)
    expect(wrapper.find('.selected-day h3').text()).toBe('Tuesday 10 November') // today, to start with
    expect(wrapper.find('.selected-day').text()).toContain('Nothing due.')

    const twelfth = day(wrapper, '2026-11-12').find('button')
    expect(twelfth.attributes('aria-label')).toBe('Thursday 12 November, 4 items')
    await twelfth.trigger('click')
    expect(twelfth.attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('.selected-day h3').text()).toBe('Thursday 12 November')
    expect(wrapper.findAll('.selected-day .task-name').map((n) => n.text())).toEqual(['a', 'b', 'c', 'd'])
    expect(wrapper.find('.selected-day .task-projects').text()).toBe('Thesis')
  })

  it('lists a selected delivery date as a link, and says when it is overdue', async () => {
    stubPhone()
    fakeApi({ tasks: [], projects: [project('Thesis', { deliveryDate: '2026-11-03' })], tags })
    const { wrapper } = await mountCalendar()
    const third = day(wrapper, '2026-11-03').find('button')
    expect(third.attributes('aria-label')).toBe('Tuesday 3 November, 1 item, 1 overdue')
    expect(day(wrapper, '2026-11-03').find('.dot').classes()).toEqual(expect.arrayContaining(['flag', 'overdue']))

    await third.trigger('click')
    const delivery = wrapper.find('.selected-day .delivery')
    expect(delivery.find('a').attributes('href')).toBe('/projects/Thesis')
    expect(delivery.findAll('.tag').map((t) => t.text())).toEqual(['Delivery', 'overdue'])
  })

  it('still shows the delivery dates when the tasks fail to load', async () => {
    const api = fakeApi({ tasks, projects, tags })
    api.failWith = 'D1 is down'
    api.failOn = 'tasks'
    const { wrapper } = await mountCalendar()
    expect(wrapper.text()).toContain("Tasks couldn't be loaded, so they aren't shown: D1 is down")
    expect(chips(wrapper, '2026-11-20')).toHaveLength(1)
    expect(chips(wrapper, '2026-11-12')).toEqual([])
  })
})
