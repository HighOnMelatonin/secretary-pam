// Integration tests for the Telegram bot (worker/pamBot/), through the Worker's entry
// point and a real D1 database. fetch is replaced by a fake Bot API that records each call, so
// nothing reaches Telegram.
import { createExecutionContext, createScheduledController, env, SELF, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Forecast } from '../../src/types/forecast'
import type { Priorities } from '../../src/types/priority'
import { createEmptyProject, type Project } from '../../src/types/project'
import { createEmptyTask, type Task } from '../../src/types/task'
import worker from '../index'
import { localDateTime } from '../pamBot/schedule'
import { call, signUp } from './helpers'

const TOKEN = '123456:test-bot-token'
const SECRET = 'test-webhook-secret'
const ZONE = 'Asia/Singapore'
const CHAT = 1001
const OTHER_CHAT = 2002

interface BotCall {
  method: string
  body: Record<string, unknown>
}

// fail makes every call fail; failing, only the methods it names
let bot: { calls: BotCall[]; fail: boolean; failing: string[] }

beforeEach(() => {
  bot = { calls: [], fail: false, failing: [] }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    const prefix = `https://api.telegram.org/bot${TOKEN}/`
    if (!url.startsWith(prefix)) throw new Error(`Unexpected fetch: ${url}`)
    const method = url.slice(prefix.length)
    bot.calls.push({ method, body: JSON.parse(String(init!.body)) })
    if (bot.fail || bot.failing.includes(method)) {
      return Response.json({ ok: false, error_code: 400, description: 'Bad Request: chat not found' }, { status: 400 })
    }
    return Response.json({ ok: true, result: { message_id: bot.calls.length } })
  })
})

afterEach(() => vi.restoreAllMocks())

const sent = () => bot.calls.filter((c) => c.method === 'sendMessage').map((c) => [c.body.chat_id, c.body.text])

let nextUpdateId = 500
// A text message from a private chat (or another kind of chat), as Telegram posts it to the webhook
const textUpdate = (text: string, chatId = CHAT, options: { updateId?: number; type?: string } = {}) => ({
  update_id: options.updateId ?? nextUpdateId++,
  message: { message_id: 1, date: 0, chat: { id: chatId, type: options.type ?? 'private' }, from: { id: chatId }, text },
})

// A press of a button under one of the bot's messages (message id 77, with the text and buttons
// given), as Telegram posts it
let nextQueryId = 1
const pressUpdate = (
  data: string,
  message: { text?: string; buttons?: unknown[][]; date?: number } = {},
  options: { updateId?: number; chatId?: number } = {},
) => ({
  update_id: options.updateId ?? nextUpdateId++,
  callback_query: {
    id: `query-${nextQueryId++}`,
    from: { id: options.chatId ?? CHAT },
    data,
    message: {
      message_id: 77,
      date: message.date ?? 1_763_000_000,
      chat: { id: options.chatId ?? CHAT, type: 'private' },
      text: message.text ?? 'An earlier message',
      ...(message.buttons ? { reply_markup: { inline_keyboard: message.buttons } } : {}),
    },
  },
})

async function webhook(update: unknown, secret: string | null = SECRET) {
  const response = await SELF.fetch('http://localhost/api/telegram/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(secret === null ? {} : { 'X-Telegram-Bot-Api-Secret-Token': secret }) },
    body: typeof update === 'string' ? update : JSON.stringify(update),
  })
  return response.status
}

const linkCode = async (session: string, timeZone = ZONE) => (await call('POST', 'telegram/link-code', { timeZone }, session)).body
const status = async (session: string) => (await call('GET', 'telegram', undefined, session)).body

// Signs up and links CHAT (or another chat) to the new account
async function linkedAccount(email = 'me@example.com', chatId = CHAT) {
  const session = await signUp(email)
  const { code } = await linkCode(session)
  expect(await webhook(textUpdate(`/start ${code}`, chatId))).toBe(200)
  bot.calls = []
  return session
}

describe('with the bot off', () => {
  // The Worker's entry point with the env the tests run with, minus one of the bot's settings
  async function fetchWithout(setting: 'TELEGRAM_BOT_TOKEN' | 'TELEGRAM_WEBHOOK_SECRET' | 'TELEGRAM_BOT_USERNAME', path: string, init: RequestInit = {}) {
    const ctx = createExecutionContext()
    const response = await worker.fetch(
      new Request(`http://localhost/api/${path}`, init) as Request<unknown, IncomingRequestCfProperties>,
      { ...(env as unknown as Env), [setting]: '' },
      ctx,
    )
    await waitOnExecutionContext(ctx)
    return response.status
  }

  it('answers 404 on every route, signed in or not, without calling Telegram', async () => {
    const session = await signUp()
    const headers = { Cookie: session, 'Content-Type': 'application/json' }
    for (const setting of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_BOT_USERNAME'] as const) {
      expect(await fetchWithout(setting, 'telegram', { headers })).toBe(404)
      expect(await fetchWithout(setting, 'telegram/link-code', { method: 'POST', headers, body: JSON.stringify({ timeZone: ZONE }) })).toBe(404)
      expect(await fetchWithout(setting, 'telegram', { method: 'DELETE', headers })).toBe(404)
      expect(
        await fetchWithout(setting, 'telegram/webhook', {
          method: 'POST',
          headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET, 'Content-Type': 'application/json' },
          body: JSON.stringify(textUpdate('/start abc')),
        }),
      ).toBe(404)
    }
    expect(bot.calls).toEqual([])
  })
})

describe('the signed-in routes', () => {
  it('need a session', async () => {
    expect((await call('GET', 'telegram')).status).toBe(401)
    expect((await call('POST', 'telegram/link-code', { timeZone: ZONE })).status).toBe(401)
    expect((await call('PUT', 'telegram', { timeZone: ZONE, briefMinutes: 450, enabled: true })).status).toBe(401)
    expect((await call('DELETE', 'telegram')).status).toBe(401)
  })

  it('say an account starts unlinked, with the bot to link to', async () => {
    expect(await status(await signUp())).toEqual({ linked: false, botUsername: 'PamTestBot' })
  })

  it('answer 404 for other paths under /api/telegram', async () => {
    const session = await signUp()
    expect((await call('GET', 'telegram/other', undefined, session)).status).toBe(404)
    expect((await call('GET', 'telegram/link-code/x', undefined, session)).status).toBe(404)
  })
})

