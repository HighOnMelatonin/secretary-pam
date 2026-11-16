// The telegram_unrecognised table (migrations/0011_telegram_unrecognised.sql): the text from a
// linked chat that the bot answered with the hint, so the user can later see what they tried to ask.
import type { Link } from './links'

export async function storeUnrecognised(db: D1Database, link: Link, text: string, now: Date): Promise<void> {
  await db
    .prepare('INSERT INTO telegram_unrecognised (user_id, chat_id, text, at) VALUES (?1, ?2, ?3, ?4)')
    .bind(link.userId, link.chatId, text, now.toISOString())
    .run()
}
