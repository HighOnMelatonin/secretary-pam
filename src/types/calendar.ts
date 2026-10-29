// What the calendar shows: tasks on their due dates and projects on their delivery dates, as
// CalendarItems from one adapter per source. A Google Calendar adapter can be added beside the
// two here, so items are always asked for by date range, the one way Google can be queried.
// Every date is a local YYYY-MM-DD, as elsewhere in the app.
import { isArchived, type Project } from './project'
import { ARCHIVE_TAG_ID, isHexColor, NO_TAG, type Tag } from './tag'
import type { Task } from './task'
import { addDays } from './upcoming'

export type CalendarSource = 'task' | 'project' | 'google'

export interface CalendarItem {
  id: string // the task's, project's or event's own id, unique within its source
  source: CalendarSource
  title: string
  date: string // YYYY-MM-DD it falls on (the first, once items can span days); all-day unless start is set
  start?: string // ISO datetime, for timed events
  end?: string // ISO datetime, for timed events
  editable: boolean // whether it can be moved to another date; nothing can be yet
  colour: string // #rrggbb fill, from tagColour
  link: string // the app path of its page, e.g. /tasks/abc
  tagIds: string[] // what the tag filter matches against; none for an untagged item
}

// Loading and error state for each source, so one that fails leaves the others on the calendar
export interface SourceState {
  loading: boolean
  error: string | null
}

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6 // 0 is Sunday, as Date.getDay

// Dates

// Today's date in this browser's time zone
export const localToday = () => new Date().toLocaleDateString('en-CA')

// The local date an ISO datetime falls on. One with an offset ("2026-11-02T01:00:00+08:00") is
// converted to this browser's time zone first, so a timed event lands on the day it happens here.
export const localDateOf = (dateTime: string) => new Date(dateTime).toLocaleDateString('en-CA')

const parts = (date: string) => date.split('-').map(Number) as [number, number, number]

// 0 (Sunday) to 6, worked out in UTC so the browser's time zone can't shift the day
export const weekdayOf = (date: string): Weekday => {
  const [year, month, day] = parts(date)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() as Weekday
}

// The month (YYYY-MM) in a ?month= query, or null if it isn't one
export function parseMonth(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return null
  const month = Number(value.slice(5))
  return month >= 1 && month <= 12 ? value : null
}

export const monthOf = (date: string) => date.slice(0, 7)

// The month `count` months after `month` (negative for before)
export function addMonths(month: string, count: number) {
  const [year, m] = parts(month)
  return new Date(Date.UTC(year, m - 1 + count, 1)).toISOString().slice(0, 7)
}

export function lastDateOf(month: string) {
  const [year, m] = parts(month)
  return `${month}-${String(new Date(Date.UTC(year, m, 0)).getUTCDate()).padStart(2, '0')}`
}