describe('link codes', () => {
  it('give a 32-character code and its t.me link, for 10 minutes, storing only a hash', async () => {
    const session = await signUp()
    const { code, url, expiresAt } = await linkCode(session)
    expect(code).toMatch(/^[0-9a-f]{32}$/)
    expect(url).toBe(`https://t.me/PamTestBot?start=${code}`)
    const minutes = (Date.parse(expiresAt) - Date.now()) / 60_000
    expect(minutes).toBeGreaterThan(9.9)
    expect(minutes).toBeLessThanOrEqual(10)

    const rows = (await env.DB.prepare('SELECT id, time_zone FROM telegram_link_codes').all<{ id: string; time_zone: string }>()).results
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toMatch(/^[0-9a-f]{64}$/)
    expect(rows[0]!.id).not.toContain(code)
    expect(rows[0]!.time_zone).toBe(ZONE)
  })

  it('need a time zone the runtime knows', async () => {
    const session = await signUp()
    for (const body of [{}, { timeZone: 'Mars/Olympus' }, { timeZone: 7 }, { timeZone: ZONE, extra: 1 }]) {
      expect((await call('POST', 'telegram/link-code', body, session)).status).toBe(400)
    }
    expect((await call('GET', 'telegram/link-code', undefined, session)).status).toBe(405)
  })

  it('replace the code asked for before', async () => {
    const session = await signUp()
    const first = await linkCode(session)
    const second = await linkCode(session)

    await webhook(textUpdate(`/start ${first.code}`))
    expect((await status(session)).linked).toBe(false)
    await webhook(textUpdate(`/start ${second.code}`))
    expect((await status(session)).linked).toBe(true)
  })
})

describe('the webhook', () => {
  it('refuses a request without the secret, or with the wrong one, and does nothing', async () => {
    const session = await signUp()
    const { code } = await linkCode(session)
    expect(await webhook(textUpdate(`/start ${code}`), null)).toBe(401)
    expect(await webhook(textUpdate(`/start ${code}`), 'wrong-secret')).toBe(401)
    expect(await webhook(textUpdate(`/start ${code}`), `${SECRET}x`)).toBe(401)
    expect(bot.calls).toEqual([])
    expect((await status(session)).linked).toBe(false)
  })

  it('links the chat from "/start <code>", with the time zone the code came with', async () => {
    const session = await signUp('me@example.com')
    const { code } = await linkCode(session)
    expect(await webhook(textUpdate(`/start ${code}`))).toBe(200)

    expect(sent()).toEqual([
      [
        CHAT,
        'This chat is linked to Pam as me@example.com.\n' +
          'Your morning brief comes at 07:30 (Asia/Singapore) on days with hours for tasks.\n' +
          "Change the time, or turn it off, in Pam's settings: https://pam.example/settings",
      ],
    ])
    // Plain text: no parse_mode, and no link preview card
    expect(bot.calls[0]!.body).toEqual({ chat_id: CHAT, text: expect.any(String), link_preview_options: { is_disabled: true } })
    expect(await status(session)).toEqual({
      linked: true,
      botUsername: 'PamTestBot',
      timeZone: ZONE,
      briefMinutes: 450,
      enabled: true,
      linkedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    })
  })

  it('uses a code once', async () => {
    const session = await signUp()
    const { code } = await linkCode(session)
    await webhook(textUpdate(`/start ${code}`))
    bot.calls = []

    await webhook(textUpdate(`/start ${code}`, OTHER_CHAT))
    expect(sent()).toEqual([
      [OTHER_CHAT, "That link has expired or was already used. Get a new one from Connect in Pam's settings: https://pam.example/settings"],
    ])
    expect((await env.DB.prepare('SELECT chat_id FROM telegram_links').all()).results).toEqual([{ chat_id: CHAT }])
  })

  it('refuses an expired code', async () => {
    const session = await signUp()
    const { code } = await linkCode(session)
    await env.DB.prepare("UPDATE telegram_link_codes SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 second')").run()

    await webhook(textUpdate(`/start ${code}`))
    expect(sent()).toHaveLength(1)
    expect(sent()[0]![1]).toMatch(/^That link has expired/)
    expect((await status(session)).linked).toBe(false)
  })

  it('ignores everything else from an unlinked chat', async () => {
    const session = await signUp()
    const { code } = await linkCode(session)
    for (const text of ['/start', 'hello', `/start ${code} extra`, '/next']) await webhook(textUpdate(text))
    // Only private chats: a group can't be linked
    await webhook(textUpdate(`/start ${code}`, -3003, { type: 'group' }))
    // Updates that aren't messages
    await webhook({ update_id: nextUpdateId++, edited_message: textUpdate(`/start ${code}`).message })
    // A button press is only answered, with nothing said, so Telegram stops its spinner
    await webhook({ update_id: nextUpdateId++, callback_query: { id: 'q', from: { id: CHAT }, data: 'x' } })
    await webhook(pressUpdate('d:some-task'))

    expect(bot.calls).toEqual([
      { method: 'answerCallbackQuery', body: { callback_query_id: 'q' } },
      { method: 'answerCallbackQuery', body: { callback_query_id: expect.any(String) } },
    ])
    expect((await status(session)).linked).toBe(false)
    // The code wasn't used up
    await webhook(textUpdate(`/start ${code}`))
    expect((await status(session)).linked).toBe(true)
  })

  it('answers 200 to a body that is not an update, doing nothing', async () => {
    for (const body of ['not json', '[]', '{}', JSON.stringify({ update_id: 'one' })]) expect(await webhook(body)).toBe(200)
    expect(bot.calls).toEqual([])
  })

  it('skips an update no newer than the last one handled for the chat', async () => {
    const session = await signUp()
    const { code } = await linkCode(session)
    await webhook(textUpdate(`/start ${code}`, CHAT, { updateId: 900 }))
    const other = await signUp('other@example.com')
    const second = await linkCode(other)
    bot.calls = []

    // Telegram sending the same update again, or an older one, changes nothing
    await webhook(textUpdate(`/start ${second.code}`, CHAT, { updateId: 900 }))
    await webhook(textUpdate(`/start ${second.code}`, CHAT, { updateId: 899 }))
    expect(bot.calls).toEqual([])
    expect((await status(session)).linked).toBe(true)
    expect((await status(other)).linked).toBe(false)

    // A newer one goes through
    await webhook(textUpdate(`/start ${second.code}`, CHAT, { updateId: 901 }))
    expect((await status(other)).linked).toBe(true)
  })

  it("lets a new link replace the account's old chat, and the chat's old account", async () => {
    // The account moves to another chat
    const me = await linkedAccount('me@example.com', CHAT)
    await webhook(textUpdate(`/start ${(await linkCode(me)).code}`, OTHER_CHAT))
    expect((await env.DB.prepare('SELECT chat_id FROM telegram_links').all()).results).toEqual([{ chat_id: OTHER_CHAT }])

    // Another account takes that chat over
    const other = await signUp('other@example.com')
    await webhook(textUpdate(`/start ${(await linkCode(other)).code}`, OTHER_CHAT))
    expect((await status(me)).linked).toBe(false)
    expect((await status(other)).linked).toBe(true)
    expect(sent().at(-1)![1]).toMatch(/^This chat is linked to Pam as other@example.com\./)
  })

  it('still answers 200 when Telegram refuses the reply, logging the failure without the token', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const session = await signUp()
    const { code } = await linkCode(session)
    bot.fail = true

    expect(await webhook(textUpdate(`/start ${code}`))).toBe(200)
    expect((await status(session)).linked).toBe(true)
    const logged = errors.mock.calls.flat().map(String).join('\n')
    expect(logged).toContain('Telegram sendMessage failed (400): Bad Request: chat not found')
    expect(logged).not.toContain(TOKEN)
  })
})

