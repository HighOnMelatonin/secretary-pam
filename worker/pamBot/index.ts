// The Telegram companion bot (docs/telegram-bot.md), inside the main Worker. Its routes:
//
//   GET    /api/telegram           -> TelegramStatus (src/types/telegram.ts)
//   POST   /api/telegram/link-code -> { timeZone }: a one-time code and its t.me link, for 10 minutes
//   PUT    /api/telegram           -> { timeZone, briefMinutes, enabled }: the brief preferences
//   DELETE /api/telegram           -> unlinks the chat; 204
//   POST   /api/telegram/webhook   -> where Telegram sends updates; handled before the session check
//
// and the morning brief (brief.ts), which the Worker's scheduled handler sends.
//
// A linked chat can send /next, /today, /brief, /stop and /help, and press the buttons under the
// tasks: Done, Not today and Next. It can add a task with /add, set its priority, due date and
// estimate with the buttons under the reply, and describe it with /desc. Every change goes through
// the app's own planners (src/types/operations.ts) and its save (PamData.save), logged with the
// source 'telegram'.
//
// Without TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_BOT_USERNAME and APP_ORIGIN the bot
// is off and every one of these answers 404.
//
// The webhook only trusts a request whose X-Telegram-Bot-Api-Secret-Token header is the secret given
// to setWebhook. It answers 200 to every such request, even when handling the update fails, so
// Telegram doesn't send it again and again; the failure is logged instead (never the token).
import { forecast } from '../../src/types/forecast'
import { MAX_DESCRIPTION_LENGTH, MAX_NAME_LENGTH } from '../../src/types/limits'
import { ActionRefused, planTaskAction, planTaskSave, type Changes, type Plan, type State } from '../../src/types/operations'
import { prioritise } from '../../src/types/priority'
import type { Project } from '../../src/types/project'
import { clampStartDate } from '../../src/types/rules'
import type { UserSettings } from '../../src/types/settings'
import { createEmptyTask, type Task } from '../../src/types/task'
import { BRIEF_STEP_MINUTES, MINUTES_PER_DAY, deepLink, isTimeZone, type TelegramPreferences } from '../../src/types/telegram'
import { HttpError, type User } from '../auth'
import {
  answerCallbackQuery,
  editMessageText,
  sendMessage,
  type OutgoingMessage,
  type TelegramCallbackQuery,
  type TelegramUpdate,
} from './botApi'
import {
  claimUpdate,
  createLinkCode,
  deleteLink,
  isLinked,
  linkOf,
  savePreferences,
  setLastAdded,
  statusOf,
  stopBrief,
  useLinkCode,
  type Link,
} from './links'
import {
  addedMessage,
  addUsage,
  alreadyDoneNote,
  badCodeMessage,
  briefMessage,
  decodePress,
  describedMessage,
  descriptionTooLong,
  descUsage,
  doneLine,
  goneNote,
  helpMessage,
  hintMessage,
  linkedMessage,
  markTask,
  nameTooLong,
  nextMessage,
  noTaskToDescribe,
  notTodayLine,
  parseCommand,
  startCode,
  stoppedMessage,
  todayMessage,
  unlinkedMessage,
  type ButtonPress,
} from './messages'
import { dueDateFor, localDateTime } from './schedule'

export interface BotConfig {
  token: string
  webhookSecret: string
  username: string
  origin: string // APP_ORIGIN, for links to Pam's pages
}

// The user's data, read and saved the way the rest of the Worker does it (worker/index.ts passes
// this in, so the bot never has queries of its own for tasks, projects or settings)
export interface PamData {
  load(db: D1Database, userId: string): Promise<{ tasks: Task[]; projects: Project[]; settings: UserSettings }>
  // saveWithRules: plans the change against the stored tasks and projects, then writes it. Throws
  // what the plan throws, or an HttpError when the save refuses it (a clash or a blocking loop).
  save(db: D1Database, userId: string, plan: (state: State) => Plan): Promise<Changes>
}

