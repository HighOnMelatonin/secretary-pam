// The parts of the Telegram Bot API (https://core.telegram.org/bots/api) the bot uses, called with
// fetch. Messages are plain text: parse_mode is never set, so nothing in a task's name can format
// or break a message.
//
// The token is part of every request's URL, so neither the URL nor anything fetch throws (which
// could quote it) is ever logged or put in an error: errors name only the method and Telegram's
// description.

// The fields of an update the bot reads
export interface TelegramUser {
  id: number
}

export interface TelegramChat {
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel'
}

export interface TelegramMessage {
  message_id: number
  chat: TelegramChat
  from?: TelegramUser
  text?: string
}

export interface TelegramCallbackQuery {
  id: string
  from: TelegramUser
  message?: TelegramMessage
  data?: string
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  callback_query?: TelegramCallbackQuery
}

// A button under a message: one that sends callback data back to the bot (1 to 64 bytes), or a link
export type InlineButton = { text: string; callback_data: string } | { text: string; url: string }

// A message as the builders in messages.ts make it: its text and the rows of buttons under it
export interface OutgoingMessage {
  text: string
  buttons?: InlineButton[][]
}

export class BotApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BotApiError'
  }
}

const API = 'https://api.telegram.org'

// Calls one Bot API method, returning its result, or throwing BotApiError
export async function callBotApi<T = unknown>(token: string, method: string, body: object): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    // What fetch throws could include the URL, and with it the token
    throw new BotApiError(`Telegram ${method} failed: the request didn't go through`)
  }
  const answer = (await response.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null
  if (!answer?.ok) {
    throw new BotApiError(`Telegram ${method} failed (${response.status}): ${answer?.description ?? 'no description'}`)
  }
  return answer.result as T
}

const markup = (message: OutgoingMessage) =>
  message.buttons?.length ? { reply_markup: { inline_keyboard: message.buttons } } : {}

// Sends a plain text message, without link previews, so a link to Pam doesn't add a card
export function sendMessage(token: string, chatId: number, message: OutgoingMessage) {
  return callBotApi(token, 'sendMessage', {
    chat_id: chatId,
    text: message.text,
    link_preview_options: { is_disabled: true },
    ...markup(message),
  })
}