describe('preferences', () => {
  it('save the time zone, brief time and on/off switch', async () => {
    const session = await linkedAccount()
    const saved = await call('PUT', 'telegram', { timeZone: 'Europe/London', briefMinutes: 8 * 60 + 15, enabled: false }, session)
    expect(saved.status).toBe(200)
    expect(saved.body).toMatchObject({ linked: true, timeZone: 'Europe/London', briefMinutes: 495, enabled: false })
    expect(await status(session)).toEqual(saved.body)
  })

  it('refuse anything malformed', async () => {
    const session = await linkedAccount()
    const good = { timeZone: ZONE, briefMinutes: 450, enabled: true }
    for (const body of [
      {},
      { ...good, timeZone: 'Nowhere/Town' },
      { ...good, briefMinutes: 1440 },
      { ...good, briefMinutes: -1 },
      { ...good, briefMinutes: 7.5 },
      // Briefs go out on the quarter hour
      { ...good, briefMinutes: 452 },
      { ...good, enabled: 1 },
      { ...good, extra: true },
      { timeZone: ZONE, briefMinutes: 450 },
    ]) {
      expect((await call('PUT', 'telegram', body, session)).status, JSON.stringify(body)).toBe(400)
    }
    expect(await status(session)).toMatchObject(good)
  })

  it('answer 409 when the account has no chat linked', async () => {
    const session = await signUp()
    expect((await call('PUT', 'telegram', { timeZone: ZONE, briefMinutes: 450, enabled: true }, session)).status).toBe(409)
  })
})

describe('disconnecting', () => {
  it('unlinks the chat, tells it so, and leaves other accounts alone', async () => {
    const me = await linkedAccount('me@example.com', CHAT)
    const other = await linkedAccount('other@example.com', OTHER_CHAT)

    expect((await call('DELETE', 'telegram', undefined, me)).status).toBe(204)
    expect(await status(me)).toEqual({ linked: false, botUsername: 'PamTestBot' })
    expect((await status(other)).linked).toBe(true)
    await vi.waitFor(() =>
      expect(sent()).toEqual([[CHAT, "This chat is no longer linked to Pam. To link it again, use Connect in Pam's settings: https://pam.example/settings"]]),
    )

    // The chat is now ignored
    bot.calls = []
    await webhook(textUpdate('/next'))
    expect(bot.calls).toEqual([])
  })

  it('answers 204 when nothing was linked, sending nothing', async () => {
    const session = await signUp()
    expect((await call('DELETE', 'telegram', undefined, session)).status).toBe(204)
    expect(bot.calls).toEqual([])
  })
})

describe('the morning brief', () => {
  // Monday 16 November 2026 at 07:30 in Singapore, 8 hours ahead of UTC
  const MONDAY_0730 = '2026-11-15T23:30:00Z'
  const plus = (time: string, minutes: number) => new Date(Date.parse(time) + minutes * 60_000).toISOString()

  // One run of the Cron Trigger at the given UTC time, with the env the tests run with or another
  async function cron(time: string, withEnv: Env = env as unknown as Env) {
    await worker.scheduled(createScheduledController({ scheduledTime: new Date(time), cron: '*/15 * * * *' }), withEnv)
  }

  const lastBriefDate = async (chatId = CHAT) =>
    (await env.DB.prepare('SELECT last_brief_date FROM telegram_links WHERE chat_id = ?1').bind(chatId).first<string>('last_brief_date')) ?? null

  const saveTask = (session: string, id: string, fields: Partial<Task>) =>
    call('PUT', `tasks/${id}`, { task: { ...createEmptyTask(), id, name: id, ...fields } }, session)

  it('goes out once the local time reaches the brief time, built from the forecast and Suggested', async () => {
    const session = await linkedAccount()
    await saveTask(session, 'report', { name: 'Report', dueDate: '2026-11-17', effortMinutes: 120 })
    await saveTask(session, 'slides', { name: 'Slides', dueDate: '2026-11-20' })
    await saveTask(session, 'email', { name: 'Email', effortMinutes: 15 })

    await cron(plus(MONDAY_0730, -15))
    expect(bot.calls).toEqual([])
    expect(await lastBriefDate()).toBeNull()

    await cron(MONDAY_0730)
    // The same as the app gets for the user's local today
    const forecast: Forecast = (await call('GET', 'forecast?today=2026-11-16', undefined, session)).body
    const priorities: Priorities = (await call('GET', 'priorities?today=2026-11-16', undefined, session)).body
    const [first, second] = [...priorities.sections.overdue, ...priorities.sections.do_now, ...priorities.sections.do_next].map(
      (id) => priorities.tasks.find((t) => t.taskId === id)!,
    )
    expect(bot.calls).toHaveLength(1)
    expect(bot.calls[0]!.body).toMatchObject({
      chat_id: CHAT,
      text: [
        forecast.brief.text,
        'Start with:',
        `1. ${first!.name} (${first!.name === 'Slides' ? '2 h, no estimate' : `${first!.factors.effortHours} h`}). ${first!.reason.text}`,
        `2. ${second!.name} (${second!.name === 'Slides' ? '2 h, no estimate' : `${second!.factors.effortHours} h`}). ${second!.reason.text}`,
      ].join('\n'),
      reply_markup: {
        inline_keyboard: [
          [
            { text: '1 Done', callback_data: `d:${first!.taskId}` },
            { text: '1 Not today', callback_data: `nt:${first!.taskId}` },
          ],
          [
            { text: '2 Done', callback_data: `d:${second!.taskId}` },
            { text: '2 Not today', callback_data: `nt:${second!.taskId}` },
          ],
          [
            { text: 'Next', callback_data: 'next:2' },
            { text: 'Open Pam', url: 'https://pam.example/' },
          ],
        ],
      },
    })
    expect(bot.calls[0]!.body).not.toHaveProperty('parse_mode')
    expect(await lastBriefDate()).toBe('2026-11-16')
  })

  it('goes out once a local day, and again the next', async () => {
    await linkedAccount()
    await cron(MONDAY_0730)
    await cron(plus(MONDAY_0730, 15))
    await cron(plus(MONDAY_0730, 12 * 60))
    expect(sent()).toEqual([[CHAT, 'No open tasks today.']])

    await cron(plus(MONDAY_0730, 24 * 60))
    expect(sent()).toHaveLength(2)
    expect(await lastBriefDate()).toBe('2026-11-17')
  })

  it('catches up later in the day when a run was missed', async () => {
    await linkedAccount()
    await cron(plus(MONDAY_0730, 3 * 60))
    expect(sent()).toHaveLength(1)
  })

  it("skips days with no hours for tasks, and follows the account's capacity", async () => {
    const session = await linkedAccount()
    // Saturday 21 November: the default settings have no hours at the weekend
    const saturday = plus(MONDAY_0730, 5 * 24 * 60)
    await cron(saturday)
    expect(bot.calls).toEqual([])
    expect(await lastBriefDate()).toBeNull()

    const settings = (await call('GET', 'settings', undefined, session)).body
    await call('PUT', 'settings', { ...settings, capacityMinutes: { ...settings.capacityMinutes, sat: 120 } }, session)
    await cron(plus(saturday, 15))
    expect(sent()).toHaveLength(1)
    expect(await lastBriefDate()).toBe('2026-11-21')
  })

  it("goes out at each chat's own time in its own time zone, and not when turned off", async () => {
    const me = await linkedAccount('me@example.com', CHAT)
    const other = await linkedAccount('other@example.com', OTHER_CHAT)
    await call('PUT', 'telegram', { timeZone: 'Europe/London', briefMinutes: 8 * 60, enabled: true }, other)

    await cron(MONDAY_0730)
    expect(sent().map(([chat]) => chat)).toEqual([CHAT])

    // 08:00 in London, which is on UTC in November
    await cron('2026-11-16T08:00:00Z')
    expect(sent().map(([chat]) => chat)).toEqual([CHAT, OTHER_CHAT])

    // Turned off, the next day's brief doesn't go out
    await call('PUT', 'telegram', { timeZone: ZONE, briefMinutes: 450, enabled: false }, me)
    await cron(plus(MONDAY_0730, 24 * 60))
    expect(sent().map(([chat]) => chat)).toEqual([CHAT, OTHER_CHAT])
  })

  it('tries again on the next run when Telegram refuses it, logging the failure without the token', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    await linkedAccount('me@example.com', CHAT)
    await linkedAccount('other@example.com', OTHER_CHAT)
    bot.fail = true

    await cron(MONDAY_0730)
    // Both were tried: one chat's failure doesn't stop the other's
    expect(sent().map(([chat]) => chat).sort()).toEqual([CHAT, OTHER_CHAT])
    expect(await lastBriefDate(CHAT)).toBeNull()
    const logged = errors.mock.calls.flat().map(String).join('\n')
    expect(logged).toContain('Sending a morning brief failed:\nBotApiError: Telegram sendMessage failed (400): Bad Request: chat not found')
    expect(logged).not.toContain(TOKEN)

    bot.fail = false
    bot.calls = []
    await cron(plus(MONDAY_0730, 15))
    expect(sent()).toHaveLength(2)
    expect(await lastBriefDate(CHAT)).toBe('2026-11-16')
  })

  it('does nothing with the bot off', async () => {
    await linkedAccount()
    await cron(MONDAY_0730, { ...(env as unknown as Env), TELEGRAM_BOT_TOKEN: '' })
    expect(bot.calls).toEqual([])
    expect(await lastBriefDate()).toBeNull()
  })
})

