// The /api/settings routes: each user's capacity and prioritisation weights (src/types/settings.ts),
// one user_settings row each.
//
//   GET  /api/settings         -> UserSettings; the defaults until the user saves their own
//   PUT  /api/settings         -> saves the whole UserSettings in the body, returns them as stored
//   POST /api/settings/preset  -> { preset }: switches to that preset's weights, returns the settings
//   POST /api/settings/preview -> { today, preset?, capacityMinutes?, buffer? }: what those changes
//                                 would do (a SettingsPreview), without saving anything
//
// The row is only written by a PUT or a preset change, so a GET or a preview never changes anything.
// The weights always match the named preset: a PUT whose weights don't is refused.
import {
  MAX_BUFFER,
  MAX_DAY_CAPACITY_MINUTES,
  MAX_HORIZON_DAYS,
  MAX_WEIGHT,
  MIN_BUFFER,
} from '../src/types/limits'
import type { State } from '../src/types/operations'
import {
  applyPreset,
  DEFAULT_SETTINGS,
  matchesPreset,
  PRESET_NAMES,
  PRESETS,
  WEEKDAYS,
  type PresetName,
  type UserSettings,
} from '../src/types/settings'
import { previewSettings, type SettingsPreview } from '../src/types/settingsPreview'
import { HttpError } from './auth'

interface SettingsRow {
  capacity_mon: number
  capacity_tue: number
  capacity_wed: number
  capacity_thu: number
  capacity_fri: number
  capacity_sat: number
  capacity_sun: number
  buffer: number
  w_u: number
  k: number
  horizon_days: number
  preset: UserSettings['preset']
}

// action is what follows /api/settings/ in the path: undefined, 'preset' or 'preview'.
// loadState reads the user's tasks and projects, which only a preview needs.
export async function handleSettings(
  db: D1Database,
  request: Request,
  userId: string,
  action: string | undefined,
  readBody: () => Promise<unknown>,
  loadState: () => Promise<State>,
): Promise<UserSettings | SettingsPreview> {
  if (action === undefined) {
    if (request.method === 'GET') return getSettings(db, userId)
    if (request.method === 'PUT') return saveSettings(db, userId, parseSettings(await readBody()))
    throw new HttpError(405, 'Method not allowed')
  }
  if (action !== 'preset' && action !== 'preview') throw new HttpError(404, 'Not found')
  if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed')
  const body = await readBody()
  if (action === 'preset') {
    check(isObject(body) && Object.keys(body).length === 1, 'Body must be { preset }')
    return saveSettings(db, userId, applyPreset(await getSettings(db, userId), parsePreset(body.preset)))
  }
  return preview(db, userId, body, loadState)
}

// The settings with the changes in the body, checked as a PUT would check them, against the
// stored ones. A preset sets its weights, as choosing it on the settings page does.
async function preview(db: D1Database, userId: string, body: unknown, loadState: () => Promise<State>) {
  const fields = ['today', 'preset', 'capacityMinutes', 'buffer']
  check(isObject(body) && Object.keys(body).every((key) => fields.includes(key)), 'Body must be { today, preset?, capacityMinutes?, buffer? }')
  const { today, preset, capacityMinutes, buffer } = body
  check(isDate(today), "today must be a YYYY-MM-DD date: the user's local date")
  const current = await getSettings(db, userId)
  const changed = {
    ...current,
    ...(capacityMinutes !== undefined ? { capacityMinutes } : {}),
    ...(buffer !== undefined ? { buffer } : {}),
  } as UserSettings
  const candidate = parseSettings(preset !== undefined ? applyPreset(changed, parsePreset(preset)) : changed)
  const { tasks, projects } = await loadState()
  return previewSettings(tasks, projects, current, candidate, today)
}

function parsePreset(preset: unknown): PresetName {
  check((PRESET_NAMES as readonly unknown[]).includes(preset), `preset must be one of ${PRESET_NAMES.join(', ')}`)
  return preset as PresetName
}