// The bot's settings, or null when any is missing and the bot is off
export function botConfig(env: Env): BotConfig | null {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_WEBHOOK_SECRET: webhookSecret, TELEGRAM_BOT_USERNAME: username, APP_ORIGIN } = env
  if (!token || !webhookSecret || !username || !APP_ORIGIN) return null
  return { token, webhookSecret, username: username.replace(/^@/, ''), origin: new URL(APP_ORIGIN).origin }
}

// An update is small; anything bigger isn't from Telegram
const MAX_UPDATE_BYTES = 1_000_000

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new HttpError(400, message)
}

// Signed-in routes

// action is what follows /api/telegram/ in the path: undefined or 'link-code'
export async function handleTelegram(
  env: Env,
  ctx: ExecutionContext,
  config: BotConfig,
  request: Request,
  user: User,
  action: string | undefined,
  readBody: () => Promise<unknown>,
): Promise<Response> {
  const db = env.DB
  if (action === 'link-code') {
    if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed')
    const body = await readBody()
    check(isObject(body) && Object.keys(body).length === 1 && isTimeZone(body.timeZone), 'Body must be { timeZone }, an IANA time zone such as "Europe/London"')
    const { code, expiresAt } = await createLinkCode(db, user.id, body.timeZone)
    return Response.json({ code, url: deepLink(config.username, code), expiresAt })
  }
  if (action !== undefined) throw new HttpError(404, 'Not found')

  if (request.method === 'GET') return Response.json(statusOf(await linkOf(db, user.id), config.username))
  if (request.method === 'PUT') {
    const link = await savePreferences(db, user.id, parsePreferences(await readBody()))
    if (!link) throw new HttpError(409, 'This account isn’t linked to a Telegram chat')
    return Response.json(statusOf(link, config.username))
  }
  if (request.method === 'DELETE') {
    const chatId = await deleteLink(db, user.id)
    // Telling the chat can wait until after the answer, and its failure doesn't undo the unlink
    if (chatId !== null) {
      ctx.waitUntil(sendMessage(config.token, chatId, unlinkedMessage(config.origin)).catch((e) => console.error(String(e))))
    }
    return new Response(null, { status: 204 })
  }
  throw new HttpError(405, 'Method not allowed')
}

function parsePreferences(body: unknown): TelegramPreferences {
  const fields = ['timeZone', 'briefMinutes', 'enabled']
  check(
    isObject(body) && Object.keys(body).length === fields.length && fields.every((f) => f in body),
    'Body must be { timeZone, briefMinutes, enabled }',
  )
  const { timeZone, briefMinutes, enabled } = body
  check(isTimeZone(timeZone), 'timeZone must be an IANA time zone such as "Europe/London"')
  // On the quarter hour, since the brief is checked every 15 minutes
  check(
    Number.isInteger(briefMinutes) &&
      (briefMinutes as number) >= 0 &&
      (briefMinutes as number) < MINUTES_PER_DAY &&
      (briefMinutes as number) % BRIEF_STEP_MINUTES === 0,
    `briefMinutes must be minutes after midnight on the quarter hour, from 0 to ${MINUTES_PER_DAY - BRIEF_STEP_MINUTES}`,
  )
  check(typeof enabled === 'boolean', 'enabled must be true or false')
  return { timeZone, briefMinutes: briefMinutes as number, enabled }
}

// The webhook

