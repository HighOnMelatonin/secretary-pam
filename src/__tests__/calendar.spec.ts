import { describe, it, expect } from 'vitest'
import {
  addMonths,
  calendarItems,
  isOverdue,
  itemsByDate,
  lastDateOf,
  localDateOf,
  matchesTags,
  monthGrid,
  monthLabel,
  NEUTRAL_COLOUR,
  parseMonth,
  projectToItems,
  tagColour,
  taskToItems,
  undatedTasks,
  weekdayOf,
  withinDay,
  type CalendarItem,
} from '../types/calendar'
import { createEmptyProject, type Project } from '../types/project'
import { ARCHIVE_TAG_ID, NO_TAG, textColorOn, type Tag } from '../types/tag'
import { createEmptyTask, type Task } from '../types/task'

const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id, name: id, ...fields })
const project = (id: string, fields: Partial<Project> = {}): Project => ({ ...createEmptyProject(), id, name: id, ...fields })
const item = (id: string, fields: Partial<CalendarItem> = {}): CalendarItem => ({
  id,
  source: 'task',
  title: id,
  date: '2026-11-05',
  editable: false,
  colour: NEUTRAL_COLOUR,
  link: `/tasks/${id}`,
  tagIds: [],
  ...fields,
})

describe('calendar dates', () => {
  it('reads a ?month= query, rejecting anything that is not a month', () => {
    expect(parseMonth('2026-11')).toBe('2026-11')
    expect([undefined, null, ['2026-11'], '2026-13', '2026-00', '2026-1', '2026-11-01', 'next'].map(parseMonth)).toEqual(
      Array(8).fill(null),
    )
  })

  it('moves between months across year ends', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-03', -13)).toBe('2025-02')
  })

  it('knows the last day of each month, including leap years', () => {
    expect(['2026-02', '2028-02', '2000-02', '2100-02', '2026-04', '2026-12'].map(lastDateOf)).toEqual([
      '2026-02-28',
      '2028-02-29',
      '2000-02-29',
      '2100-02-28',
      '2026-04-30',
      '2026-12-31',
    ])
  })

  it('names months and weekdays without the time zone shifting them', () => {
    expect(monthLabel('2026-11')).toBe('November 2026')
    expect(['2026-11-01', '2026-11-30', '2028-02-29'].map(weekdayOf)).toEqual([0, 1, 2])
    expect(localDateOf('2026-11-02T09:00')).toBe('2026-11-02') // a local time stays on its day
  })
})

describe('monthGrid', () => {
  const firstAndLast = (weeks: ReturnType<typeof monthGrid>) => {
    const lastWeek = weeks[weeks.length - 1]!
    return [weeks[0]![0]!.date, lastWeek[lastWeek.length - 1]!.date]
  }

  it('starts each week on Monday, filling the first and last weeks from the months around it', () => {
    const weeks = monthGrid('2026-11', 1) // the 1st is a Sunday, the 30th a Monday
    expect(weeks).toHaveLength(6)
    expect(firstAndLast(weeks)).toEqual(['2026-10-26', '2026-12-06'])
    expect(weeks.every((w) => w.length === 7 && weekdayOf(w[0]!.date) === 1)).toBe(true)
    expect(weeks[0]!.map((d) => d.inMonth)).toEqual([false, false, false, false, false, false, true])
  })

  it('starts each week on Sunday when asked', () => {
    const weeks = monthGrid('2026-11', 0)
    expect(weeks).toHaveLength(5)
    expect(firstAndLast(weeks)).toEqual(['2026-11-01', '2026-12-05'])
    expect(weeks.every((w) => weekdayOf(w[0]!.date) === 0)).toBe(true)
  })

  it('fits a month that starts on the first day of the week into exactly four weeks', () => {
    const weeks = monthGrid('2026-02', 0) // Sunday the 1st to Saturday the 28th
    expect(weeks).toHaveLength(4)
    expect(weeks.flat().every((d) => d.inMonth)).toBe(true)
    expect(firstAndLast(monthGrid('2026-02', 1))).toEqual(['2026-01-26', '2026-03-01'])
  })

  it('includes the 29th of February in a leap year', () => {
    const days = monthGrid('2028-02', 1).flat()
    expect(days.find((d) => d.date === '2028-02-29')).toEqual({ date: '2028-02-29', inMonth: true })
    expect(days.filter((d) => d.inMonth)).toHaveLength(29)
  })

  it('runs across the end of a year', () => {
    expect(firstAndLast(monthGrid('2026-12', 1))).toEqual(['2026-11-30', '2027-01-03'])
  })
})

