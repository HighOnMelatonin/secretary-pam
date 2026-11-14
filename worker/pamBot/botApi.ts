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

// A callback query's message is an InaccessibleMessage (date 0, and nothing but its chat and id)
// when it's too old for the bot to see
export interface TelegramMessage {
  message_id: number
  date: number
  chat: TelegramChat
  from?: TelegramUser
  text?: string
  reply_markup?: { inline_keyboard?: InlineButton[][] }
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

// Replaces a message's text and buttons. An empty list of rows takes the buttons away.
export function editMessageText(token: string, chatId: number, messageId: number, message: OutgoingMessage) {
  return callBotApi(token, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: message.text,
    link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: message.buttons ?? [] },
  })
}

// Tells Telegram a button press was handled, so it stops showing a spinner on the button, with an
// optional note it shows briefly at the top of the chat
export function answerCallbackQuery(token: string, callbackQueryId: string, text?: string) {
  return callBotApi(token, 'answerCallbackQuery', { callback_query_id: callbackQueryId, ...(text ? { text } : {}) })
}
