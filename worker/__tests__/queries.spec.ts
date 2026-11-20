// Tests for the saved queries in analytics/queries.sql, run on a history and usage_counts seeded
// with a known timeline. Times are UTC, as stored; the comments give Singapore time, which the
// queries convert to. The traps: a task done at 07:00 SGT on its due date (23:00 UTC the day
// before), one done at 07:30 SGT the day after its due date (still its due date in UTC), counts
// and ticks at 23:00 UTC on a Sunday (Monday in Singapore, so the next week), a start date moved
// on its own, a due date moved earlier, and Google tasks, baseline rows and another account's rows
// that must be left out.
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import queriesSql from '../../analytics/queries.sql?raw'
import { statements } from '../migrate'

// Each query's settings line, as in the file, and with the fixture's account and audit_id
const SETTINGS_LINE = /^WITH settings AS \(.*\),$/m
const testSettings = (line: string) => line.replace("'you@example.com'", "'me@example.com'").replace("'the-task-or-project-id'", "'b'")

const queries = statements(queriesSql)

type Data = Record<string, unknown>
let rows: [string, string, string, string, string, Data, Data | null][]

// One history row; ids follow the order rows are added in
const log = (at: string, table: string, key: string, op: string, source: string, data: Data, old: Data | null = null) =>
  rows.push([at, table, key, op, source, data, old])

const task = (id: string, name: string, fields: Data = {}) => ({ id, name, due_date: null, start_date: null, completed: 0, ...fields })
const project = (id: string, name: string, delivery: string | null) => ({ id, name, delivery_date: delivery })
const link = (projectId: string, taskId: string) => ({ project_id: projectId, task_id: taskId, position: 0 })
const tag = (projectId: string) => ({ project_id: projectId, tag_id: 'archive', position: 0 })

