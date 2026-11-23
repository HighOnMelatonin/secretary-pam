// Errands (README, "Errands"): small personal to-dos in no project, like groceries or paying a bill.
// They are tasks with kind 'errand', where pinnedDate is the day it's planned for and dueDate its
// deadline, if it has one. An unfinished errand planned for a day that has passed rolls over to
// today; a pinned project task doesn't, and its pin simply lapses, which keeps time pressure on
// project work.
//
// Pure functions over plain data only: no Vue, no browser APIs, no clock and relative imports only,
// since worker/ and the bot import this file too. `today` is always passed in, and nothing worked
// out here is stored (docs/priority-algorithm.md): a rolled-over errand keeps the planned day it
// was given, and is only read as today's.
// Not from settings.ts, which imports calendar.ts, which shows errands: dates are worked out here
import type { Task } from './task'
import { addDays } from './upcoming'

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
type WeekdayKey = (typeof WEEKDAYS)[number]

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000
// Days from `from` to `to`; negative when `to` is earlier
const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from)
// 1970-01-01 was a Thursday
const weekdayKeyOf = (date: string): WeekdayKey => WEEKDAYS[(((dayNumber(date) + 3) % 7) + 7) % 7]!

// An errand with no estimate counts as this much, not the 2 hours a project task does, and is
// flagged as unestimated
export const ERRAND_DEFAULT_MINUTES = 30

// The longest every:Nd can be, so a typo like every:3000d is refused rather than kept
export const MAX_EVERY_DAYS = 365

export const isErrand = (task: Pick<Task, 'kind'>) => task.kind === 'errand'

// Recurrence

export type Recurrence =
  | { every: 'day' }
  | { every: 'week'; days: WeekdayKey[] } // in the order they come in the week, from Monday
  | { every: 'days'; days: number }

// What the Worker says when recurrence isn't one of these
export const RECURRENCE_FORMATS = `daily, weekly: and days from MON to SUN separated by commas (e.g. weekly:MON,SAT), or every:Nd with N from 1 to ${MAX_EVERY_DAYS} (e.g. every:3d)`

// The rule recurrence is written as, or null when it isn't one of the formats. Day names are in
// capitals, each at most once, in any order.
export function parseRecurrence(text: string): Recurrence | null {
  if (text === 'daily') return { every: 'day' }
  const every = /^every:([1-9]\d{0,2})d$/.exec(text)
  if (every) {
    const days = Number(every[1])
    return days <= MAX_EVERY_DAYS ? { every: 'days', days } : null
  }
  const weekly = /^weekly:([A-Z]{3}(?:,[A-Z]{3})*)$/.exec(text)
  if (!weekly) return null
  const names = weekly[1]!.toLowerCase().split(',')
  if (new Set(names).size !== names.length || !names.every((n) => (WEEKDAYS as readonly string[]).includes(n))) return null
  return { every: 'week', days: WEEKDAYS.filter((d) => names.includes(d)) }
}

const DAY_LABELS: Record<WeekdayKey, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' }

