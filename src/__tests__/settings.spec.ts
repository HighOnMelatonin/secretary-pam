import { describe, it, expect } from 'vitest'
import {
  applyPreset,
  capacityBetween,
  capacityOn,
  daysBetween,
  DEFAULT_SETTINGS,
  isWorkingDay,
  matchesPreset,
  PRESETS,
  weekdayKeyOf,
  type UserSettings,
} from '../types/settings'
import { hoursFromMinutes, minutesFromHours, parseEstimateHours, stepPriority } from '../types/task'

const weekdays = DEFAULT_SETTINGS.capacityMinutes // 480 Monday to Friday, 0 at the weekend
// 2026-11-16 is a Monday
const MONDAY = '2026-11-16'

describe('defaults and presets', () => {
  it('give 8 hours on weekdays and none at the weekend, with the balanced weights', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      capacityMinutes: { mon: 480, tue: 480, wed: 480, thu: 480, fri: 480, sat: 0, sun: 0 },
      buffer: 1,
      wU: 1,
      k: 1,
      horizonDays: 2,
      preset: 'balanced',
    })
  })

  it('has the four presets from the spec', () => {
    const weights = Object.fromEntries(Object.entries(PRESETS).map(([name, p]) => [name, [p.wU, p.k, p.horizonDays]]))
    expect(weights).toEqual({
      balanced: [1, 1, 2],
      deadline: [2, 0.5, 3],
      importance: [0.5, 0.5, 1],
      blockers: [1, 2, 2],
    })
  })
})

describe('weekdays', () => {
  it('names the weekday of a date, whatever the time zone', () => {
    expect(['2026-11-15', MONDAY, '2026-11-21'].map(weekdayKeyOf)).toEqual(['sun', 'mon', 'sat'])
  })

  it('gives each day its capacity, and counts days with some as working days', () => {
    expect(capacityOn(weekdays, MONDAY)).toBe(480)
    expect(capacityOn(weekdays, '2026-11-21')).toBe(0)
    expect(isWorkingDay(weekdays, MONDAY)).toBe(true)
    expect(isWorkingDay(weekdays, '2026-11-22')).toBe(false)
  })
})

describe('daysBetween', () => {
  it('counts calendar days, across months and backwards', () => {
    expect(daysBetween('2026-11-13', '2026-11-14')).toBe(1)
    expect(daysBetween('2026-11-30', '2026-12-01')).toBe(1)
    expect(daysBetween('2026-11-13', '2026-11-13')).toBe(0)
    expect(daysBetween('2026-11-14', '2026-11-13')).toBe(-1)
  })
})

describe('capacityBetween', () => {
  it('counts both ends', () => {
    expect(capacityBetween(weekdays, MONDAY, MONDAY)).toBe(480)
    expect(capacityBetween(weekdays, MONDAY, '2026-11-17')).toBe(960)
  })

  it('skips days with no capacity', () => {
    // Friday to Monday: Friday and Monday only
    expect(capacityBetween(weekdays, '2026-11-20', '2026-11-23')).toBe(960)
    expect(capacityBetween(weekdays, '2026-11-21', '2026-11-22')).toBe(0)
  })

  it('is 0 when the range ends before it starts', () => {
    expect(capacityBetween(weekdays, '2026-11-17', MONDAY)).toBe(0)
  })

  it('matches counting day by day over long ranges and uneven weeks', () => {
    const uneven: UserSettings['capacityMinutes'] = { mon: 60, tue: 0, wed: 240, thu: 30, fri: 480, sat: 90, sun: 15 }
    const dayByDay = (from: string, days: number) => {
      let total = 0
      for (let i = 0; i < days; i++) {
        const date = new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10)
        total += capacityOn(uneven, date)
      }
      return total
    }
    for (const [from, through, days] of [
      ['2026-11-13', '2026-11-19', 7],
      ['2026-11-15', '2027-02-03', 81],
      ['2026-12-30', '2028-03-01', 428],
    ] as const) {
      expect(capacityBetween(uneven, from, through)).toBe(dayByDay(from, days))
    }
  })
})

describe('estimates in hours', () => {
  it('stores hours as whole minutes', () => {
    expect(minutesFromHours(1.5)).toBe(90)
    expect(minutesFromHours(0.25)).toBe(15)
    expect(minutesFromHours(1 / 3)).toBe(20)
  })

  it('shows minutes as hours to two places, which give the same minutes back', () => {
    expect(hoursFromMinutes(90)).toBe(1.5)
    expect(hoursFromMinutes(20)).toBe(0.33)
    for (let minutes = 1; minutes <= 600; minutes++) {
      expect(minutesFromHours(hoursFromMinutes(minutes))).toBe(minutes)
    }
  })

  it('reads typed hours, a decimal comma included, and refuses what it can not store', () => {
    expect(parseEstimateHours(' 1.5 ')).toBe(90)
    expect(parseEstimateHours('0,25')).toBe(15)
    expect(parseEstimateHours('')).toBeUndefined()
    expect(parseEstimateHours('  ')).toBeUndefined()
    for (const bad of ['abc', '0', '-1', '0.001', '1000.1', '1,5,0']) expect(parseEstimateHours(bad)).toBeNaN()
    expect(parseEstimateHours('1000')).toBe(60_000)
  })
})

describe('stepPriority', () => {
  it('moves one level up or down, and stops at either end', () => {
    expect(stepPriority('medium', 'up')).toBe('high')
    expect(stepPriority('high', 'down')).toBe('medium')
    expect(stepPriority('urgent', 'up')).toBeNull()
    expect(stepPriority('low', 'down')).toBeNull()
  })
})

describe('presets', () => {
  const mine: UserSettings = { ...DEFAULT_SETTINGS, buffer: 1.5, capacityMinutes: { ...weekdays, sat: 60 } }

  it("applies a preset's weights and name, keeping the capacity and buffer", () => {
    expect(applyPreset(mine, 'deadline')).toEqual({ ...mine, preset: 'deadline', wU: 2, k: 0.5, horizonDays: 3 })
  })

  it('tells whether the weights are the named preset', () => {
    expect(matchesPreset(mine)).toBe(true)
    expect(matchesPreset(applyPreset(mine, 'blockers'))).toBe(true)
    expect(matchesPreset({ ...mine, k: 2 })).toBe(false)
    expect(matchesPreset({ ...mine, horizonDays: 3 })).toBe(false)
  })
})