// "November 2026"
export function monthLabel(month: string) {
  const [year, m] = parts(month)
  return new Date(Date.UTC(year, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export interface GridDay {
  date: string
  inMonth: boolean // false for the days of the months before and after that fill the first and last weeks
}

// The weeks shown for a month, each starting on weekStart: from the week holding the 1st to the
// week holding the last day, so 4 to 6 weeks
export function monthGrid(month: string, weekStart: Weekday): GridDay[][] {
  const first = `${month}-01`
  const last = lastDateOf(month)
  let date = addDays(first, -((weekdayOf(first) - weekStart + 7) % 7))
  const end = addDays(last, (weekStart + 6 - weekdayOf(last)) % 7)

  const weeks: GridDay[][] = []
  while (date <= end) {
    const week: GridDay[] = []
    for (let i = 0; i < 7; i++) {
      week.push({ date, inMonth: monthOf(date) === month })
      date = addDays(date, 1)
    }
    weeks.push(week)
  }
  return weeks
}

// The last date an item covers. Today every item is on one date. A Google all-day event spanning
// days will end the day before its end date, which Google gives as exclusive.
export const finalDateOf = (item: CalendarItem) => item.date

// Each date in from..to (inclusive) with the items on it, in the order they show within a day
export function itemsByDate(items: CalendarItem[], from: string, to: string) {
  const byDate = new Map<string, CalendarItem[]>()
  for (const item of items) {
    for (let date = item.date < from ? from : item.date; date <= finalDateOf(item) && date <= to; date = addDays(date, 1)) {
      byDate.set(date, [...(byDate.get(date) ?? []), item])
    }
  }
  for (const dayItems of byDate.values()) dayItems.sort(withinDay)
  return byDate
}

// All-day items first (delivery dates before tasks, then by title), then timed ones by start
export function withinDay(a: CalendarItem, b: CalendarItem) {
  if (!a.start !== !b.start) return a.start ? 1 : -1
  if (a.start && b.start && a.start !== b.start) return a.start.localeCompare(b.start)
  if (a.source !== b.source) return a.source === 'project' ? -1 : b.source === 'project' ? 1 : 0
  return a.title.localeCompare(b.title)
}

// Past its date. Completed tasks and archived projects never become items, so anything past is
// still to be done, as on a project's timeline.
export const isOverdue = (item: CalendarItem, today: string) => finalDateOf(item) < today

// Colours

// For items with no tag, and tags whose colour isn't a #rrggbb code. Cream text on it reads at 5.4 : 1.
export const NEUTRAL_COLOUR = '#5c636b'

// The one place the calendar reads a tag's colour
export const tagColour = (tag: Tag | undefined) => (tag && isHexColor(tag.color) ? tag.color : NEUTRAL_COLOUR)

// Adapters

export interface AdapterContext {
  projects: Project[]
  tags: Tag[]
}

const liveProjectsOf = (task: Task, projects: Project[]) =>
  projects.filter((p) => !isArchived(p) && p.taskIds.includes(task.id))

const ownTagIds = (project: Project) => project.tagIds.filter((id) => id !== ARCHIVE_TAG_ID)

// The tags of the live projects a task is in, for the tag filter
export const taskTagIds = (task: Task, projects: Project[]) => [
  ...new Set(liveProjectsOf(task, projects).flatMap(ownTagIds)),
]

// Whether a task belongs on the calendar at all: unfinished, and not only in archived projects
export function isShownTask(task: Task, projects: Project[]) {
  if (task.completed) return false
  const inProjects = projects.filter((p) => p.taskIds.includes(task.id))
  return inProjects.length === 0 || inProjects.some((p) => !isArchived(p))
}

// Its first tag, other than Archive, coloured by tagColour
const colourOf = (project: Project | undefined, tags: Tag[]) =>
  tagColour(project && tags.find((t) => t.id === ownTagIds(project)[0]))

// A task on its due date, coloured by the first tag of the first live project it is in
export function taskToItems(task: Task, { projects, tags }: AdapterContext): CalendarItem[] {
  if (!task.dueDate || !isShownTask(task, projects)) return []
  return [
    {
      id: task.id,
      source: 'task',
      title: task.name,
      date: task.dueDate,
      editable: false,
      colour: colourOf(liveProjectsOf(task, projects)[0], tags),
      link: `/tasks/${encodeURIComponent(task.id)}`,
      tagIds: taskTagIds(task, projects),
    },
  ]
}

// A live project on its delivery date, coloured by its first tag
export function projectToItems(project: Project, { tags }: AdapterContext): CalendarItem[] {
  if (!project.deliveryDate || isArchived(project)) return []
  return [
    {
      id: project.id,
      source: 'project',
      title: project.name,
      date: project.deliveryDate,
      editable: false,
      colour: colourOf(project, tags),
      link: `/projects/${encodeURIComponent(project.id)}`,
      tagIds: ownTagIds(project),
    },
  ]
}

// Every item on a date from `from` to `to` (inclusive), sorted by date then as within a day
export function calendarItems(tasks: Task[], projects: Project[], from: string, to: string, tags: Tag[] = []) {
  const context = { projects, tags }
  return [...tasks.flatMap((t) => taskToItems(t, context)), ...projects.flatMap((p) => projectToItems(p, context))]
    .filter((item) => item.date <= to && finalDateOf(item) >= from)
    .sort((a, b) => a.date.localeCompare(b.date) || withinDay(a, b))
}

// The unfinished tasks with no due date, for the tray below the grid
export const undatedTasks = (tasks: Task[], projects: Project[]) =>
  tasks.filter((t) => !t.dueDate && isShownTask(t, projects))

// Whether the tag filter lets something through: anything when no tag is chosen, otherwise
// anything with one of the chosen tags, and untagged things when "No tag" is chosen
export const matchesTags = (tagIds: string[], selected: string[]) =>
  selected.length === 0 || (tagIds.length === 0 ? selected.includes(NO_TAG) : tagIds.some((id) => selected.includes(id)))
