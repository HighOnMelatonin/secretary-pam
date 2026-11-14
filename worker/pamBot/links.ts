// The telegram_links and telegram_link_codes tables (migrations/0010_telegram.sql): which chat is
// linked to which account, its morning brief preferences, and the one-time codes that link a chat.
import { LINK_CODE_MINUTES, type TelegramPreferences, type TelegramStatus } from '../../src/types/telegram'
import { sha256, toHex } from '../auth'

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`

interface LinkRow {
  user_id: string
  chat_id: number
  time_zone: string
  brief_minutes: number
  enabled: 0 | 1
  last_brief_date: string | null
  last_added_task_id: string | null
  linked_at: string
}

export interface Link {
  userId: string
  chatId: number
  timeZone: string
  briefMinutes: number
  enabled: boolean
  lastBriefDate: string | null
  lastAddedTaskId: string | null
  linkedAt: string
}

const COLUMNS = 'user_id, chat_id, time_zone, brief_minutes, enabled, last_brief_date, last_added_task_id, linked_at'

const toLink = (row: LinkRow): Link => ({
  userId: row.user_id,
  chatId: row.chat_id,
  timeZone: row.time_zone,
  briefMinutes: row.brief_minutes,
  enabled: row.enabled === 1,
  lastBriefDate: row.last_brief_date,
  lastAddedTaskId: row.last_added_task_id,
  linkedAt: row.linked_at,
})

export async function linkOf(db: D1Database, userId: string): Promise<Link | null> {
  const row = await db.prepare(`SELECT ${COLUMNS} FROM telegram_links WHERE user_id = ?1`).bind(userId).first<LinkRow>()
  return row ? toLink(row) : null
}

export function statusOf(link: Link | null, botUsername: string): TelegramStatus {
  if (!link) return { linked: false, botUsername }
  const { timeZone, briefMinutes, enabled, linkedAt } = link
  return { linked: true, botUsername, timeZone, briefMinutes, enabled, linkedAt }
}

// Makes a code that links a chat to the user, replacing any code they had. 128 random bits as hex:
// 32 of the characters a t.me ?start= parameter allows. Only its hash is stored.
export async function createLinkCode(db: D1Database, userId: string, timeZone: string) {
  const code = toHex(crypto.getRandomValues(new Uint8Array(16)).buffer)
  const [, , inserted] = await db.batch<{ expires_at: string }>([
    db.prepare(`DELETE FROM telegram_link_codes WHERE expires_at <= ${NOW}`),
    db.prepare('DELETE FROM telegram_link_codes WHERE user_id = ?1').bind(userId),
    db
      .prepare(
        `INSERT INTO telegram_link_codes (id, user_id, time_zone, expires_at)
         VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?4)) RETURNING expires_at`,
      )
      .bind(await sha256(code), userId, timeZone, `+${LINK_CODE_MINUTES} minutes`),
  ])
  return { code, expiresAt: inserted!.results[0]!.expires_at }
}

// Uses a code to link the chat, returning the account it now belongs to, or null if the code is
// unknown or expired. The code is deleted by the same statement that finds it, so it works once
// even when two updates bring it at once. The new link replaces any the account or the chat had,
// and starts with the update that brought the code, so a repeat of that update is skipped.
export async function useLinkCode(db: D1Database, code: string, chatId: number, updateId: number) {
  const found = await db
    .prepare(`DELETE FROM telegram_link_codes WHERE id = ?1 AND expires_at > ${NOW} RETURNING user_id, time_zone`)
    .bind(await sha256(code))
    .first<{ user_id: string; time_zone: string }>()
  if (!found) return null
  const [, , , user] = await db.batch<{ email: string }>([
    db.prepare('DELETE FROM telegram_links WHERE user_id = ?1 OR chat_id = ?2').bind(found.user_id, chatId),
    db
      .prepare('INSERT INTO telegram_links (user_id, chat_id, time_zone, last_update_id) VALUES (?1, ?2, ?3, ?4)')
      .bind(found.user_id, chatId, found.time_zone, updateId),
    db.prepare('DELETE FROM telegram_link_codes WHERE user_id = ?1').bind(found.user_id),
    db.prepare('SELECT email FROM users WHERE id = ?1').bind(found.user_id),
  ])
  return { link: (await linkOf(db, found.user_id))!, email: user!.results[0]!.email }
}

// Marks an update from a linked chat as handled, returning the link, or null when the chat isn't
// linked or the update is no newer than the last one handled (Telegram sending it again). Checked
// and set in one statement, so two copies of an update can't both be handled.
export async function claimUpdate(db: D1Database, chatId: number, updateId: number): Promise<Link | null> {
  const row = await db
    .prepare(`UPDATE telegram_links SET last_update_id = ?2 WHERE chat_id = ?1 AND last_update_id < ?2 RETURNING ${COLUMNS}`)
    .bind(chatId, updateId)
    .first<LinkRow>()
  return row ? toLink(row) : null
}

export async function isLinked(db: D1Database, chatId: number) {
  return (await db.prepare('SELECT 1 FROM telegram_links WHERE chat_id = ?1').bind(chatId).first()) !== null
}

// Saves the brief preferences, returning the link, or null if the user has none
export async function savePreferences(db: D1Database, userId: string, preferences: TelegramPreferences) {
  const row = await db
    .prepare(`UPDATE telegram_links SET time_zone = ?2, brief_minutes = ?3, enabled = ?4 WHERE user_id = ?1 RETURNING ${COLUMNS}`)
    .bind(userId, preferences.timeZone, preferences.briefMinutes, preferences.enabled ? 1 : 0)
    .first<LinkRow>()
  return row ? toLink(row) : null
}

// Unlinks the user's chat and drops their codes, returning the chat that was linked, if any
export async function deleteLink(db: D1Database, userId: string): Promise<number | null> {
  const [deleted] = await db.batch<{ chat_id: number }>([
    db.prepare('DELETE FROM telegram_links WHERE user_id = ?1 RETURNING chat_id').bind(userId),
    db.prepare('DELETE FROM telegram_link_codes WHERE user_id = ?1').bind(userId),
  ])
  return deleted!.results[0]?.chat_id ?? null
}