describe('buttons and commands', () => {
  // The chat's local date, as the webhook works it out from the clock
  const today = () => localDateTime(new Date(), ZONE).date
  const inDays = (days: number) => new Date(Date.parse(`${today()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

  const saveTask = (session: string, id: string, fields: Partial<Task>) =>
    call('PUT', `tasks/${id}`, { task: { ...createEmptyTask(), id, name: id, ...fields } }, session)
  const taskOf = async (session: string, id: string): Promise<Task | undefined> =>
    ((await call('GET', 'tasks', undefined, session)).body as Task[]).find((t) => t.id === id)
  const methods = () => bot.calls.map((c) => c.method)
  const lastText = () => sent()[sent().length - 1]![1] as string

  // Four tasks, Suggested in the order a, b, c, d by their due dates
  async function fourTasks() {
    const session = await linkedAccount()
    await saveTask(session, 'a', { name: 'Alpha', dueDate: inDays(1), effortMinutes: 60 })
    await saveTask(session, 'b', { name: 'Bravo', dueDate: inDays(3), effortMinutes: 60 })
    await saveTask(session, 'c', { name: 'Charlie', dueDate: inDays(6), effortMinutes: 60 })
    await saveTask(session, 'd', { name: 'Delta', dueDate: inDays(9), effortMinutes: 60 })
    const priorities: Priorities = (await call('GET', `priorities?today=${today()}`, undefined, session)).body
    expect([...priorities.sections.overdue, ...priorities.sections.do_now, ...priorities.sections.do_next]).toEqual(['a', 'b', 'c', 'd'])
    return session
  }

  // The brief's buttons for a and b, as the message they're pressed under has them
  const briefButtons = [
    [
      { text: '1 Done', callback_data: 'd:a' },
      { text: '1 Not today', callback_data: 'nt:a' },
    ],
    [
      { text: '2 Done', callback_data: 'd:b' },
      { text: '2 Not today', callback_data: 'nt:b' },
    ],
    [
      { text: 'Next', callback_data: 'next:2' },
      { text: 'Open Pam', url: 'https://pam.example/' },
    ],
  ]

  it('Done completes the task, answers, marks the message and sends the new top two', async () => {
    const session = await fourTasks()
    await webhook(pressUpdate('d:a', { text: 'Brief\nStart with:\n1. Alpha\n2. Bravo', buttons: briefButtons }))

    expect((await taskOf(session, 'a'))!.completed).toBe(true)
    const events = (await call('GET', 'events', undefined, session)).body as { kind: string; taskId: string; source: string }[]
    expect(events.filter((e) => e.kind === 'task_completed')).toMatchObject([{ taskId: 'a', source: 'telegram' }])

    expect(methods()).toEqual(['answerCallbackQuery', 'editMessageText', 'sendMessage'])
    expect(bot.calls[1]!.body).toEqual({
      chat_id: CHAT,
      message_id: 77,
      text: 'Brief\nStart with:\n1. Alpha\n2. Bravo\nDone: Alpha',
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [briefButtons[1], briefButtons[2]] },
    })
    expect(lastText()).toMatch(/^Next up:\n1\. Bravo \(.*\n2\. Charlie \(/)
    expect(bot.calls[2]!.body).not.toHaveProperty('parse_mode')
  })

  it('never reopens a task: Done again, or for a task done or deleted in Pam, only gets a note', async () => {
    const session = await fourTasks()
    await webhook(pressUpdate('d:a'))
    bot.calls = []

    await webhook(pressUpdate('d:a'))
    expect(methods()).toEqual(['answerCallbackQuery', 'sendMessage'])
    expect(lastText()).toBe('"Alpha" is already done.')
    await webhook(pressUpdate('nt:a'))
    expect(lastText()).toBe('"Alpha" is already done.')
    expect((await taskOf(session, 'a'))!.completed).toBe(true)

    await call('DELETE', 'tasks/b', undefined, session)
    await webhook(pressUpdate('d:b'))
    expect(lastText()).toBe('That task is no longer in Pam.')

    const events = (await call('GET', 'events', undefined, session)).body as { kind: string }[]
    expect(events.filter((e) => e.kind === 'task_completed')).toHaveLength(1)
    expect(events.filter((e) => e.kind === 'task_reopened')).toHaveLength(0)
  })

  it('Not today starts the task tomorrow, then sends the top two', async () => {
    const session = await fourTasks()
    await webhook(pressUpdate('nt:a', { text: 'Next up:\n1. Alpha\n2. Bravo', buttons: briefButtons }))

    expect((await taskOf(session, 'a'))!.startDate).toBe(inDays(1))
    expect(methods()).toEqual(['answerCallbackQuery', 'editMessageText', 'sendMessage'])
    expect(bot.calls[1]!.body.text).toBe('Next up:\n1. Alpha\n2. Bravo\nNot today: Alpha')
    // Alpha doesn't start until tomorrow, so it's hidden
    expect(lastText()).toMatch(/^Next up:\n1\. Bravo \(.*\n2\. Charlie \(/)
  })

  it('Not today for a task due today replies with the refusal, then sends the top two', async () => {
    const session = await linkedAccount()
    await saveTask(session, 'a', { name: 'Alpha', dueDate: today(), effortMinutes: 60 })
    await webhook(pressUpdate('nt:a', { buttons: briefButtons }))

    expect((await taskOf(session, 'a'))!.startDate).toBeUndefined()
    expect(methods()).toEqual(['answerCallbackQuery', 'sendMessage', 'sendMessage'])
    expect(sent()[0]![1]).toMatch(/^"Alpha": /)
    expect(lastText()).toMatch(/^Next up:\n1\. Alpha \(/)
  })

  it('Next sends the following two without changing anything', async () => {
    const session = await fourTasks()
    const before = (await call('GET', 'tasks', undefined, session)).body
    await webhook(pressUpdate('next:2'))

    expect(methods()).toEqual(['answerCallbackQuery', 'sendMessage'])
    expect(lastText()).toMatch(/^Then:\n3\. Charlie \(.*\n4\. Delta \(/)
    expect(bot.calls[1]!.body.reply_markup).toEqual({
      inline_keyboard: [
        [
          { text: '3 Done', callback_data: 'd:c' },
          { text: '3 Not today', callback_data: 'nt:c' },
        ],
        [
          { text: '4 Done', callback_data: 'd:d' },
          { text: '4 Not today', callback_data: 'nt:d' },
        ],
        [{ text: 'Open Pam', url: 'https://pam.example/' }],
      ],
    })
    expect((await call('GET', 'tasks', undefined, session)).body).toEqual(before)

    await webhook(pressUpdate('next:4'))
    expect(lastText()).toBe("That's every task for today.")
  })

  it('handles a press once when Telegram sends it again, and answers data it did not make', async () => {
    await fourTasks()
    const press = pressUpdate('next:2')
    await webhook(press)
    await webhook(press)
    expect(methods()).toEqual(['answerCallbackQuery', 'sendMessage'])

    bot.calls = []
    await webhook(pressUpdate('x:what'))
    expect(methods()).toEqual(['answerCallbackQuery'])
  })

  it('still sends the top two when the message is too old to edit, or the edit fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const session = await fourTasks()
    await webhook(pressUpdate('d:a', { date: 0 }))
    expect(methods()).toEqual(['answerCallbackQuery', 'sendMessage'])

    bot.calls = []
    bot.failing = ['editMessageText']
    await webhook(pressUpdate('d:b', { buttons: briefButtons }))
    expect(methods()).toEqual(['answerCallbackQuery', 'editMessageText', 'sendMessage'])
    expect((await taskOf(session, 'b'))!.completed).toBe(true)
    const logged = errors.mock.calls.flat().map(String).join('\n')
    expect(logged).toContain('Editing a Telegram message failed:')
    expect(logged).not.toContain(TOKEN)
  })

  it('answers a press even when sending what it asked for fails, logging the failure', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    await fourTasks()
    bot.failing = ['sendMessage']
    await webhook(pressUpdate('next:2'))
    // Answered before the message failed
    expect(methods()).toEqual(['answerCallbackQuery', 'sendMessage'])
    expect(bot.calls[0]!.body).toEqual({ callback_query_id: expect.any(String) })
    expect(errors.mock.calls.flat().map(String).join('\n')).toContain('Handling a Telegram update failed:')
  })

  it('/next sends the top two, and /today the forecast’s plan for today', async () => {
    const session = await fourTasks()
    await webhook(textUpdate('/next'))
    expect(lastText()).toMatch(/^Next up:\n1\. Alpha \(1 h\)\. .*\n2\. Bravo \(1 h\)\. /)

    await webhook(textUpdate('/today'))
    const forecast: Forecast = (await call('GET', `forecast?today=${today()}`, undefined, session)).body
    expect(lastText()).toBe(
      [
        forecast.brief.parts[0]!.text,
        ...forecast.todayPlan.map((item, i) => `${i + 1}. ${item.name} (${item.hours} h${item.finishes ? '' : ', more after today'})`),
      ].join('\n'),
    )
    expect(bot.calls[bot.calls.length - 1]!.body.reply_markup).toEqual({
      inline_keyboard: [[{ text: 'Open Pam', url: 'https://pam.example/' }]],
    })
  })

  it('/brief sends the brief now, without counting as the day’s brief', async () => {
    await fourTasks()
    await webhook(textUpdate('/brief'))
    expect(lastText()).toMatch(/\nStart with:\n1\. Alpha /)
    const lastBrief = await env.DB.prepare('SELECT last_brief_date FROM telegram_links WHERE chat_id = ?1')
      .bind(CHAT)
      .first('last_brief_date')
    expect(lastBrief).toBeNull()
  })

  it('/stop turns the morning brief off', async () => {
    const session = await linkedAccount()
    await webhook(textUpdate('/stop'))
    expect(lastText()).toBe("The morning brief is off. To turn it back on, use Pam's settings: https://pam.example/settings")
    expect(await status(session)).toMatchObject({ linked: true, enabled: false })
  })

  it('/help, and a bare /start, list the commands, and /next@<bot> is /next', async () => {
    await linkedAccount()
    await webhook(textUpdate('/help'))
    expect(lastText()).toMatch(/^Pam's commands:\n\/next: /)
    await webhook(textUpdate('/start'))
    await webhook(textUpdate('/next@PamTestBot'))
    expect(sent()).toHaveLength(3)
    expect(lastText()).toBe('No open tasks today.')
  })
})

describe('capture', () => {
  const today = () => localDateTime(new Date(), ZONE).date
  const inDays = (days: number) => new Date(Date.parse(`${today()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
  const tasksOf = async (session: string): Promise<Task[]> => (await call('GET', 'tasks', undefined, session)).body
  const methods = () => bot.calls.map((c) => c.method)
  const lastText = () => sent()[sent().length - 1]![1] as string
  const lastAdded = () =>
    env.DB.prepare('SELECT last_added_task_id FROM telegram_links WHERE chat_id = ?1').bind(CHAT).first<string>('last_added_task_id')

  // Adds a task from the chat, returning it and the reply's buttons
  async function add(session: string, name = 'Write the report') {
    await webhook(textUpdate(`/add ${name}`))
    const task = (await tasksOf(session)).find((t) => t.name === name)!
    const reply = bot.calls[bot.calls.length - 1]!.body
    return { task, text: reply.text as string, buttons: (reply.reply_markup as { inline_keyboard: unknown[][] }).inline_keyboard }
  }

  it('/add makes a task with the defaults, and replies with it and buttons for each field', async () => {
    const session = await linkedAccount()
    const { task, text, buttons } = await add(session)

    expect(task).toEqual({ id: task.id, name: 'Write the report', description: '', dueDate: null, relations: [], priority: 'medium', completed: false })
    expect(await lastAdded()).toBe(task.id)
    const events = (await call('GET', 'events', undefined, session)).body as { kind: string; source: string }[]
    expect(events).toMatchObject([{ kind: 'task_created', source: 'telegram' }])

    expect(text).toBe('Added: Write the report\nPriority: Medium\nDue: none\nEstimate: none')
    expect(buttons).toEqual([
      [
        { text: 'Low', callback_data: `p:low:${task.id}` },
        { text: 'High', callback_data: `p:high:${task.id}` },
        { text: 'Urgent', callback_data: `p:urgent:${task.id}` },
      ],
      [
        { text: 'Today', callback_data: `due:today:${task.id}` },
        { text: 'Tomorrow', callback_data: `due:tomorrow:${task.id}` },
        { text: 'End of week', callback_data: `due:week:${task.id}` },
      ],
      [
        { text: '30 m', callback_data: `e:30:${task.id}` },
        { text: '1 h', callback_data: `e:60:${task.id}` },
        { text: '4 h', callback_data: `e:240:${task.id}` },
      ],
      [{ text: 'Open in Pam', url: `https://pam.example/tasks/${task.id}` }],
    ])
  })

  it('/add without a name, or with one too long, says so and adds nothing', async () => {
    const session = await linkedAccount()
    await webhook(textUpdate('/add'))
    expect(lastText()).toBe("Send /add and the task's name, such as /add Write the report.")
    await webhook(textUpdate('/add    '))
    await webhook(textUpdate(`/add ${'x'.repeat(201)}`))
    expect(lastText()).toBe("A task's name can be at most 200 characters.")
    expect(await tasksOf(session)).toEqual([])
  })

  it('each button sets its one field and edits the message to show the values now', async () => {
    const session = await linkedAccount()
    const { task, text } = await add(session)
    bot.calls = []

    await webhook(pressUpdate(`p:urgent:${task.id}`, { text }))
    expect(methods()).toEqual(['answerCallbackQuery', 'editMessageText'])
    expect(bot.calls[1]!.body).toMatchObject({ chat_id: CHAT, message_id: 77, text: expect.stringContaining('\nPriority: Urgent\n') })
    expect((bot.calls[1]!.body.reply_markup as { inline_keyboard: unknown[] }).inline_keyboard).toHaveLength(4)

    await webhook(pressUpdate(`due:tomorrow:${task.id}`, { text }))
    await webhook(pressUpdate(`e:240:${task.id}`, { text }))
    const saved = (await tasksOf(session))[0]!
    expect(saved).toMatchObject({ priority: 'urgent', dueDate: inDays(1), effortMinutes: 240 })
    const weekday = new Date(`${inDays(1)}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })
    expect(bot.calls[bot.calls.length - 1]!.body.text).toBe(
      `Added: Write the report\nPriority: Urgent\nDue: ${inDays(1)} (${weekday})\nEstimate: 4 h`,
    )
    const events = (await call('GET', 'events', undefined, session)).body as { kind: string; source: string; newValue: string }[]
    expect(events.find((e) => e.kind === 'due_date_changed')).toMatchObject({ source: 'telegram', newValue: inDays(1) })
  })

  it('sets Today, and End of week as the coming Friday', async () => {
    const session = await linkedAccount()
    const { task } = await add(session)
    await webhook(pressUpdate(`due:today:${task.id}`))
    expect((await tasksOf(session))[0]!.dueDate).toBe(today())

    await webhook(pressUpdate(`due:week:${task.id}`))
    const friday = inDays((5 - new Date(`${today()}T00:00:00Z`).getUTCDay() + 7) % 7)
    expect((await tasksOf(session))[0]!.dueDate).toBe(friday)
  })

  it('moves a start date back with a due date set before it', async () => {
    const session = await linkedAccount()
    const { task } = await add(session)
    await call('PATCH', `tasks/${task.id}`, { task: { startDate: inDays(5) } }, session)
    await webhook(pressUpdate(`due:tomorrow:${task.id}`))
    expect((await tasksOf(session))[0]).toMatchObject({ dueDate: inDays(1), startDate: inDays(1) })
  })

  it('only answers a press that changes nothing, and sends the values anew under a message too old to edit', async () => {
    const session = await linkedAccount()
    const { task } = await add(session)
    bot.calls = []
    await webhook(pressUpdate(`p:high:${task.id}`))
    await webhook(pressUpdate(`p:high:${task.id}`))
    expect(methods()).toEqual(['answerCallbackQuery', 'editMessageText', 'answerCallbackQuery'])

    bot.calls = []
    await webhook(pressUpdate(`e:30:${task.id}`, { date: 0 }))
    expect(methods()).toEqual(['answerCallbackQuery', 'sendMessage'])
    expect(lastText()).toContain('\nEstimate: 30 m')
  })

  it('a button for a task done or deleted since only gets a note', async () => {
    const session = await linkedAccount()
    const { task } = await add(session)
    await call('PATCH', `tasks/${task.id}`, { task: { completed: true } }, session)
    bot.calls = []
    await webhook(pressUpdate(`p:low:${task.id}`))
    expect(methods()).toEqual(['answerCallbackQuery', 'sendMessage'])
    expect(lastText()).toBe('"Write the report" is already done.')
    expect((await tasksOf(session))[0]).toMatchObject({ priority: 'medium', completed: true })

    await call('DELETE', `tasks/${task.id}`, undefined, session)
    await webhook(pressUpdate(`due:today:${task.id}`))
    expect(lastText()).toBe('That task is no longer in Pam.')
  })

  it('/desc describes the task last added in the chat, and names it', async () => {
    const session = await linkedAccount()
    await webhook(textUpdate('/desc Too soon'))
    expect(lastText()).toBe('Add a task with /add first, then describe it with /desc.')

    await add(session, 'First')
    const { task } = await add(session, 'Second')
    await webhook(textUpdate('/desc Ask Sam for the figures\nby Friday'))
    expect(lastText()).toBe('Saved the description of "Second".')
    const tasks = await tasksOf(session)
    expect(tasks.find((t) => t.id === task.id)!.description).toBe('Ask Sam for the figures\nby Friday')
    expect(tasks.find((t) => t.name === 'First')!.description).toBe('')

    await webhook(textUpdate('/desc'))
    expect(lastText()).toBe(
      'Send /desc and the description, such as /desc Ask Sam for the figures. It goes on the task you last added with /add.',
    )
    await webhook(textUpdate(`/desc ${'x'.repeat(10_001)}`))
    expect(lastText()).toBe('A description can be at most 10,000 characters.')

    await call('DELETE', `tasks/${task.id}`, undefined, session)
    await webhook(textUpdate('/desc Gone'))
    expect(lastText()).toBe('That task is no longer in Pam.')
  })

  it('any other text gets a one-line hint and never makes a task', async () => {
    const session = await linkedAccount()
    for (const text of ['Buy milk', '/unknown', 'add Buy milk', '/next@SomeOtherBot']) await webhook(textUpdate(text))
    expect(sent()).toEqual(Array(4).fill([CHAT, 'To add a task, send /add and its name. /help lists everything else.']))
    expect(await tasksOf(session)).toEqual([])

    // A message without text, such as a photo, gets nothing
    bot.calls = []
    await webhook({ update_id: nextUpdateId++, message: { message_id: 2, date: 0, chat: { id: CHAT, type: 'private' }, photo: [] } })
    expect(bot.calls).toEqual([])
  })
})

describe('lookups', () => {
  const today = () => localDateTime(new Date(), ZONE).date
  const inDays = (days: number) => new Date(Date.parse(`${today()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
  const lastText = () => sent()[sent().length - 1]![1] as string
  const lastButtons = () => (bot.calls[bot.calls.length - 1]!.body.reply_markup as { inline_keyboard: unknown[][] }).inline_keyboard
  const dashboard = [[{ text: 'Open Pam', url: 'https://pam.example/' }]]

  const saveTask = (session: string, id: string, fields: Partial<Task>) =>
    call('PUT', `tasks/${id}`, { task: { ...createEmptyTask(), id, name: id, ...fields } }, session)
  const saveProject = (session: string, id: string, fields: Partial<Project>) =>
    call('PUT', `projects/${id}`, { project: { ...createEmptyProject(), id, name: id, ...fields } }, session)
  const forecastOf = async (session: string): Promise<Forecast> => (await call('GET', `forecast?today=${today()}`, undefined, session)).body

  // Two projects called Thesis…, and a task in neither
  async function projects() {
    const session = await linkedAccount()
    await saveTask(session, 'intro', { name: 'Intro', effortMinutes: 90 })
    await saveTask(session, 'method', { name: 'Method' })
    await saveTask(session, 'done', { name: 'Done', completed: true, effortMinutes: 60 })
    await saveTask(session, 'slides', { name: 'Slides', effortMinutes: 30 })
    await saveProject(session, 'thesis', { name: 'Thesis', taskIds: ['intro', 'method', 'done'] })
    await saveProject(session, 'defence', { name: 'Thesis defence', taskIds: ['slides'] })
    return session
  }

  it("/tasks lists the matching project's open tasks, linking to its page", async () => {
    await projects()
    await webhook(textUpdate('/tasks DEFENCE'))
    expect(lastText()).toBe('Thesis defence: 1 open task, 0.5 h.\nDo next\n- Slides (0.5 h)')
    expect(lastButtons()).toEqual([[{ text: 'Open Pam', url: 'https://pam.example/projects/defence' }]])
  })

  it('/tasks offers a button per project when several match, which sends its tasks', async () => {
    const session = await projects()
    await webhook(textUpdate('/tasks thesis'))
    expect(lastText()).toBe('2 projects match "thesis". Which one?')
    expect(lastButtons()).toEqual([
      [{ text: 'Thesis', callback_data: 'tp:thesis' }],
      [{ text: 'Thesis defence', callback_data: 'tp:defence' }],
      ...dashboard,
    ])

    bot.calls = []
    await webhook(pressUpdate('tp:thesis'))
    expect(bot.calls.map((c) => c.method)).toEqual(['answerCallbackQuery', 'sendMessage'])
    expect(lastText()).toBe('Thesis: 2 open tasks, 3.5 h.\nDo next\n- Intro (1.5 h)\n- Method (2 h, no estimate)')

    // A project archived or deleted since only gets a note
    await call('DELETE', 'projects/thesis', undefined, session)
    await webhook(pressUpdate('tp:thesis'))
    expect(lastText()).toBe('That project is no longer open in Pam.')
  })

  it('/tasks lists the projects when nothing matches, and says how to use it with no text', async () => {
    await projects()
    await webhook(textUpdate('/tasks garden'))
    expect(lastText()).toBe('No project matches "garden". Your projects:\n- Thesis\n- Thesis defence')
    expect(lastButtons()).toEqual(dashboard)
    await webhook(textUpdate('/tasks'))
    expect(lastText()).toBe("Send /tasks and part of a project's name, such as /tasks thesis.")
  })

  it('/late lists exactly the tasks the brief counts as late', async () => {
    const session = await linkedAccount()
    await saveTask(session, 'big', { name: 'Big', dueDate: inDays(1), effortMinutes: 40 * 60 })
    await saveTask(session, 'small', { name: 'Small', dueDate: inDays(30), effortMinutes: 60 })
    const forecast = await forecastOf(session)
    const late = forecast.tasks.filter((t) => t.late)
    expect(late.map((t) => t.taskId)).toEqual(['big'])

    await webhook(textUpdate('/late'))
    const lines = lastText().split('\n')
    expect(lines[0]).toBe(forecast.brief.parts.find((p) => p.code === 'late_tasks')!.text)
    expect(lines.slice(1)).toEqual(late.map((t, i) => expect.stringMatching(new RegExp(`^${i + 1}\\. ${t.name}: deadline ${t.deadline} \\(\\w+\\), projected ${t.finish} \\(\\w+\\)\\.$`))))
    expect(lastButtons()).toEqual([[{ text: 'Open Pam', url: 'https://pam.example/tasks/big' }]])
  })

  it('/offtrack lists the projects that are tight or behind', async () => {
    const session = await linkedAccount()
    await saveTask(session, 'big', { name: 'Big', effortMinutes: 60 * 60 })
    await saveTask(session, 'small', { name: 'Small', effortMinutes: 60 })
    await saveProject(session, 'late', { name: 'Late', deliveryDate: inDays(2), taskIds: ['big'] })
    await saveProject(session, 'fine', { name: 'Fine', deliveryDate: inDays(60), taskIds: ['small'] })
    const forecast = await forecastOf(session)
    const late = forecast.projects.find((p) => p.projectId === 'late')!
    expect(late.pace).toBe('behind')

    await webhook(textUpdate('/offtrack'))
    expect(lastText()).toMatch(
      new RegExp(`^1 project is off track:\\n1\\. Late: Behind, projected ${late.finish} \\(\\w+\\), delivery ${inDays(2)} \\(\\w+\\)\\.$`),
    )
    expect(lastButtons()).toEqual([[{ text: 'Open Pam', url: 'https://pam.example/projects/late' }]])
  })

  it('/quickwins lists the visible tasks of an hour or less, leaving out the 2-hour default', async () => {
    const session = await linkedAccount()
    await saveTask(session, 'a', { name: 'Email', effortMinutes: 30, dueDate: inDays(1) })
    await saveTask(session, 'b', { name: 'Call', effortMinutes: 60, dueDate: inDays(2) })
    await saveTask(session, 'c', { name: 'Essay', effortMinutes: 90 })
    await saveTask(session, 'd', { name: 'Unsized' })
    await webhook(textUpdate('/quickwins'))
    expect(lastText()).toMatch(/^Quick wins: 2 tasks, 1\.5 h in all\.\n1\. Email \(0\.5 h\)\. .*\n2\. Call \(1 h\)\. /)
    expect(lastButtons()).toEqual(dashboard)
  })

  it('stores the text it gets the hint for, with the chat, account and time, and keeps it after unlinking', async () => {
    const session = await linkedAccount()
    const before = new Date().toISOString()
    for (const text of ['what is due friday?', '/unknown', '/next@SomeOtherBot']) await webhook(textUpdate(text))
    // A command it knows, even used wrongly, and a message with no text aren't stored
    await webhook(textUpdate('/tasks'))
    await webhook({ update_id: nextUpdateId++, message: { message_id: 2, date: 0, chat: { id: CHAT, type: 'private' }, photo: [] } })

    const rows = async () =>
      (await env.DB.prepare('SELECT user_id, chat_id, text, at FROM telegram_unrecognised ORDER BY id').all<Record<string, string | number>>()).results
    const userId = await env.DB.prepare('SELECT user_id FROM telegram_links WHERE chat_id = ?1').bind(CHAT).first<string>('user_id')
    const stored = await rows()
    expect(stored.map((r) => [r.user_id, r.chat_id, r.text])).toEqual([
      [userId, CHAT, 'what is due friday?'],
      [userId, CHAT, '/unknown'],
      [userId, CHAT, '/next@SomeOtherBot'],
    ])
    for (const row of stored) expect(row.at >= before && row.at <= new Date().toISOString()).toBe(true)
    expect(sent().slice(0, 3)).toEqual(Array(3).fill([CHAT, 'To add a task, send /add and its name. /help lists everything else.']))

    expect((await call('DELETE', 'telegram', undefined, session)).status).toBe(204)
    expect(await rows()).toHaveLength(3)
  })

  it('still sends the hint when storing the text fails, logging the failure', async () => {
    await linkedAccount()
    // Taken away for this test only, so the insert fails
    await env.DB.prepare('ALTER TABLE telegram_unrecognised RENAME TO telegram_unrecognised_away').run()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await webhook(textUpdate('hello'))
    } finally {
      await env.DB.prepare('ALTER TABLE telegram_unrecognised_away RENAME TO telegram_unrecognised').run()
    }
    expect(sent()).toEqual([[CHAT, 'To add a task, send /add and its name. /help lists everything else.']])
    expect(errors).toHaveBeenCalledWith('Storing unrecognised Telegram text failed:', expect.stringContaining('telegram_unrecognised'))
  })
})

describe('history and usage', () => {
  const tasksOf = async (session: string): Promise<Task[]> => (await call('GET', 'tasks', undefined, session)).body

  // The webhook straight through the Worker's fetch, waiting for the counts it leaves running
  async function webhookWaiting(update: unknown) {
    const ctx = createExecutionContext()
    const request = new Request('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': SECRET },
      body: JSON.stringify(update),
    })
    const response = await worker.fetch(request as Request<unknown, IncomingRequestCfProperties>, env as unknown as Env, ctx)
    await waitOnExecutionContext(ctx)
    return response.status
  }

  // The bot's counts for the account; the routes the test used to set it up count as from the web
  const botCounts = async () =>
    (
      await env.DB.prepare("SELECT action, count FROM usage_counts WHERE client = 'telegram' ORDER BY action").all<{ action: string; count: number }>()
    ).results.map((r) => [r.action, r.count])

  const sources = async (table: string) =>
    (await env.DB.prepare('SELECT op, source FROM history WHERE table_name = ?1 ORDER BY id').bind(table).all()).results

  it("logs the bot's changes to history as from telegram", async () => {
    const session = await linkedAccount()
    await webhookWaiting(textUpdate('/add Buy milk'))
    const [task] = await tasksOf(session)
    await webhookWaiting(pressUpdate(`p:high:${task!.id}`))
    await webhookWaiting(pressUpdate(`d:${task!.id}`))
    expect(await sources('tasks')).toEqual([
      { op: 'insert', source: 'telegram' },
      { op: 'update', source: 'telegram' },
      { op: 'update', source: 'telegram' },
    ])
  })

  it('counts the commands and buttons that do something, and not lookups or presses that change nothing', async () => {
    const session = await linkedAccount()
    await call('PUT', 'tasks/a', { task: { ...createEmptyTask(), id: 'a', name: 'Alpha' } }, session)

    for (const text of ['/next', '/today', '/help', '/tasks', '/late', '/offtrack', 'hello']) await webhookWaiting(textUpdate(text))
    await webhookWaiting(pressUpdate('next:2'))
    expect(await botCounts()).toEqual([])

    await webhookWaiting(textUpdate('/add Buy milk'))
    const added = (await tasksOf(session)).find((t) => t.name === 'Buy milk')!
    await webhookWaiting(textUpdate('/desc From the shop'))
    await webhookWaiting(pressUpdate(`p:high:${added.id}`))
    await webhookWaiting(pressUpdate(`due:today:${added.id}`))
    await webhookWaiting(pressUpdate(`e:30:${added.id}`))
    await webhookWaiting(pressUpdate('nt:a'))
    await webhookWaiting(pressUpdate('d:a'))
    await webhookWaiting(pressUpdate('d:a')) // already done: only a note
    await webhookWaiting(pressUpdate('d:gone')) // no such task
    await webhookWaiting(textUpdate('/add')) // no name: only how to use it
    await webhookWaiting(textUpdate('/brief'))
    await webhookWaiting(textUpdate('/quickwins'))
    await webhookWaiting(textUpdate('/stop'))

    expect(await botCounts()).toEqual([
      ['bot_brief', 1],
      ['bot_quickwins', 1],
      ['bot_stop', 1],
      ['quick_action_due', 1],
      ['quick_action_estimate', 1],
      ['quick_action_not_today', 1],
      ['quick_action_priority', 1],
      ['task_complete', 1],
      ['task_create', 1],
      ['task_edit', 1],
    ])
  })

  it("doesn't count the scheduled brief", async () => {
    await linkedAccount()
    // Every quarter hour of a day, so the brief is sent at one of them
    for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
      await worker.scheduled(createScheduledController({ scheduledTime: Date.now() + minutes * 60_000 }), env as unknown as Env)
    }
    expect(sent().length).toBeGreaterThan(0)
    expect(await botCounts()).toEqual([])
  })
})
