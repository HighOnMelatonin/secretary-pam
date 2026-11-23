// Errands (src/types/errand.ts): recurrence, rollover, and how they stay out of Upcoming and
// Suggested while the forecast takes their hours out of their days first
import { describe, it, expect } from 'vitest'
import {
  errandDay,
  errandDays,
  isOnToday,
  nextErrand,
  nextOccurrence,
  parseRecurrence,
  type Recurrence,
} from '../types/errand'
import { forecast } from '../types/forecast'
import { planTaskSave, ErrandRefused, type State } from '../types/operations'
import { prioritise } from '../types/priority'
import { createEmptyProject } from '../types/project'
import { DEFAULT_SETTINGS } from '../types/settings'
import { createEmptyTask, type Task } from '../types/task'
import { upcomingTasks } from '../types/upcoming'

// Monday. The default capacity is 8 hours Monday to Friday.
const MON = '2026-11-16'
const TUE = '2026-11-17'

const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id, name: `Task ${id}`, ...fields })
const errand = (id: string, fields: Partial<Task> = {}): Task => task(id, { kind: 'errand', pinnedDate: MON, ...fields })

describe('parseRecurrence', () => {
  it('reads each format', () => {
    expect(parseRecurrence('daily')).toEqual({ every: 'day' })
    expect(parseRecurrence('every:1d')).toEqual({ every: 'days', days: 1 })
    expect(parseRecurrence('every:365d')).toEqual({ every: 'days', days: 365 })
    // In week order, whatever order they're written in
    expect(parseRecurrence('weekly:SAT,MON')).toEqual({ every: 'week', days: ['mon', 'sat'] })
  })

  it.each(['', 'Daily', 'weekly', 'weekly:', 'weekly:MON,MON', 'weekly:mon', 'weekly:MON,', 'weekly:XYZ', 'every:0d', 'every:366d', 'every:3', 'every:-1d', 'every:01d', ' daily'])(
    'refuses %j',
    (text) => expect(parseRecurrence(text)).toBeNull(),
  )
})

describe('nextOccurrence', () => {
  const rule = (text: string) => parseRecurrence(text) as Recurrence

  it('is the next day the rule falls on, after the one given', () => {
    expect(nextOccurrence(rule('daily'), MON)).toBe(TUE)
    expect(nextOccurrence(rule('every:3d'), MON)).toBe('2026-11-19')
    // From Monday, the next Saturday; from Saturday, the next Monday; never the same day
    expect(nextOccurrence(rule('weekly:MON,SAT'), MON)).toBe('2026-11-21')
    expect(nextOccurrence(rule('weekly:MON,SAT'), '2026-11-21')).toBe('2026-11-23')
    expect(nextOccurrence(rule('weekly:MON'), MON)).toBe('2026-11-23')
  })

  it('crosses month and year ends', () => {
    expect(nextOccurrence(rule('daily'), '2026-11-30')).toBe('2026-12-01')
    expect(nextOccurrence(rule('every:10d'), '2026-12-25')).toBe('2027-01-04')
    // 2026-12-31 is a Thursday
    expect(nextOccurrence(rule('weekly:MON'), '2026-12-31')).toBe('2027-01-04')
    expect(nextOccurrence(rule('every:1d'), '2028-02-28')).toBe('2028-02-29')
  })
})