// Compares the header with the secret in constant time. Both are hashed first, so they're the same
// length and the comparison doesn't give away the secret's length either.
async function secretMatches(header: string | null, secret: string) {
  if (header === null) return false
  const digest = (text: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  const [a, b] = await Promise.all([digest(header), digest(secret)])
  return crypto.subtle.timingSafeEqual(a, b)
}

export async function handleWebhook(env: Env, config: BotConfig, data: PamData, request: Request): Promise<Response> {
  if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed')
  if (!(await secretMatches(request.headers.get('X-Telegram-Bot-Api-Secret-Token'), config.webhookSecret))) {
    throw new HttpError(401, 'Unauthorized')
  }
  try {
    const text = await request.text()
    const update: unknown = text.length <= MAX_UPDATE_BYTES ? JSON.parse(text) : null
    if (isObject(update) && Number.isInteger(update.update_id)) await handleUpdate({ db: env.DB, config, data }, update as unknown as TelegramUpdate, new Date())
  } catch (e) {
    console.error('Handling a Telegram update failed:', String(e))
  }
  return new Response(null, { status: 200 })
}

// What handling an update needs
interface Bot {
  db: D1Database
  config: BotConfig
  data: PamData
}

// Only private chats are answered. A linked chat's update is handled once, in order: one no newer
// than the last handled is a repeat and is skipped. An unlinked chat is ignored, apart from
// "/start <code>", which links it. `now` is the only clock: the chat's local date comes from it.
async function handleUpdate(bot: Bot, update: TelegramUpdate, now: Date) {
  if (update.callback_query) return handleButton(bot, update.update_id, update.callback_query, now)
  const { db, config } = bot
  const message = update.message
  if (!message || message.chat?.type !== 'private' || !Number.isInteger(message.chat.id)) return
  const chatId = message.chat.id

  const link = await claimUpdate(db, chatId, update.update_id)
  if (!link && (await isLinked(db, chatId))) return // already handled

  const code = startCode(message.text)
  if (code) {
    const linked = await useLinkCode(db, code, chatId, update.update_id)
    const reply = linked
      ? linkedMessage(config.origin, { email: linked.email, timeZone: linked.link.timeZone, briefMinutes: linked.link.briefMinutes })
      : badCodeMessage(config.origin)
    await sendMessage(config.token, chatId, reply)
    return
  }
  if (!link) return
  await handleCommand(bot, link, message.text, now)
}

// The user's priorities for their local today, and the forecast from them when it's needed
async function planning({ db, data }: Bot, link: Link, now: Date) {
  const today = localDateTime(now, link.timeZone).date
  const { tasks, projects, settings } = await data.load(db, link.userId)
  const priorities = prioritise(tasks, projects, settings, today)
  return { priorities, forecast: () => forecast(tasks, projects, settings, today, priorities) }
}

// /next, /today, /brief, /stop, /add, /desc and /help (and a bare /start). Any other text gets a
// one-line hint.
async function handleCommand(bot: Bot, link: Link, text: string | undefined, now: Date) {
  const { config } = bot
  const send = (message: OutgoingMessage) => sendMessage(config.token, link.chatId, message)
  const command = parseCommand(text, config.username)
  switch (command?.command) {
    case 'next':
      await send(nextMessage(config.origin, (await planning(bot, link, now)).priorities))
      return
    case 'today':
      await send(todayMessage(config.origin, (await planning(bot, link, now)).forecast()))
      return
    case 'brief': {
      // Sent whenever it's asked for, so it doesn't count as the day's brief
      const { priorities, forecast } = await planning(bot, link, now)
      await send(briefMessage(config.origin, priorities, forecast()))
      return
    }
    case 'stop':
      await stopBrief(bot.db, link.chatId)
      await send(stoppedMessage(config.origin))
      return
    case 'add':
      await send(await addTask(bot, link, command!.args))
      return
    case 'desc':
      await send(await describeTask(bot, link, command!.args))
      return
    case 'help':
    case 'start':
      await send(helpMessage(config.origin))
      return
    default:
      // Any other text, which never makes a task. A photo or sticker has no text and gets nothing.
      if (text !== undefined) await send(hintMessage)
  }
}

// /add <name>: a task with the defaults (medium priority, no dates, no estimate, no project),
// remembered as the chat's last added for /desc
async function addTask({ db, config, data }: Bot, link: Link, args: string): Promise<OutgoingMessage> {
  const name = args.trim()
  if (!name) return addUsage
  if (name.length > MAX_NAME_LENGTH) return nameTooLong(MAX_NAME_LENGTH)
  const task = { ...createEmptyTask(), name }
  try {
    await data.save(db, link.userId, (state) => planTaskSave(state, { task }, 'telegram'))
  } catch (e) {
    if (e instanceof HttpError && e.status < 500) return { text: e.message }
    throw e
  }
  await setLastAdded(db, link.chatId, task.id)
  return addedMessage(config.origin, task)
}

// /desc <text>: replaces the description of the task the chat last added with /add
async function describeTask(bot: Bot, link: Link, args: string): Promise<OutgoingMessage> {
  const description = args.trim()
  if (!description) return descUsage
  if (description.length > MAX_DESCRIPTION_LENGTH) return descriptionTooLong(MAX_DESCRIPTION_LENGTH)
  if (!link.lastAddedTaskId) return noTaskToDescribe
  const outcome = await changeTask(
    bot,
    link,
    link.lastAddedTaskId,
    (state, task) => (task.description === description ? null : planTaskSave(state, { task: { ...task, description } }, 'telegram')),
    { openOnly: false }, // a description can go on a task that's been ticked off since
  )
  return outcome.kind === 'changed' || outcome.kind === 'same' ? describedMessage(outcome.task.name) : outcome.reply
}

// Nothing was changed: the task was done or deleted since its message was sent (with what to say),
// or already had the value (reply null). Thrown from inside the plan, so the check is made against
// the data the save reads.
class Unchanged extends Error {
  constructor(readonly reply: OutgoingMessage | null) {
    super(reply?.text ?? 'No change')
    this.name = 'Unchanged'
  }
}

type Outcome =
  | { kind: 'changed'; task: Task } // as saved
  | { kind: 'same'; task: Task } // it already had the value
  | { kind: 'unchanged'; reply: OutgoingMessage } // the task was done or deleted already
  | { kind: 'refused'; reply: OutgoingMessage } // the planner or the save refused it

// One change to one task, planned by `change` against the stored data (null when the task already
// has the value). Unless openOnly is false, a task that's done is left alone, so no button ever
// reopens one.
async function changeTask(
  { db, data }: Bot,
  link: Link,
  taskId: string,
  change: (state: State, task: Task) => Plan | null,
  { openOnly = true } = {},
): Promise<Outcome> {
  let current: Task | undefined
  try {
    const changes = await data.save(db, link.userId, (state) => {
      current = state.tasks.find((t) => t.id === taskId)
      if (!current) throw new Unchanged(goneNote)
      if (openOnly && current.completed) throw new Unchanged(alreadyDoneNote(current.name))
      const plan = change(state, current)
      if (!plan) throw new Unchanged(null)
      return plan
    })
    return { kind: 'changed', task: changes.tasks.find((t) => t.id === taskId)! }
  } catch (e) {
    if (e instanceof Unchanged) return e.reply ? { kind: 'unchanged', reply: e.reply } : { kind: 'same', task: current! }
    if (e instanceof ActionRefused) return { kind: 'refused', reply: { text: e.sentence.text } }
    if (e instanceof HttpError && e.status < 500) return { kind: 'refused', reply: { text: e.message } }
    throw e
  }
}

const doneChange = (state: State, task: Task) => planTaskSave(state, { task: { ...task, completed: true } }, 'telegram')

const notTodayChange = (today: string) => (state: State, task: Task) =>
  planTaskAction(state, task.id, { action: 'not_today', today }, 'telegram')

// What a button under an /add reply sets. The due date is worked out from the chat's local today
// when the button is pressed, and a start date it would pass moves back with it, as when a project
// moves a due date (the bot doesn't show start dates).
function fieldChange(press: Extract<ButtonPress, { action: 'priority' | 'due' | 'estimate' }>, today: string) {
  return (state: State, task: Task): Plan | null => {
    switch (press.action) {
      case 'priority':
        return task.priority === press.value ? null : planTaskSave(state, { task: { ...task, priority: press.value } }, 'telegram')
      case 'due': {
        const dueDate = dueDateFor(press.value, today)
        return task.dueDate === dueDate ? null : planTaskSave(state, { task: clampStartDate({ ...task, dueDate }) }, 'telegram')
      }
      case 'estimate':
        return task.effortMinutes === press.value
          ? null
          : planTaskAction(state, task.id, { action: 'estimate', effortMinutes: press.value }, 'telegram')
    }
  }
}

// A press of a button under one of the bot's messages. Telegram shows a spinner on the button until
// the press is answered, so every press is answered, even one that fails (with a note to try again).
async function handleButton(bot: Bot, updateId: number, query: TelegramCallbackQuery, now: Date) {
  const { db, config } = bot
  let answered = false
  const answer = async (text?: string) => {
    answered = true
    await answerCallbackQuery(config.token, query.id, text)
  }
  const message = query.message
  const chat = message?.chat
  if (!message || chat?.type !== 'private' || !Number.isInteger(chat.id)) return answer()

  const link = await claimUpdate(db, chat.id, updateId)
  if (!link) {
    if (await isLinked(db, chat.id)) return // already handled, and answered then
    return answer() // a button from before the chat was unlinked
  }
  const press = decodePress(query.data)
  if (!press) return answer()
  const send = (reply: OutgoingMessage) => sendMessage(config.token, link.chatId, reply)
  const sendNext = async (offset = 0) => send(nextMessage(config.origin, (await planning(bot, link, now)).priorities, offset))
  const today = localDateTime(now, link.timeZone).date

  try {
    if (press.action === 'next') {
      await answer()
      await sendNext(press.offset)
      return
    }
    if (press.action === 'priority' || press.action === 'due' || press.action === 'estimate') {
      const outcome = await changeTask(bot, link, press.taskId, fieldChange(press, today))
      await answer()
      if (outcome.kind === 'changed') await editMessage(bot, link, message, addedMessage(config.origin, outcome.task))
      else if (outcome.kind !== 'same') await send(outcome.reply)
      return
    }
    const outcome = await changeTask(bot, link, press.taskId, press.action === 'done' ? doneChange : notTodayChange(today))
    await answer()
    if (outcome.kind === 'unchanged') {
      await send(outcome.reply)
      return
    }
    if (outcome.kind === 'refused') await send(outcome.reply)
    else if (message.date !== 0 && message.text !== undefined) {
      // Notes what was done at the end of the message, and takes the task's buttons away
      const line = (press.action === 'done' ? doneLine : notTodayLine)(outcome.task.name)
      const marked = markTask({ text: message.text, buttons: message.reply_markup?.inline_keyboard ?? [] }, press.taskId, line)
      await editMessage(bot, link, message, marked)
    }
    await sendNext()
  } catch (e) {
    if (!answered) await answerCallbackQuery(config.token, query.id, "That didn't work. Try again, or use Pam.").catch(() => {})
    throw e
  }
}

// Replaces the message a button was under. One too old for the bot to see (date 0) can't be
// edited, so the new text is sent as a message of its own (for Done and Not today, nothing is). A
// failed edit is only logged, so whatever comes after it still goes out.
async function editMessage(bot: Bot, link: Link, message: NonNullable<TelegramCallbackQuery['message']>, edited: OutgoingMessage) {
  if (message.date === 0) {
    await sendMessage(bot.config.token, link.chatId, edited)
    return
  }
  try {
    await editMessageText(bot.config.token, link.chatId, message.message_id, edited)
  } catch (e) {
    console.error('Editing a Telegram message failed:', String(e))
  }
}
