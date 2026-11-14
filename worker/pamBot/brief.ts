// The morning brief, sent by the scheduled handler (a Cron Trigger every 15 minutes, in
// wrangler.jsonc). Each run, every chat whose brief is due (schedule.ts) gets one, worked out by
// prioritise() and forecast() for the user's local today.
//
// last_brief_date is claimed before sending, in one statement, so two runs at once can't both send
// the day's brief. If sending fails, it's put back, so the next run tries again.
import { forecast } from '../../src/types/forecast'
import { prioritise } from '../../src/types/priority'
import { capacityOn } from '../../src/types/settings'
import { sendMessage } from './botApi'
import { enabledLinks, type Link } from './links'
import { briefMessage } from './messages'
import { briefDue, localDateTime } from './schedule'
import type { BotConfig, PamData } from './index'

export async function sendBriefs(db: D1Database, config: BotConfig, data: PamData, now: Date): Promise<void> {
  for (const link of await enabledLinks(db)) {
    try {
      await sendBriefIfDue(db, config, data, link, now)
    } catch (e) {
      // One chat's failure doesn't stop the others
      console.error('Sending a morning brief failed:', String(e))
    }
  }
}

async function sendBriefIfDue(db: D1Database, config: BotConfig, data: PamData, link: Link, now: Date) {
  const local = localDateTime(now, link.timeZone)
  // Checked before loading anything, since on most runs it isn't time yet
  if (!briefDue(link, local, 1)) return
  const { tasks, projects, settings } = await data.load(db, link.userId)
  if (!briefDue(link, local, capacityOn(settings.capacityMinutes, local.date))) return

  const claimed = await db
    .prepare(
      `UPDATE telegram_links SET last_brief_date = ?2
       WHERE user_id = ?1 AND chat_id = ?3 AND enabled = 1 AND (last_brief_date IS NULL OR last_brief_date < ?2)`,
    )
    .bind(link.userId, local.date, link.chatId)
    .run()
  if (claimed.meta.changes === 0) return

  const priorities = prioritise(tasks, projects, settings, local.date)
  const message = briefMessage(config.origin, priorities, forecast(tasks, projects, settings, local.date, priorities))
  try {
    await sendMessage(config.token, link.chatId, message)
  } catch (e) {
    await db
      .prepare('UPDATE telegram_links SET last_brief_date = ?3 WHERE user_id = ?1 AND last_brief_date = ?2')
      .bind(link.userId, local.date, link.lastBriefDate)
      .run()
    throw e
  }
}