describe('calendar items', () => {
  const tags: Tag[] = [
    { id: 'work', name: 'Work', color: '#17646a' },
    { id: 'school', name: 'School', color: '#f5d76e' },
    { id: ARCHIVE_TAG_ID, name: 'Archive', color: '#343ca6' },
  ]
  const projects = [
    project('thesis', { tagIds: ['work', 'school'], taskIds: ['report', 'done'], deliveryDate: '2026-11-20' }),
    project('old', { tagIds: ['school', ARCHIVE_TAG_ID], taskIds: ['archived only', 'both'], deliveryDate: '2026-11-15' }),
    project('gym', { tagIds: [], taskIds: ['both'] }),
  ]
  const tasks = [
    task('report', { dueDate: '2026-11-05' }),
    task('done', { dueDate: '2026-11-06', completed: true }),
    task('archived only', { dueDate: '2026-11-07' }),
    task('both', { dueDate: '2026-11-08' }),
    task('loose', { dueDate: '2026-11-09' }),
    task('undated'),
    task('far', { dueDate: '2026-12-25' }),
  ]
  const ids = (items: CalendarItem[]) => items.map((i) => `${i.source}:${i.id}`)

  it('lists the unfinished tasks and live delivery dates in the range, by date', () => {
    expect(ids(calendarItems(tasks, projects, '2026-11-01', '2026-11-30', tags))).toEqual([
      'task:report',
      'task:both',
      'task:loose',
      'project:thesis',
    ])
  })

  it('asks by date range, including both ends', () => {
    expect(ids(calendarItems(tasks, projects, '2026-11-05', '2026-11-08', tags))).toEqual(['task:report', 'task:both'])
    expect(calendarItems(tasks, projects, '2027-01-01', '2027-01-31', tags)).toEqual([])
  })

  it('makes a task an all-day item linking to its page, that cannot be moved yet', () => {
    expect(taskToItems(tasks[0]!, { projects, tags })).toEqual([
      {
        id: 'report',
        source: 'task',
        title: 'report',
        date: '2026-11-05',
        editable: false,
        colour: '#17646a',
        link: '/tasks/report',
        tagIds: ['work', 'school'],
      },
    ])
    expect(taskToItems(task('a/b', { dueDate: '2026-11-05' }), { projects, tags })[0]!.link).toBe('/tasks/a%2Fb')
  })

  it("colours a task by the first tag of the first live project it's in", () => {
    const colours = Object.fromEntries(calendarItems(tasks, projects, '2026-11-01', '2026-11-30', tags).map((i) => [i.id, i.colour]))
    expect(colours.report).toBe('#17646a') // Work, Thesis's first tag
    expect(colours.both).toBe(NEUTRAL_COLOUR) // its first project is archived, and Gym has no tags
    expect(colours.loose).toBe(NEUTRAL_COLOUR) // in no project
  })

  it("colours a delivery date by its project's first tag, leaving out archived and undated projects", () => {
    const context = { projects, tags }
    expect(projectToItems(projects[0]!, context)).toEqual([
      {
        id: 'thesis',
        source: 'project',
        title: 'thesis',
        date: '2026-11-20',
        editable: false,
        colour: '#17646a',
        link: '/projects/thesis',
        tagIds: ['work', 'school'],
      },
    ])
    expect(projectToItems(projects[1]!, context)).toEqual([]) // archived
    expect(projectToItems(projects[2]!, context)).toEqual([]) // no delivery date
  })

  it("filters by the tags of a task's live projects, or a project's own", () => {
    const items = calendarItems(tasks, projects, '2026-11-01', '2026-11-30', tags)
    const shown = (selected: string[]) => ids(items.filter((i) => matchesTags(i.tagIds, selected)))
    expect(shown([])).toEqual(['task:report', 'task:both', 'task:loose', 'project:thesis'])
    expect(shown(['school'])).toEqual(['task:report', 'project:thesis']) // not "both": Old is archived
    expect(shown([NO_TAG])).toEqual(['task:both', 'task:loose'])
  })

  it('lists the unfinished undated tasks for the tray, leaving out those only in archived projects', () => {
    const extra = [task('undated done', { completed: true }), task('undated archived')]
    const withOld = [...projects, project('older', { tagIds: [ARCHIVE_TAG_ID], taskIds: ['undated archived'] })]
    expect(undatedTasks([...tasks, ...extra], withOld).map((t) => t.id)).toEqual(['undated'])
  })
})

describe('calendar days', () => {
  it('puts all-day items first (delivery dates, then by title), then timed ones by start', () => {
    const items = [
      item('timed late', { start: '2026-11-05T15:00:00+08:00' }),
      item('b task'),
      item('timed early', { start: '2026-11-05T09:00:00+08:00' }),
      item('a task'),
      item('delivery', { source: 'project' }),
    ]
    expect(items.sort(withinDay).map((i) => i.id)).toEqual(['delivery', 'a task', 'b task', 'timed early', 'timed late'])
  })

  it('groups items by date within a range, in day order', () => {
    const byDate = itemsByDate(
      [item('b', { date: '2026-11-05' }), item('a', { date: '2026-11-05' }), item('c', { date: '2026-11-06' }), item('out', { date: '2026-12-01' })],
      '2026-11-01',
      '2026-11-30',
    )
    expect([...byDate].map(([date, items]) => [date, items.map((i) => i.id)])).toEqual([
      ['2026-11-05', ['a', 'b']],
      ['2026-11-06', ['c']],
    ])
  })

  it('counts an item overdue once its date has passed', () => {
    expect(isOverdue(item('t', { date: '2026-11-04' }), '2026-11-05')).toBe(true)
    expect(isOverdue(item('t', { date: '2026-11-05' }), '2026-11-05')).toBe(false)
  })
})

describe('calendar colours', () => {
  it("reads a tag's colour, and falls back to neutral grey without a usable one", () => {
    expect(tagColour({ id: 'w', name: 'Work', color: '#17646a' })).toBe('#17646a')
    expect(tagColour(undefined)).toBe(NEUTRAL_COLOUR)
    expect(tagColour({ id: 'w', name: 'Work', color: 'indigo' })).toBe(NEUTRAL_COLOUR)
    expect(NEUTRAL_COLOUR).toBe('#5c636b')
  })

  it('gives chips whichever text colour contrasts more with their fill', () => {
    expect(textColorOn(NEUTRAL_COLOUR)).toBe('#faefe0') // cream on the grey
    expect(textColorOn('#17646a')).toBe('#faefe0')
    expect(textColorOn('#f5d76e')).toBe('#204030') // forest green on a light yellow
  })
})
