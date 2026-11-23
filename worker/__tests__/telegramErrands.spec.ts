// Integration tests for errands in the Telegram bot (worker/pamBot/): /errand and /errands, the
// Errands button, Done under an errand, the carried-over errands after the morning brief with their
// Today, Tomorrow, Pick date and Drop buttons, and reading a picked date. Through the Worker's entry
// point and a real D1 database, with fetch replaced by a fake Bot API, as in telegram.spec.ts.
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyTask, type Task } from '../../src/types/task'
import worker from '../index'
import { localDateTime } from '../pamBot/schedule'
import { call, signUp } from './helpers'

const TOKEN = '123456:test-bot-token'
const SECRET = 'test-webhook-secret'
const ZONE = 'Asia/Singapore'
const CHAT = 1001

interface BotCall {
  method: string
  body: Record<string, unknown>
}
let bot: { calls: BotCall[] }

beforeEach(() => {
  bot = { calls: [] }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    const prefix = `https://api.telegram.org/bot${TOKEN}/`
    if (!url.startsWith(prefix)) throw new Error(`Unexpected fetch: ${url}`)
    bot.calls.push({ method: url.slice(prefix.length), body: JSON.parse(String(init!.body)) })
    return Response.json({ ok: true, result: { message_id: bot.calls.length } })
  })
})

afterEach(() => vi.restoreAllMocks())

const sent = () => bot.calls.filter((c) => c.method === 'sendMessage').map((c) => c.body)
const edited = () => bot.calls.filter((c) => c.method === 'editMessageText').map((c) => c.body)

let nextUpdateId = 900
const textUpdate = (text: string) => ({
  update_id: nextUpdateId++,
  message: { message_id: 1, date: 0, chat: { id: CHAT, type: 'private' }, from: { id: CHAT }, text },
})
let nextQueryId = 1
const pressUpdate = (data: string, message: { text: string; buttons: unknown[][] }) => ({
  update_id: nextUpdateId++,
  callback_query: {
    id: `query-${nextQueryId++}`,
    from: { id: CHAT },
    data,
    message: {
      message_id: 77,
      date: 1_763_000_000,
      chat: { id: CHAT, type: 'private' },
      text: message.text,
      reply_markup: { inline_keyboard: message.buttons },
    },
  },
})

// The webhook through the Worker's fetch, waiting for the usage counts it leaves running
async function webhook(update: unknown) {
  const ctx = createExecutionContext()
  const request = new Request('http://localhost/api/telegram/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': SECRET },
    body: JSON.stringify(update),
  })
  const response = await worker.fetch(request as Request<unknown, IncomingRequestCfProperties>, env as unknown as Env, ctx)
  await waitOnExecutionContext(ctx)
  expect(response.status).toBe(200)
}

async function linkedAccount() {
  const session = await signUp()
  const { code } = (await call('POST', 'telegram/link-code', { timeZone: ZONE }, session)).body
  await webhook(textUpdate(`/start ${code}`))
  bot.calls = []
  return session
}

