// Unit tests for what the Telegram bot says (worker/pamBot/messages.ts) and the shared helpers in
// src/types/telegram.ts. Pure functions, so no database or fake Bot API.
import { describe, expect, it } from 'vitest'
import { deepLink, formatMinutes, isTimeZone, parseMinutes } from '../../src/types/telegram'
import { appUrl, badCodeMessage, linkedMessage, startCode, unlinkedMessage } from '../pamBot/messages'

const ORIGIN = 'https://pam.example'

describe('startCode', () => {
  it('reads the code a t.me ?start= link sends', () => {
    expect(startCode('/start 0123abcdef')).toBe('0123abcdef')
    expect(startCode('/start@PamBot A-z_9')).toBe('A-z_9')
    expect(startCode('/start   abc  ')).toBe('abc')
    expect(startCode(`/start ${'a'.repeat(64)}`)).toBe('a'.repeat(64))
  })

  it('is null for anything else', () => {
    for (const text of [undefined, '', '/start', '/start ', 'start abc', '/starter abc', '/start a b', '/start a.b', `/start ${'a'.repeat(65)}`, ' /start abc']) {
      expect(startCode(text), String(text)).toBeNull()
    }
  })
})

describe('messages', () => {
  it('say who the chat is linked to and when the brief comes', () => {
    expect(linkedMessage(ORIGIN, { email: 'me@example.com', timeZone: 'Europe/London', briefMinutes: 7 * 60 + 5 })).toEqual({
      text:
        'This chat is linked to Pam as me@example.com.\n' +
        'Your morning brief comes at 07:05 (Europe/London) on days with hours for tasks.\n' +
        "Change the time, or turn it off, in Pam's settings: https://pam.example/settings",
    })
  })

  it('point to the settings page for a new code, or to link again', () => {
    expect(badCodeMessage(ORIGIN).text).toBe(
      "That link has expired or was already used. Get a new one from Connect in Pam's settings: https://pam.example/settings",
    )
    expect(unlinkedMessage(ORIGIN).text).toBe(
      "This chat is no longer linked to Pam. To link it again, use Connect in Pam's settings: https://pam.example/settings",
    )
  })

  it('link to pages of Pam from APP_ORIGIN', () => {
    expect(appUrl(ORIGIN, '/tasks/abc')).toBe('https://pam.example/tasks/abc')
  })
})

describe('shared helpers', () => {
  it('write and read brief times', () => {
    expect(formatMinutes(0)).toBe('00:00')
    expect(formatMinutes(450)).toBe('07:30')
    expect(formatMinutes(1439)).toBe('23:59')
    expect(parseMinutes('07:30')).toBe(450)
    expect(parseMinutes('23:59')).toBe(1439)
    for (const bad of ['24:00', '7:30', '07:60', '', '07:30:00']) expect(parseMinutes(bad), bad).toBeNull()
  })

  it('know IANA time zones', () => {
    for (const zone of ['UTC', 'Asia/Singapore', 'America/New_York']) expect(isTimeZone(zone)).toBe(true)
    for (const zone of ['', 'Mars/Olympus', 7, null, 'x'.repeat(101)]) expect(isTimeZone(zone)).toBe(false)
  })

  it('build the deep link', () => {
    expect(deepLink('PamBot', 'abc_1-2')).toBe('https://t.me/PamBot?start=abc_1-2')
  })
})
