// Dates for the bot: when the morning brief is due, and the due dates /add's buttons set. Pure:
// the handlers read the clock and pass `now` in.
import { weekdayOf } from '../../src/types/calendar'
import { addDays } from '../../src/types/upcoming'
import type { DueChoice } from './messages'

const FRIDAY = 5

// The date a Due button sets, from the chat's local today. The end of the week is the coming
// Friday: today on a Friday, and the next week's at the weekend.
export function dueDateFor(choice: DueChoice, today: string): string {
  if (choice === 'today') return today
  if (choice === 'tomorrow') return addDays(today, 1)
  return addDays(today, (FRIDAY - weekdayOf(today) + 7) % 7)
}

// The date and time on the clock in a time zone at a moment, e.g. 2026-11-15T23:30Z in
// Asia/Singapore is { date: '2026-11-16', minutes: 450 } (07:30)
export function localDateTime(now: Date, timeZone: string): { date: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  )
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) }
}

export interface BriefTiming {
  enabled: boolean
  briefMinutes: number
  lastBriefDate: string | null
}

// The brief is due once the local time has reached the brief time, on a local day it hasn't gone
// out yet, when that day has hours for tasks (capacityToday, in minutes, is above 0)
export function briefDue(link: BriefTiming, local: { date: string; minutes: number }, capacityToday: number): boolean {
  return (
    link.enabled &&
    local.minutes >= link.briefMinutes &&
    (link.lastBriefDate === null || link.lastBriefDate < local.date) &&
    capacityToday > 0
  )
}