const today = () => localDateTime(new Date(), ZONE).date
const inDays = (days: number, from = today()) => new Date(Date.parse(`${from}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
const saveErrand = (session: string, id: string, fields: Partial<Task> = {}) =>
  call('PUT', `tasks/${id}`, { task: { ...createEmptyTask(), id, name: id, kind: 'errand', pinnedDate: today(), ...fields } }, session)
const tasksOf = async (session: string): Promise<Task[]> => (await call('GET', 'tasks', undefined, session)).body
const taskOf = async (session: string, id: string) => (await tasksOf(session)).find((t) => t.id === id)
const botCounts = async () =>
  (
    await env.DB.prepare("SELECT action, count FROM usage_counts WHERE client = 'telegram' ORDER BY action").all<{ action: string; count: number }>()
  ).results.map((r) => [r.action, r.count])

// The buttons a carried-over errand's message has
const carriedButtons = (id: string) => [
  [
    { text: 'Today', callback_data: `pl:today:${id}` },
    { text: 'Tomorrow', callback_data: `pl:tomorrow:${id}` },
    { text: 'Pick date', callback_data: `pk:${id}` },
    { text: 'Drop', callback_data: `dr:${id}` },
  ],
]

describe('/errand and /errands', () => {
  it('adds an errand for the chat’s today, and lists today’s errands with a Done button each', async () => {
    const session = await linkedAccount()
    await webhook(textUpdate('/errand   Buy milk '))
    const [added] = await tasksOf(session)
    expect(added).toMatchObject({ name: 'Buy milk', kind: 'errand', pinnedDate: today(), priority: 'medium' })
    expect(sent()[0]!.text).toBe('Added an errand for today: Buy milk')

    await saveErrand(session, 'old', { name: 'Post parcel', pinnedDate: inDays(-2), effortMinutes: 15 })
    await saveErrand(session, 'later', { pinnedDate: inDays(1) })
    bot.calls = []
    await webhook(textUpdate('/errands'))
    expect(sent()[0]).toMatchObject({
      text: ["Today's errands:", '1. Post parcel (15 m), planned 2 days ago', '2. Buy milk (30 m)'].join('\n'),
      reply_markup: {
        inline_keyboard: [
          [{ text: '1 Done', callback_data: 'ed:old' }],
          [{ text: '2 Done', callback_data: `ed:${added!.id}` }],
          [{ text: 'Open Pam', url: expect.any(String) }],
        ],
      },
    })
    expect(await botCounts()).toEqual([['errand_create', 1]])
  })

  it('asks for a name', async () => {
    await linkedAccount()
    await webhook(textUpdate('/errand'))
    expect(sent()[0]!.text).toBe("Send /errand and the errand's name, such as /errand Buy milk.")
  })

  it('ticks an errand off with Done, notes it on the list and takes its button away, without sending tasks', async () => {
    const session = await linkedAccount()
    await saveErrand(session, 'e', { name: 'Groceries', recurrence: 'daily' })
    const list = { text: "Today's errands:\n1. Groceries (30 m)", buttons: [[{ text: '1 Done', callback_data: 'ed:e' }]] }
    await webhook(pressUpdate('ed:e', list))
    expect((await taskOf(session, 'e'))!.completed).toBe(true)
    // A recurring one makes its next one, as in the app
    expect((await tasksOf(session)).map((t) => [t.name, t.pinnedDate, t.completed])).toEqual([
      ['Groceries', today(), true],
      ['Groceries', inDays(1), false],
    ])
    expect(edited()[0]).toMatchObject({ text: `${list.text}\nDone: Groceries`, reply_markup: { inline_keyboard: [] } })
    expect(sent()).toEqual([])
    expect(await botCounts()).toEqual([['errand_complete', 1]])
  })
})

describe('the Errands button', () => {
  it('is beside Open Pam under /today when there are errands today, and lists them', async () => {
    const session = await linkedAccount()
    await webhook(textUpdate('/today'))
    expect(JSON.stringify(sent()[0]!.reply_markup)).not.toContain('er:today')

    await saveErrand(session, 'e', { name: 'Groceries' })
    bot.calls = []
    await webhook(textUpdate('/today'))
    const rows = (sent()[0]!.reply_markup as { inline_keyboard: { text: string; callback_data?: string }[][] }).inline_keyboard
    expect(rows[rows.length - 1]!.map((b) => b.text)).toEqual(['Errands (1)', 'Open Pam'])

    bot.calls = []
    await webhook(pressUpdate('er:today', { text: 'Today', buttons: rows }))
    expect(sent()[0]!.text).toBe("Today's errands:\n1. Groceries (30 m)")
  })
})

describe('carried-over errands after the morning brief', () => {
  // Monday 16 November 2026 at 07:30 in Singapore
  const MONDAY_0730 = '2026-11-15T23:30:00Z'
  const MONDAY = '2026-11-16'

  it('come one message each after the brief, with Today, Tomorrow, Pick date and Drop; errands planned for today do not', async () => {
    const session = await linkedAccount()
    await saveErrand(session, 'a', { name: 'Groceries', pinnedDate: '2026-11-14' })
    await saveErrand(session, 'b', { name: 'Pay bill', pinnedDate: '2026-11-15', effortMinutes: 60 })
    await saveErrand(session, 'c', { name: 'Haircut', pinnedDate: MONDAY })
    await worker.scheduled(createScheduledController({ scheduledTime: new Date(MONDAY_0730), cron: '*/15 * * * *' }), env as unknown as Env)

    const messages = sent()
    expect(messages).toHaveLength(3)
    expect(JSON.stringify(messages[0]!.reply_markup)).toContain('Errands (3)')
    expect(messages.slice(1)).toMatchObject([
      { chat_id: CHAT, text: 'Carried over: Groceries (30 m), planned 2 days ago', reply_markup: { inline_keyboard: carriedButtons('a') } },
      { chat_id: CHAT, text: 'Carried over: Pay bill (1 h), planned yesterday', reply_markup: { inline_keyboard: carriedButtons('b') } },
    ])
  })
})

describe('the buttons under a carried-over errand', () => {
  const message = (id: string) => ({ text: `Carried over: ${id} (30 m), planned 2 days ago`, buttons: carriedButtons(id) })

  it('Today plans it for today, so it is not asked about again, and notes it', async () => {
    const session = await linkedAccount()
    await saveErrand(session, 'e', { pinnedDate: inDays(-2) })
    await webhook(pressUpdate('pl:today:e', message('e')))
    expect((await taskOf(session, 'e'))!.pinnedDate).toBe(today())
    expect(edited()[0]).toMatchObject({ text: `${message('e').text}\nPlanned: e, today`, reply_markup: { inline_keyboard: [] } })
    expect(await botCounts()).toEqual([['errand_reschedule', 1]])
  })

  it('Tomorrow plans it for tomorrow', async () => {
    const session = await linkedAccount()
    await saveErrand(session, 'e', { pinnedDate: inDays(-2) })
    await webhook(pressUpdate('pl:tomorrow:e', message('e')))
    expect((await taskOf(session, 'e'))!.pinnedDate).toBe(inDays(1))
  })

  it('Tomorrow is refused for an errand due today, which can’t be planned after it’s due', async () => {
    const session = await linkedAccount()
    await saveErrand(session, 'e', { pinnedDate: inDays(-2), dueDate: today() })
    await webhook(pressUpdate('pl:tomorrow:e', message('e')))
    expect((await taskOf(session, 'e'))!.pinnedDate).toBe(inDays(-2))
    expect(sent()[0]!.text).toBe(`"e" is planned for ${inDays(1)}, after it's due (${today()})`)
    expect(await botCounts()).toEqual([])
  })

  it('Drop deletes it, and only that one', async () => {
    const session = await linkedAccount()
    await saveErrand(session, 'e', { pinnedDate: inDays(-2) })
    await saveErrand(session, 'keep')
    await webhook(pressUpdate('dr:e', message('e')))
    expect((await tasksOf(session)).map((t) => t.id)).toEqual(['keep'])
    expect(edited()[0]).toMatchObject({ text: `${message('e').text}\nDropped: e` })
    expect(await botCounts()).toEqual([['errand_drop', 1]])
    // Logged as the bot's delete
    const deleted = await env.DB.prepare("SELECT source FROM history WHERE row_key = 'e' AND op = 'delete'").first('source')
    expect(deleted).toBe('telegram')
  })

  it('Drop leaves a project task alone', async () => {
    const session = await linkedAccount()
    await call('PUT', 'tasks/t', { task: { ...createEmptyTask(), id: 't', name: 'Thesis' } }, session)
    await webhook(pressUpdate('dr:t', message('t')))
    expect(await taskOf(session, 't')).toBeDefined()
    expect(sent()[0]!.text).toBe('"Thesis" is a project task, not an errand.')
  })

  it('Pick date asks for the date in YYYY-MM-DD, and reads the next message as it', async () => {
    const session = await linkedAccount()
    await saveErrand(session, 'e', { name: 'Groceries', pinnedDate: inDays(-2) })
    await webhook(pressUpdate('pk:e', message('e')))
    expect(sent()[0]!.text).toBe(`Which day for "Groceries"? Send the date as YYYY-MM-DD, e.g. ${today()}. Any command cancels.`)

    // Anything that isn't a date today or later asks again, and changes nothing
    for (const reply of ['next friday', '2026-02-30', inDays(-1)]) {
      bot.calls = []
      await webhook(textUpdate(reply))
      expect(sent()[0]!.text).toBe(
        `That isn't a date I can read. Send it as YYYY-MM-DD, e.g. ${today()}, today or later. Any command cancels.`,
      )
    }
    expect((await taskOf(session, 'e'))!.pinnedDate).toBe(inDays(-2))

    bot.calls = []
    await webhook(textUpdate(` ${inDays(5)} `))
    expect((await taskOf(session, 'e'))!.pinnedDate).toBe(inDays(5))
    expect(sent()[0]!.text).toMatch(new RegExp(`^Planned: Groceries, ${inDays(5)} \\(\\w+day\\)$`))
    expect(await botCounts()).toEqual([['errand_reschedule', 1]])

    // Done with: the next text is a hint again, not a date
    bot.calls = []
    await webhook(textUpdate(inDays(6)))
    expect((await taskOf(session, 'e'))!.pinnedDate).toBe(inDays(5))
    expect(sent()[0]!.text).toContain('/errand')
  })

  it('Pick date is cancelled by a command, which is handled as usual', async () => {
    const session = await linkedAccount()
    await saveErrand(session, 'e', { pinnedDate: inDays(-2) })
    await webhook(pressUpdate('pk:e', message('e')))
    bot.calls = []
    await webhook(textUpdate('/errands'))
    expect(sent()[0]!.text).toContain("Today's errands:")
    bot.calls = []
    await webhook(textUpdate(inDays(3)))
    expect((await taskOf(session, 'e'))!.pinnedDate).toBe(inDays(-2))
  })

  it('Pick date says so when the errand has gone by the time the date comes', async () => {
    const session = await linkedAccount()
    await saveErrand(session, 'e', { pinnedDate: inDays(-2) })
    await webhook(pressUpdate('pk:e', message('e')))
    await call('DELETE', 'tasks/e', undefined, session)
    bot.calls = []
    await webhook(textUpdate(inDays(3)))
    expect(sent()[0]!.text).toBe('That task is no longer in Pam.')
  })
})