beforeEach(async () => {
  rows = []
  const t0 = task('t0', 'Old task', { due_date: '2026-11-10' })
  const gt = task('gt', 'Old import', { due_date: '2026-11-12', google_account: 'me@gmail.com' })
  // From before history began
  log('2026-10-01T00:00:00.000Z', 'projects', 'old', 'baseline', 'baseline', project('old', 'Old project', '2026-11-30'))
  log('2026-10-01T00:00:00.000Z', 'tasks', 't0', 'baseline', 'baseline', t0)
  log('2026-11-20T00:00:00.000Z', 'project_tasks', 'old:t0', 'baseline', 'baseline', link('old', 't0'))
  log('2026-10-02T00:00:00.000Z', 'tasks', 'gt', 'baseline', 'baseline', gt)

  const a = task('a', 'Alpha', { due_date: '2026-11-12' })
  const b = task('b', 'Bravo', { due_date: '2026-11-20' })
  const n = task('n', 'No date')
  const s = task('s', 'Solo', { due_date: '2026-11-14' })
  const g2 = task('g2', 'Imported', { due_date: '2026-11-20' })
  const p = project('p', 'Thesis', '2026-11-30')
  log('2026-11-02T01:00:00.000Z', 'projects', 'p', 'insert', 'web-desktop', p) // Mon 09:00
  log('2026-11-02T01:00:00.000Z', 'tasks', 'a', 'insert', 'web-desktop', a)
  log('2026-11-02T01:00:00.000Z', 'project_tasks', 'p:a', 'insert', 'web-desktop', link('p', 'a')) // planned
  log('2026-11-03T01:00:00.000Z', 'tasks', 'n', 'insert', 'web-mobile', n)
  log('2026-11-03T02:00:00.000Z', 'tasks', 'g2', 'insert', 'google', g2)
  log('2026-11-03T03:00:00.000Z', 'tasks', 's', 'insert', 'web-mobile', s)
  log('2026-11-04T01:00:00.000Z', 'tasks', 'n', 'update', 'web-mobile', { ...n, completed: 1 }, n)
  log('2026-11-04T01:00:00.000Z', 'project_tasks', 'p:g2', 'insert', 'web-desktop', link('p', 'g2')) // a Google task
  log('2026-11-04T03:00:00.000Z', 'tasks', 's', 'update', 'web-mobile', { ...s, due_date: '2026-11-16' }, s) // +2 days
  log('2026-11-05T01:00:00.000Z', 'tasks', 'b', 'insert', 'web-desktop', b)
  log('2026-11-05T01:00:00.000Z', 'project_tasks', 'p:b', 'insert', 'web-desktop', link('p', 'b')) // 72 hours in
  log('2026-11-05T02:00:00.000Z', 'tasks', 'g2', 'update', 'google', { ...g2, due_date: '2026-11-22' }, g2)
  log('2026-11-06T01:00:00.000Z', 'projects', 'p', 'update', 'web-mobile', { ...p, delivery_date: '2026-12-07' }, p) // +7 days
  const b2 = { ...b, due_date: '2026-11-25' }
  log('2026-11-06T02:00:00.000Z', 'tasks', 'b', 'update', 'web-desktop', b2, b) // +5 days
  const b3 = { ...b2, start_date: '2026-11-21' }
  log('2026-11-06T03:00:00.000Z', 'tasks', 'b', 'update', 'web-desktop', b3, b2) // a start date only
  const a2 = { ...a, due_date: '2026-11-10' }
  log('2026-11-07T01:00:00.000Z', 'tasks', 'a', 'update', 'web-desktop', a2, a) // earlier
  const a3 = { ...a2, completed: 1 }
  log('2026-11-09T23:00:00.000Z', 'tasks', 'a', 'update', 'telegram', a3, a2) // Tue 07:00 on its due date
  log('2026-11-10T23:30:00.000Z', 'tasks', 't0', 'update', 'web-mobile', { ...t0, completed: 1 }, t0) // Wed 07:30, a day late
  log('2026-11-10T23:30:05.000Z', 'project_tags', 'old:archive', 'insert', 'web-mobile', tag('old')) // completed
  log('2026-11-12T01:00:00.000Z', 'tasks', 'a', 'update', 'web-desktop', a2, a3) // reopened
  log('2026-11-12T02:00:00.000Z', 'tasks', 'a', 'update', 'web-desktop', a3, a2) // Thu 10:00, late
  log('2026-11-13T01:00:00.000Z', 'tasks', 'gt', 'update', 'web-desktop', { ...gt, completed: 1 }, gt) // a Google task
  log('2026-11-15T23:00:00.000Z', 'tasks', 'b', 'update', 'web-desktop', { ...b3, completed: 1 }, b3) // Mon 07:00
  log('2026-11-15T23:00:02.000Z', 'project_tags', 'p:archive', 'insert', 'web-desktop', tag('p')) // completed
  log('2026-11-16T05:00:00.000Z', 'projects', 'q', 'insert', 'web-desktop', project('q', 'Hold', null))
  log('2026-11-17T05:00:00.000Z', 'project_tags', 'q:archive', 'insert', 'web-desktop', tag('q')) // by hand

  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email) VALUES ('u', 'me@example.com'), ('v', 'other@example.com')"),
    ...rows.map(([at, table, key, op, source, data, old]) =>
      env.DB.prepare(
        'INSERT INTO history (user_id, at, table_name, row_key, op, source, data, old_data) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)',
      ).bind('u', at, table, key, op, source, JSON.stringify(data), old === null ? null : JSON.stringify(old)),
    ),
    // Another account's project, which no query may show
    env.DB.prepare(
      `INSERT INTO history (user_id, at, table_name, row_key, op, source, data)
       VALUES ('v', '2026-11-02T01:00:00.000Z', 'projects', 'vp', 'insert', 'web-desktop', '{"id":"vp","name":"Theirs"}')`,
    ),
    env.DB.prepare(
      `INSERT INTO usage_counts (user_id, day_utc, hour_utc, client, action, count) VALUES
         ('u', '2026-11-16', 1, 'web-mobile', 'task_create', 3),   -- Mon 09:00
         ('u', '2026-11-15', 23, 'web-desktop', 'task_edit', 1),  -- Mon 07:00, though Sunday in UTC
         ('u', '2026-11-14', 2, 'telegram', 'task_complete', 4),  -- Sat 10:00
         ('v', '2026-11-16', 1, 'web-mobile', 'task_create', 100)`,
    ),
  ])
})

// The rows of query `n` (1 to 9), as arrays of values
async function run(n: number) {
  const sql = queries[n - 1]!.replace(SETTINGS_LINE, testSettings)
  const { results } = await env.DB.prepare(sql).all<Record<string, unknown>>()
  return results.map((r) => Object.values(r))
}

