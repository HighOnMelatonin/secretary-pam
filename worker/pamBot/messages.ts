// What the bot says. Pure functions over plain data, with no I/O and no clock, so each is
// unit-tested (worker/__tests__/telegramMessages.spec.ts). Everything is plain text.
import { formatMinutes } from '../../src/types/telegram'
import type { OutgoingMessage } from './botApi'

// A page of Pam, e.g. appUrl("https://pam.example", "/settings")
export const appUrl = (origin: string, route: string) => `${origin}${route}`

// The code in "/start <code>", which a t.me/<bot>?start=<code> link sends (the code is 1 to 64 of
// A-Z, a-z, 0-9, _ and -, the characters Telegram allows there); null for any other text
export function startCode(text: string | undefined): string | null {
  const match = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{1,64})\s*$/.exec(text ?? '')
  return match ? match[1]! : null
}

export interface Linked {
  email: string // the Pam account the chat is now linked to
  timeZone: string
  briefMinutes: number
}

export function linkedMessage(origin: string, linked: Linked): OutgoingMessage {
  return {
    text: [
      `This chat is linked to Pam as ${linked.email}.`,
      `Your morning brief comes at ${formatMinutes(linked.briefMinutes)} (${linked.timeZone}) on days with hours for tasks.`,
      `Change the time, or turn it off, in Pam's settings: ${appUrl(origin, '/settings')}`,
    ].join('\n'),
  }
}

export function badCodeMessage(origin: string): OutgoingMessage {
  return {
    text: `That link has expired or was already used. Get a new one from Connect in Pam's settings: ${appUrl(origin, '/settings')}`,
  }
}

export function unlinkedMessage(origin: string): OutgoingMessage {
  return { text: `This chat is no longer linked to Pam. To link it again, use Connect in Pam's settings: ${appUrl(origin, '/settings')}` }
}