// The rule in words, e.g. "Every day", "Every Mon and Sat", "Every 3 days"; the text itself if it
// isn't one of the formats
export function recurrenceLabel(text: string): string {
  const rule = parseRecurrence(text)
  if (!rule) return text
  if (rule.every === 'day') return 'Every day'
  if (rule.every === 'days') return rule.days === 1 ? 'Every day' : `Every ${rule.days} days`
  const names = rule.days.map((d) => DAY_LABELS[d])
  return `Every ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`}`
}

// The rule written as recurrence: the inverse of parseRecurrence
export function formatRecurrence(rule: Recurrence): string {
  if (rule.every === 'day') return 'daily'
  if (rule.every === 'days') return `every:${rule.days}d`
  return `weekly:${rule.days.map((d) => d.toUpperCase()).join(',')}`
}

export { WEEKDAYS as RECURRENCE_DAYS, DAY_LABELS as RECURRENCE_DAY_LABELS }
export type { WeekdayKey as RecurrenceDay }

// e.g. "planned yesterday", "planned 3 days ago"; null for one planned for today or later
export const carriedLabel = (days: number) => (days <= 0 ? null : days === 1 ? 'planned yesterday' : `planned ${days} days ago`)

// The first day after `after` the rule falls on
export function nextOccurrence(rule: Recurrence, after: string): string {
  switch (rule.every) {
    case 'day':
      return addDays(after, 1)
    case 'days':
      return addDays(after, rule.days)
    case 'week': {
      let day = addDays(after, 1)
      while (!rule.days.includes(weekdayKeyOf(day))) day = addDays(day, 1)
      return day
    }
  }
}

// The errand that follows a recurring one when it's completed: the same name, description, effort,
// recurrence and tags, with its checklist unticked, planned for the rule's next day after the
// completed one's planned day. Its due date, if it has one, moves on by the same number of days, so
// it stays as far after the planned day as it was. `id` is the new errand's. Null for a task that
// doesn't repeat, or has no planned day to count from.
export function nextErrand(done: Task, id: string): Task | null {
  const rule = isErrand(done) && done.recurrence !== undefined ? parseRecurrence(done.recurrence) : null
  if (!rule || done.pinnedDate === undefined) return null
  const planned = nextOccurrence(rule, done.pinnedDate)
  const gap = daysBetween(done.pinnedDate, planned)
  return {
    id,
    name: done.name,
    description: done.description,
    dueDate: done.dueDate === null ? null : addDays(done.dueDate, gap),
    relations: [],
    priority: done.priority,
    completed: false,
    kind: 'errand',
    recurrence: done.recurrence,
    pinnedDate: planned,
    ...(done.effortMinutes !== undefined ? { effortMinutes: done.effortMinutes } : {}),
    ...(done.tagIds?.length ? { tagIds: [...done.tagIds] } : {}),
    ...(done.checklist?.length ? { checklist: done.checklist.map((item) => ({ text: item.text, done: false })) } : {}),
  }
}

// Rollover

export interface ErrandDay {
  task: Task
  planned: string // the day it counts as planned for: today if its planned day has passed
  carriedDays: number // how many days it has rolled over by; 0 when planned for today or later
  overdue: boolean // its due date has passed
}

// Where an unfinished errand stands on `today`, or null for a completed errand, a project task, or
// an errand with no planned day (which the Worker never saves)
export function errandDay(task: Task, today: string): ErrandDay | null {
  if (!isErrand(task) || task.completed || task.pinnedDate === undefined) return null
  const carriedDays = Math.max(0, daysBetween(task.pinnedDate, today))
  return {
    task,
    planned: carriedDays > 0 ? today : task.pinnedDate,
    carriedDays,
    overdue: task.dueDate !== null && task.dueDate < today,
  }
}

// Whether a task is on today's list: a project task pinned to today with "Do today" (a pin from an
// earlier day has lapsed), or an errand planned for today or rolled over to it
export function isOnToday(task: Task, today: string): boolean {
  if (task.completed) return false
  if (!isErrand(task)) return task.pinnedDate === today
  return errandDay(task, today)!.planned === today
}

// Every unfinished errand counted on the day it's planned for, rolled-over ones on today, soonest
// first, then those carried longest, then by name
export function errandDays(tasks: Task[], today: string): ErrandDay[] {
  return tasks
    .map((t) => errandDay(t, today))
    .filter((d): d is ErrandDay => d !== null)
    .sort((a, b) => a.planned.localeCompare(b.planned) || b.carriedDays - a.carriedDays || a.task.name.localeCompare(b.task.name))
}

// An errand's estimate in hours, or the default's
export const errandHours = (task: Pick<Task, 'effortMinutes'>) => (task.effortMinutes ?? ERRAND_DEFAULT_MINUTES) / 60