export async function getSettings(db: D1Database, userId: string): Promise<UserSettings> {
  const row = await db.prepare('SELECT * FROM user_settings WHERE user_id = ?1').bind(userId).first<SettingsRow>()
  if (!row) return structuredClone(DEFAULT_SETTINGS)
  return {
    capacityMinutes: Object.fromEntries(
      WEEKDAYS.map((day) => [day, row[`capacity_${day}`]]),
    ) as UserSettings['capacityMinutes'],
    buffer: row.buffer,
    wU: row.w_u,
    k: row.k,
    horizonDays: row.horizon_days,
    preset: row.preset,
  }
}

async function saveSettings(db: D1Database, userId: string, settings: UserSettings): Promise<UserSettings> {
  const c = settings.capacityMinutes
  await db
    .prepare(
      `INSERT INTO user_settings (user_id, capacity_mon, capacity_tue, capacity_wed, capacity_thu, capacity_fri,
         capacity_sat, capacity_sun, buffer, w_u, k, horizon_days, preset)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
       ON CONFLICT (user_id) DO UPDATE SET capacity_mon = excluded.capacity_mon, capacity_tue = excluded.capacity_tue,
         capacity_wed = excluded.capacity_wed, capacity_thu = excluded.capacity_thu,
         capacity_fri = excluded.capacity_fri, capacity_sat = excluded.capacity_sat,
         capacity_sun = excluded.capacity_sun, buffer = excluded.buffer, w_u = excluded.w_u, k = excluded.k,
         horizon_days = excluded.horizon_days, preset = excluded.preset,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
    .bind(userId, c.mon, c.tue, c.wed, c.thu, c.fri, c.sat, c.sun, settings.buffer, settings.wU, settings.k, settings.horizonDays, settings.preset)
    .run()
  return getSettings(db, userId)
}

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new HttpError(400, message)
}

const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isNumberIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const isWholeIn = (value: unknown, min: number, max: number): value is number =>
  isNumberIn(value, min, max) && Number.isInteger(value)

function parseSettings(body: unknown): UserSettings {
  check(isObject(body), 'Body must be a JSON object')
  const { capacityMinutes, buffer, wU, k, horizonDays, preset } = body
  check(
    isObject(capacityMinutes) &&
      Object.keys(capacityMinutes).length === WEEKDAYS.length &&
      WEEKDAYS.every((day) => isWholeIn(capacityMinutes[day], 0, MAX_DAY_CAPACITY_MINUTES)),
    `capacityMinutes must give each of ${WEEKDAYS.join(', ')} a whole number of minutes from 0 to ${MAX_DAY_CAPACITY_MINUTES}`,
  )
  check(
    WEEKDAYS.some((day) => (capacityMinutes[day] as number) > 0),
    'capacityMinutes must give at least one weekday some time',
  )
  check(isNumberIn(buffer, MIN_BUFFER, MAX_BUFFER), `buffer must be a number from ${MIN_BUFFER} to ${MAX_BUFFER}`)
  check(isNumberIn(wU, 0, MAX_WEIGHT), `wU must be a number from 0 to ${MAX_WEIGHT}`)
  check(isNumberIn(k, 0, MAX_WEIGHT), `k must be a number from 0 to ${MAX_WEIGHT}`)
  check(isWholeIn(horizonDays, 1, MAX_HORIZON_DAYS), `horizonDays must be a whole number from 1 to ${MAX_HORIZON_DAYS}`)
  const named = parsePreset(preset)
  const { label, ...weights } = PRESETS[named]
  check(
    matchesPreset({ wU, k, horizonDays, preset: named }),
    `wU, k and horizonDays must be the preset's: ${label} is ${JSON.stringify(weights)}. To change them, choose another preset`,
  )
  return {
    capacityMinutes: Object.fromEntries(WEEKDAYS.map((day) => [day, capacityMinutes[day]])) as UserSettings['capacityMinutes'],
    buffer,
    wU,
    k,
    horizonDays,
    preset: named,
  }
}