describe('nextErrand', () => {
  const done = errand('a', {
    name: 'Groceries',
    description: 'The usual',
    completed: true,
    recurrence: 'weekly:MON,SAT',
    effortMinutes: 45,
    tagIds: ['personal'],
    pinnedDate: '2026-11-30',
    dueDate: '2026-12-02',
    checklist: [
      { text: 'Milk', done: true },
      { text: 'Eggs', done: false },
    ],
    nextOccurrenceId: 'old',
  })

  it('copies it, unticked, onto the next day, moving the due date by the same gap', () => {
    expect(nextErrand(done, 'b')).toEqual({
      id: 'b',
      name: 'Groceries',
      description: 'The usual',
      dueDate: '2026-12-07', // 2026-11-30 is a Monday, so the next is Saturday 12-05: 5 days on
      relations: [],
      priority: 'medium',
      completed: false,
      kind: 'errand',
      recurrence: 'weekly:MON,SAT',
      pinnedDate: '2026-12-05',
      effortMinutes: 45,
      tagIds: ['personal'],
      checklist: [
        { text: 'Milk', done: false },
        { text: 'Eggs', done: false },
      ],
    })
  })

  it('leaves out what the completed one has none of', () => {
    const plain = errand('a', { completed: true, recurrence: 'daily', pinnedDate: '2026-11-30' })
    expect(nextErrand(plain, 'b')).toEqual({
      ...createEmptyTask(),
      id: 'b',
      name: 'Task a',
      kind: 'errand',
      recurrence: 'daily',
      pinnedDate: '2026-12-01',
    })
  })

  it('is null for one that does not repeat, and for a project task', () => {
    expect(nextErrand(errand('a'), 'b')).toBeNull()
    expect(nextErrand(task('a', { recurrence: 'daily', pinnedDate: MON }), 'b')).toBeNull()
  })
})

describe('rollover', () => {
  it('counts an unfinished errand planned for a past day as planned for today, with the days carried', () => {
    expect(errandDay(errand('a', { pinnedDate: '2026-11-14' }), MON)).toMatchObject({ planned: MON, carriedDays: 2, overdue: false })
    expect(errandDay(errand('a', { pinnedDate: MON }), MON)).toMatchObject({ planned: MON, carriedDays: 0 })
    expect(errandDay(errand('a', { pinnedDate: TUE }), MON)).toMatchObject({ planned: TUE, carriedDays: 0 })
    // Nothing is stored: the errand keeps the day it was planned for
    const old = errand('a', { pinnedDate: '2026-11-14' })
    errandDay(old, MON)
    expect(old.pinnedDate).toBe('2026-11-14')
  })

  it('is overdue once its due date has passed, as a task is', () => {
    expect(errandDay(errand('a', { pinnedDate: '2026-11-10', dueDate: '2026-11-13' }), MON)!.overdue).toBe(true)
    expect(errandDay(errand('a', { pinnedDate: '2026-11-10', dueDate: MON }), MON)!.overdue).toBe(false)
  })

  it('leaves out completed errands and project tasks', () => {
    expect(errandDay(errand('a', { completed: true }), MON)).toBeNull()
    expect(errandDay(task('a', { pinnedDate: MON }), MON)).toBeNull()
  })

  it("rolls errands over onto today's list, but lets a project task's pin from yesterday lapse", () => {
    expect(isOnToday(errand('a', { pinnedDate: '2026-11-15' }), MON)).toBe(true)
    expect(isOnToday(errand('a', { pinnedDate: TUE }), MON)).toBe(false)
    expect(isOnToday(task('a', { pinnedDate: MON }), MON)).toBe(true)
    expect(isOnToday(task('a', { pinnedDate: '2026-11-15' }), MON)).toBe(false)
    expect(isOnToday(task('a', { pinnedDate: MON, completed: true }), MON)).toBe(false)
  })

  it('lists errands by planned day, then those carried longest, then by name', () => {
    const days = errandDays(
      [errand('b', { pinnedDate: '2026-11-15' }), errand('c', { pinnedDate: TUE }), errand('a', { pinnedDate: '2026-11-12' }), task('t')],
      MON,
    )
    expect(days.map((d) => [d.task.id, d.planned, d.carriedDays])).toEqual([
      ['a', MON, 4],
      ['b', MON, 1],
      ['c', TUE, 0],
    ])
  })
})

describe('errands outside Upcoming and Suggested', () => {
  const tasks = [errand('e', { dueDate: MON }), task('t', { dueDate: MON })]

  it('never lists an errand in Upcoming', () => {
    const { overdue, upcoming } = upcomingTasks([...tasks, errand('old', { pinnedDate: '2026-11-10', dueDate: '2026-11-12' })], [], MON)
    expect([...overdue, ...upcoming].map((u) => u.task.id)).toEqual(['t'])
  })

  it('never ranks an errand, so it never takes a place in Suggested', () => {
    expect(prioritise(tasks, [], DEFAULT_SETTINGS, MON).tasks.map((t) => t.taskId)).toEqual(['t'])
  })
})

