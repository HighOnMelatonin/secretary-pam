// The Telegram companion bot (worker/pamBot/, docs/telegram-bot.md): what GET /api/telegram
// answers, and the limits the settings page and the Worker share. Pure, with relative imports
// only, since worker/ imports this file too.

// When the morning brief goes out, in minutes after local midnight: 07:30 until changed
export const DEFAULT_BRIEF_MINUTES = 7 * 60 + 30
export const MINUTES_PER_DAY = 24 * 60
// How long a link code from the settings page works
export const LINK_CODE_MINUTES = 10
// IANA names are far shorter; this only stops a huge string from being stored
export const MAX_TIME_ZONE_LENGTH = 100

// GET /api/telegram, when the bot is set up (it answers 404 when it isn't)
export type TelegramStatus =
  | { linked: false; botUsername: string }
  | {
      linked: true
      botUsername: string
      timeZone: string // IANA name, e.g. "Asia/Singapore"
      briefMinutes: number // local time of the morning brief, in minutes after midnight
      enabled: boolean // whether the morning brief is sent
      linkedAt: string // UTC timestamp
    }

// POST /api/telegram/link-code: the code, and the link that opens the bot with it
export interface TelegramLinkCode {
  code: string
  url: string // https://t.me/<bot>?start=<code>
  expiresAt: string // UTC timestamp
}

// PUT /api/telegram
export interface TelegramPreferences {
  timeZone: string
  briefMinutes: number
  enabled: boolean
}

// 450 -> "07:30", as an <input type="time"> shows it
export function formatMinutes(minutes: number): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

// "07:30" -> 450; null for anything else
export function parseMinutes(time: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

// Whether the runtime knows the IANA time zone, e.g. "Europe/London" or "UTC"
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value.length > MAX_TIME_ZONE_LENGTH) return false
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value })
    return true
  } catch {
    return false
  }
}

// The link that opens a chat with the bot and sends it "/start <code>"
export const deepLink = (botUsername: string, code: string) =>
  `https://t.me/${encodeURIComponent(botUsername)}?start=${encodeURIComponent(code)}`