describe('analytics/queries.sql', () => {
  it('has nine queries, each starting with the same settings line', () => {
    expect(queries).toHaveLength(9)
    const lines = queries.map((q) => SETTINGS_LINE.exec(q)?.[0])
    expect(lines.every((l) => l !== undefined && l === lines[0])).toBe(true)
    expect(lines[0]).toContain("'+8 hours' AS local_offset")
    expect(queriesSql).not.toContain('"') // so PowerShell passes the file on unchanged
  })

  it('1. tells planned tasks from ones added later, with how far into the project they came', async () => {
    expect(await run(1)).toEqual([
      ['p', 'Thesis', 'a', 'Alpha', '2026-11-02 09:00:00', 0, 'planned', '2026-11-30', 0],
      // 3 days into a project made at 09:00 on 2 November and due by the end of 30 November
      ['p', 'Thesis', 'b', 'Bravo', '2026-11-05 09:00:00', 72, 'added later', '2026-11-30', 10.5],
    ])
  })

  it('2. counts tasks ticked off and reopened in each local week, overall and for each project they were in', async () => {
    expect(await run(2)).toEqual([
      ['2026-11-02', null, '(all tasks)', 1, 0],
      ['2026-11-09', null, '(all tasks)', 3, 1],
      ['2026-11-09', 'old', 'Old project', 1, 0], // in it since before history began
      ['2026-11-09', 'p', 'Thesis', 2, 1],
      ['2026-11-16', null, '(all tasks)', 1, 0], // b, on Monday morning in Singapore
      ['2026-11-16', 'p', 'Thesis', 1, 0],
    ])
  })

  it('3. counts projects made in each local week and month', async () => {
    expect(await run(3)).toEqual([
      ['week', '2026-11-02', 1],
      ['week', '2026-11-16', 1],
      ['month', '2026-11-01', 2],
    ])
  })

  it('4. tells projects completed from ones archived by hand', async () => {
    expect(await run(4)).toEqual([
      ['old', 'Old project', '2026-11-11 07:30:05', 'completed'],
      ['p', 'Thesis', '2026-11-16 07:00:02', 'completed'],
      ['q', 'Hold', '2026-11-17 13:00:00', 'put on hold / archived manually'],
    ])
  })

  it('5. counts dates moved later, and the days added, for each project', async () => {
    expect(await run(5)).toEqual([
      ['p', 'Thesis', 'delivery date', 1, 7],
      ['p', 'Thesis', 'task due date', 1, 5],
      [null, '(no project)', 'task due date', 1, 2],
    ])
  })

  it('6. judges each completion against its deadline in local time, listing those with none apart', async () => {
    expect(await run(6)).toEqual([
      ['project', 'old', 'Old project', '2026-11-11', '2026-11-30', 'on time', 100],
      ['project', 'p', 'Thesis', '2026-11-16', '2026-12-07', 'on time', 100],
      ['task', 'a', 'Alpha', '2026-11-10', '2026-11-10', 'on time', 50], // 07:00 on its due date
      ['task', 't0', 'Old task', '2026-11-11', '2026-11-10', 'late', 50], // 07:30 the day after
      ['task', 'a', 'Alpha', '2026-11-12', '2026-11-10', 'late', 50],
      ['task', 'b', 'Bravo', '2026-11-16', '2026-11-25', 'on time', 50],
      ['task', 'n', 'No date', '2026-11-04', null, 'no date', 50],
    ])
  })

  it('7. lists everything about one task, oldest first', async () => {
    const audit = await run(7)
    expect(audit.map((r) => [r[1], r[2], r[3], r[4]])).toEqual([
      ['2026-11-05 09:00:00', 'tasks', 'b', 'insert'],
      ['2026-11-05 09:00:00', 'project_tasks', 'p:b', 'insert'],
      ['2026-11-06 10:00:00', 'tasks', 'b', 'update'],
      ['2026-11-06 11:00:00', 'tasks', 'b', 'update'],
      ['2026-11-16 07:00:00', 'tasks', 'b', 'update'],
    ])
  })

  it("8. counts each client's actions in each local week, and its share", async () => {
    expect(await run(8)).toEqual([
      ['2026-11-09', 'telegram', 4, 100],
      ['2026-11-16', 'web-desktop', 1, 25],
      ['2026-11-16', 'web-mobile', 3, 75],
      ['all time', 'telegram', 4, 50],
      ['all time', 'web-desktop', 1, 12.5],
      ['all time', 'web-mobile', 3, 37.5],
    ])
  })

  it('9. counts actions in each local hour, by client, on all days, weekdays and weekends', async () => {
    expect(await run(9)).toEqual([
      ['all days', 7, 'web-desktop', 1],
      ['all days', 9, 'web-mobile', 3],
      ['all days', 10, 'telegram', 4],
      ['weekdays', 7, 'web-desktop', 1],
      ['weekdays', 9, 'web-mobile', 3],
      ['weekends', 10, 'telegram', 4],
    ])
  })

  it('counts Google tasks when include_google_tasks is 1', async () => {
    const sql = queries[0]!.replace(SETTINGS_LINE, (line) => testSettings(line).replace('0 AS include_google_tasks', '1 AS include_google_tasks'))
    const { results } = await env.DB.prepare(sql).all<{ task_id: string }>()
    expect(results.map((r) => r.task_id)).toEqual(['a', 'g2', 'b'])
  })
})
