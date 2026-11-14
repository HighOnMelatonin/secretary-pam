// Each user's settings for prioritisation (docs/priority-algorithm.md): how many minutes they have
// for tasks on each weekday, and the weights the scoring uses. Stored in user_settings and read
// and saved through GET and PUT /api/settings. Pure functions over plain data only: no Vue, no
// browser APIs and relative imports only, since worker/ imports this file too.
import { weekdayOf } from './calendar'
import { addDays } from './upcoming'

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type WeekdayKey = (typeof WEEKDAYS)[number]

export const PRESET_NAMES = ['balanced', 'deadline', 'importance', 'blockers'] as const
export type PresetName = (typeof PRESET_NAMES)[number]

export interface Weights {
  wU: number // weight of urgency against importance
  k: number // weight of the work a task unblocks
  horizonDays: number // working days ahead that a task due soon gets a lift
}

export interface UserSettings extends Weights {
  capacityMinutes: Record<WeekdayKey, number> // minutes available for tasks, 0 to 1,440
  buffer: number // every estimate is multiplied by this
  preset: PresetName // the preset the weights were last set from
}

export const PRESETS: Record<PresetName, Weights & { label: string }> = {
  balanced: { label: 'Balanced', wU: 1, k: 1, horizonDays: 2 },
  deadline: { label: 'Deadline-driven', wU: 2, k: 0.5, horizonDays: 3 },
  importance: { label: 'Importance-driven', wU: 0.5, k: 0.5, horizonDays: 1 },
  blockers: { label: 'Blockers-first', wU: 1, k: 2, horizonDays: 2 },
}

// The settings with a preset chosen: its name and its weights, everything else as it was
export function applyPreset(settings: UserSettings, preset: PresetName): UserSettings {
  const { wU, k, horizonDays } = PRESETS[preset]
  return { ...settings, preset, wU, k, horizonDays }
}

// Whether the weights are the named preset's, as they always are when set through a preset
export const matchesPreset = (settings: Weights & { preset: PresetName }) => {
  const { wU, k, horizonDays } = PRESETS[settings.preset]
  return settings.wU === wU && settings.k === k && settings.horizonDays === horizonDays
}

// What a user has until they save settings of their own; the same as user_settings' defaults
export const DEFAULT_SETTINGS: UserSettings = {
  capacityMinutes: { mon: 480, tue: 480, wed: 480, thu: 480, fri: 480, sat: 0, sun: 0 },
  buffer: 1,
  wU: 1,
  k: 1,
  horizonDays: 2,
  preset: 'balanced',
}

// Capacity

// weekdayOf counts from Sunday, as Date.getDay does
const BY_DAY_NUMBER: WeekdayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export const weekdayKeyOf = (date: string): WeekdayKey => BY_DAY_NUMBER[weekdayOf(date)]!

// Minutes available for tasks on the YYYY-MM-DD date
export const capacityOn = (capacity: UserSettings['capacityMinutes'], date: string) => capacity[weekdayKeyOf(date)]

// A working day has some capacity
export const isWorkingDay = (capacity: UserSettings['capacityMinutes'], date: string) => capacityOn(capacity, date) > 0

const dayNumber = (date: string) => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  return Date.UTC(year, month - 1, day) / 86_400_000
}

// Calendar days from one YYYY-MM-DD date to another: 1 from today to tomorrow, negative backwards
export const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from)

const weekTotal = (capacity: UserSettings['capacityMinutes']) => WEEKDAYS.reduce((sum, day) => sum + capacity[day], 0)

// Minutes available from `from` through `through`, both included; 0 when `from` is later. Whole
// weeks are counted at once, so a long range costs no more than a short one.
export function capacityBetween(capacity: UserSettings['capacityMinutes'], from: string, through: string): number {
  const days = daysBetween(from, through) + 1
  if (days <= 0) return 0
  const start = weekdayOf(from) // 0 (Sunday) to 6
  let total = Math.floor(days / 7) * weekTotal(capacity)
  for (let i = 0; i < days % 7; i++) total += capacity[BY_DAY_NUMBER[(start + i) % 7]!]
  return total
}

// Working days after `after`, up to and including `through`: 1 from today to tomorrow when
// tomorrow is a working day, and 0 when `through` isn't after `after`
export function workingDaysBetween(capacity: UserSettings['capacityMinutes'], after: string, through: string): number {
  const isWorking = Object.fromEntries(WEEKDAYS.map((day) => [day, capacity[day] > 0 ? 1 : 0]))
  return capacityBetween(isWorking as UserSettings['capacityMinutes'], addDays(after, 1), through)
}

// The last working day before `date`; the day before it if no weekday has any capacity
export function previousWorkingDay(capacity: UserSettings['capacityMinutes'], date: string): string {
  for (let back = 1; back <= 7; back++) {
    const day = addDays(date, -back)
    if (isWorkingDay(capacity, day)) return day
  }
  return addDays(date, -1)
}

// The latest day work can start on and still fit `minutes` of capacity in by `deadline`, counting
// both days; null if no weekday has any capacity. Whole weeks are skipped at once, since the seven
// days ending on any day always hold a week's capacity.
export function latestStartFor(capacity: UserSettings['capacityMinutes'], minutes: number, deadline: string): string | null {
  const week = weekTotal(capacity)
  if (week === 0) return null
  let day = deadline
  let remaining = minutes
  while (remaining > week) {
    remaining -= week
    day = addDays(day, -7)
  }
  // A tiny allowance for decimal hours, so 1.5 h needs 90 minutes and not a hair more
  for (;;) {
    remaining -= capacityOn(capacity, day)
    if (remaining <= 1e-9) return day
    day = addDays(day, -1)
  }
}