describe('errands in the forecast', () => {
  const hours = (h: number) => h * 60

  it("takes each errand's hours out of its planned day before planning scored tasks", () => {
    const result = forecast(
      [
        task('t', { priority: 'urgent', effortMinutes: hours(10) }),
        errand('e1', { effortMinutes: hours(1.5) }),
        errand('e2', { pinnedDate: TUE }), // no estimate: 30 minutes
      ],
      [],
      DEFAULT_SETTINGS,
      MON,
    )
    expect(result.days.slice(0, 2).map((d) => [d.plannedHours, d.errandHours])).toEqual([
      [6.5, 1.5],
      [3.5, 0.5],
    ])
    expect(result.tasks.map((t) => t.taskId)).toEqual(['t'])
    expect(result.todayPlan).toEqual([{ taskId: 't', name: 'Task t', hours: 6.5, finishes: false }])
    expect(result.todayErrands).toEqual([{ taskId: 'e1', name: 'Task e1', hours: 1.5, carriedDays: 0 }])
    expect(result.totals).toMatchObject({ hours: 10, errandHours: 2 })
    expect(result.brief.parts[0]!.text).toBe('Today: 1 task, 6.5 h of 8 h, and 1.5 h of errands.')
  })

  it('counts rolled-over errands out of today', () => {
    const result = forecast([errand('e', { pinnedDate: '2026-11-13', effortMinutes: 60 })], [], DEFAULT_SETTINGS, MON)
    expect(result.days[0]!.errandHours).toBe(1)
    expect(result.todayErrands).toEqual([{ taskId: 'e', name: 'Task e', hours: 1, carriedDays: 3 }])
    expect(result.brief.parts[0]!.text).toBe('Today: 1 h of errands.')
  })

  it("leaves a day with no room for tasks when its errands fill it, and says it's overbooked", () => {
    const result = forecast([task('t', { effortMinutes: 60 }), errand('e', { effortMinutes: hours(9) })], [], DEFAULT_SETTINGS, MON)
    expect(result.days[0]).toMatchObject({ plannedHours: 0, errandHours: 9, overbooked: true })
    expect(result.tasks[0]!.start).toBe(TUE)
  })

  it('reads as before when there are no errands', () => {
    const result = forecast([task('t', { effortMinutes: 60 })], [], DEFAULT_SETTINGS, MON)
    expect(result.brief.parts[0]!.text).toBe('Today: 1 task, 1 h of 8 h.')
    expect(result.totals.errandHours).toBe(0)
  })
})

