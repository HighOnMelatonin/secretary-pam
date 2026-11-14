// The Telegram companion bot (docs/telegram-bot.md), inside the main Worker. Its routes:
//
//   GET    /api/telegram           -> TelegramStatus (src/types/telegram.ts)
//   POST   /api/telegram/link-code -> { timeZone }: a one-time code and its t.me link, for 10 minutes
//   PUT    /api/telegram           -> { timeZone, briefMinutes, enabled }: the brief preferences
//   DELETE /api/telegram           -> unlinks the chat; 204
//   POST   /api/telegram/webhook   -> where Telegram sends updates; handled before the session check
//
// Without TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_BOT_USERNAME and APP_ORIGIN the bot
// is off and every one of these answers 404.
//
// The webhook only trusts a request whose X-Telegram-Bot-Api-Secret-Token header is the secret given
// to setWebhook. It answers 200 to every such request, even when handling the update fails, so
// Telegram doesn't send it again and again; the failure is logged instead (never the token).
import { MINUTES_PER_DAY, deepLink, isTimeZone, type TelegramPreferences } from '../../src/types/telegram'
import { HttpError, type User } from '../auth'
import { sendMessage, type TelegramUpdate } from './botApi'
import { claimUpdate, createLinkCode, deleteLink, isLinked, linkOf, savePreferences, statusOf, useLinkCode } from './links'
import { badCodeMessage, linkedMessage, startCode, unlinkedMessage } from './messages'

export interface BotConfig {
  token: string
  webhookSecret: string
  username: string
  origin: string // APP_ORIGIN, for links to Pam's pages
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
  check(
    Number.isInteger(briefMinutes) && (briefMinutes as number) >= 0 && (briefMinutes as number) < MINUTES_PER_DAY,
    `briefMinutes must be a whole number of minutes after midnight, from 0 to ${MINUTES_PER_DAY - 1}`,
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

export async function handleWebhook(env: Env, config: BotConfig, request: Request): Promise<Response> {
  if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed')
  if (!(await secretMatches(request.headers.get('X-Telegram-Bot-Api-Secret-Token'), config.webhookSecret))) {
    throw new HttpError(401, 'Unauthorized')
  }
  try {
    const text = await request.text()
    const update: unknown = text.length <= MAX_UPDATE_BYTES ? JSON.parse(text) : null
    if (isObject(update) && Number.isInteger(update.update_id)) await handleUpdate(env.DB, config, update as unknown as TelegramUpdate)
  } catch (e) {
    console.error('Handling a Telegram update failed:', String(e))
  }
  return new Response(null, { status: 200 })
}

// Only private chats are answered. A linked chat's update is handled once, in order: one no newer
// than the last handled is a repeat and is skipped. An unlinked chat is ignored, apart from
// "/start <code>", which links it.
async function handleUpdate(db: D1Database, config: BotConfig, update: TelegramUpdate) {
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
  // Commands and buttons for linked chats come in later stages (docs/telegram-bot.md)
}
