// Integration tests for the Telegram bot's linking (worker/pamBot/), through the Worker's entry
// point and a real D1 database. fetch is replaced by a fake Bot API that records each call, so
// nothing reaches Telegram.
import { createExecutionContext, env, SELF, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
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

let bot: { calls: BotCall[]; fail: boolean }

beforeEach(() => {
  bot = { calls: [], fail: false }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    const prefix = `https://api.telegram.org/bot${TOKEN}/`
    if (!url.startsWith(prefix)) throw new Error(`Unexpected fetch: ${url}`)
    bot.calls.push({ method: url.slice(prefix.length), body: JSON.parse(String(init!.body)) })
    if (bot.fail) return Response.json({ ok: false, error_code: 400, description: 'Bad Request: chat not found' }, { status: 400 })
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
    await webhook({ update_id: nextUpdateId++, callback_query: { id: 'q', from: { id: CHAT }, data: 'x' } })

    expect(bot.calls).toEqual([])
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