describe('planning an errand save', () => {
  const state = (tasks: Task[] = [], projects = [createEmptyProject()]): State => ({ tasks, projects })
  const refusal = (run: () => unknown) => {
    try {
      run()
    } catch (e) {
      if (e instanceof ErrandRefused) return e.sentence.code
      throw e
    }
    return null
  }

  it('plans an errand with no planned day for today, at the default priority', () => {
    const plan = planTaskSave(state(), { task: task('e', { kind: 'errand', priority: 'urgent' }), today: MON })
    expect(plan.ok && plan.changes.tasks).toEqual([task('e', { kind: 'errand', pinnedDate: MON, priority: 'medium' })])
  })

  it('refuses an errand in a project, related to a task, with no planned day, or planned after its due date', () => {
    const p = { ...createEmptyProject(), id: 'p', name: 'P' }
    expect(refusal(() => planTaskSave(state([], [p]), { task: errand('e'), projectIds: ['p'] }))).toBe('errand_in_project')
    expect(refusal(() => planTaskSave(state([task('t')]), { task: errand('e', { relations: [{ taskId: 't', type: 'blocks' }] }) }))).toBe(
      'errand_related',
    )
    // Relating a task to an errand is refused too
    expect(refusal(() => planTaskSave(state([errand('e')]), { task: task('t', { relations: [{ taskId: 'e', type: 'blocks' }] }) }))).toBe(
      'errand_related',
    )
    expect(refusal(() => planTaskSave(state(), { task: task('e', { kind: 'errand' }) }))).toBe('errand_unplanned')
    expect(refusal(() => planTaskSave(state(), { task: errand('e', { pinnedDate: TUE, dueDate: MON }) }))).toBe('errand_planned_after_due')
    expect(refusal(() => planTaskSave(state(), { task: errand('e', { pinnedDate: MON, dueDate: MON }) }))).toBeNull()
  })

  it('makes the next errand once when a recurring one is completed, and keeps it when reopened', () => {
    const open = errand('e', { recurrence: 'daily' })
    const first = planTaskSave(state([open]), { task: { ...open, completed: true } }, 'app', () => 'next')
    expect(first.ok && first.changes.tasks.map((t) => [t.id, t.completed, t.pinnedDate, t.nextOccurrenceId])).toEqual([
      ['e', true, MON, 'next'],
      ['next', false, TUE, undefined],
    ])
    const done = first.ok ? first.changes.tasks : []
    // Reopened: the next one stays, and the reopened one still knows it
    const reopened = planTaskSave(state(done), { task: { ...open, completed: false } })
    expect(reopened.ok && reopened.changes.tasks.map((t) => [t.id, t.nextOccurrenceId])).toEqual([['e', 'next']])
    const again = planTaskSave(state(reopened.ok ? [reopened.changes.tasks[0]!, done[1]!] : []), { task: { ...open, completed: true } })
    expect(again.ok && again.changes.tasks.map((t) => t.id)).toEqual(['e'])
  })
})

describe('the Today list', () => {
  it("has today's pinned project tasks and today's errands, but not a lapsed pin or a task only in archived projects", async () => {
    const { todayItems, inNoProject } = await import('../types/today')
    const { ARCHIVE_TAG_ID } = await import('../types/tag')
    const live = { ...createEmptyProject(), id: 'p', name: 'Live', taskIds: ['a'] }
    const archived = { ...createEmptyProject(), id: 'q', name: 'Old', taskIds: ['old'], tagIds: [ARCHIVE_TAG_ID] }
    const items = todayItems(
      [
        task('a', { pinnedDate: MON, dueDate: '2026-11-10' }),
        task('lapsed', { pinnedDate: '2026-11-15' }),
        task('old', { pinnedDate: MON }),
        task('b', { pinnedDate: MON }),
        errand('e', { pinnedDate: '2026-11-13' }),
        errand('later', { pinnedDate: TUE }),
      ],
      [live, archived],
      MON,
    )
    expect(items.map((i) => [i.task.id, i.projects.map((p) => p.id), i.carriedDays, i.overdue])).toEqual([
      ['a', ['p'], 0, true],
      ['b', [], 0, false],
      ['e', [], 3, false],
    ])
    expect(items.filter(inNoProject).map((i) => i.task.id)).toEqual(['b', 'e'])
  })
})

describe('errands on the calendar', () => {
  it('puts an errand on its planned day, a rolled-over one on today, and none in the undated tray', async () => {
    const { calendarItems, undatedTasks } = await import('../types/calendar')
    const tasks = [errand('soon', { pinnedDate: TUE, dueDate: '2026-11-20' }), errand('late', { pinnedDate: '2026-11-10' }), task('t', { dueDate: TUE })]
    const items = calendarItems(tasks, [], '2026-11-01', '2026-11-30', [], MON)
    expect(items.map((i) => [i.id, i.date, i.errand ?? false])).toEqual([
      ['late', MON, true],
      ['soon', TUE, true],
      ['t', TUE, false],
    ])
    expect(undatedTasks([errand('x', { dueDate: null })], [])).toEqual([])
    // Completed errands are hidden, as completed tasks are
    expect(calendarItems([errand('done', { completed: true })], [], '2026-11-01', '2026-11-30', [], MON)).toEqual([])
  })
})
