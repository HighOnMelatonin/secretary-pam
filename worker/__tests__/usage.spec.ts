// Integration tests for usage_counts (worker/usage.ts): which requests are counted, under which
// client and action, and that counting never changes the response. Requests go straight to the
// Worker's fetch with an execution context the test waits on, so the counts written after the
// response (with waitUntil) are there to read. The bot's counts are tested in telegram.spec.ts.
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { createEmptyProject } from '../../src/types/project'
import { createEmptyTask, type Task } from '../../src/types/task'
import worker from '../index'
import { PASSWORD, signUp } from './helpers'

let session: string

beforeEach(async () => {
  session = await signUp()
})

// Sends the request as the signed-in browser (or as `cookie`), with JSON and these headers, then
// waits for everything it left running
async function send(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, cookie = session) {
  const ctx = createExecutionContext()
  const request = new Request(`http://localhost/api/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const response = await worker.fetch(request as Request<unknown, IncomingRequestCfProperties>, env as unknown as Env, ctx)
  await waitOnExecutionContext(ctx)
  return response
}

interface Count {
  day_utc: string
  hour_utc: number
  client: string
  action: string
  count: number
}

const counts = async (email = 'me@example.com') =>
  (
    await env.DB.prepare(
      `SELECT day_utc, hour_utc, client, action, count FROM usage_counts
       WHERE user_id = (SELECT id FROM users WHERE email = ?1) ORDER BY action, client`,
    )
      .bind(email)
      .all<Count>()
  ).results

// The client, action and count of each row, leaving out the hour, which tests check once
const tally = async (email?: string) => (await counts(email)).map((c) => [c.client, c.action, c.count])

const task = (fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id: 't', name: 'Write', ...fields })
const mobile = (action: string) => ({ 'X-Pam-Client': 'web-mobile', 'X-Pam-Action': action })

describe('counting actions', () => {
  it("adds one to this UTC hour's count of the action, from the client", async () => {
    const before = new Date()
    expect((await send('PUT', 'tasks/t', { task: task() }, mobile('task_create'))).status).toBe(200)
    expect((await send('PUT', 'tasks/t', { task: task({ name: 'Rewrite' }) }, mobile('task_edit'))).status).toBe(200)
    expect((await send('PUT', 'tasks/t', { task: task({ name: 'Again' }) }, mobile('task_edit'))).status).toBe(200)
    const after = new Date()

    const rows = await counts()
    expect(rows.map((c) => [c.client, c.action, c.count])).toEqual([
      ['web-mobile', 'task_create', 1],
      ['web-mobile', 'task_edit', 2],
    ])
    // The hour the requests were made in, or the next if one turned over meanwhile
    const hours = [before, after].map((d) => [d.toISOString().slice(0, 10), d.getUTCHours()])
    for (const row of rows) expect(hours).toContainEqual([row.day_utc, row.hour_utc])
  })

  it('names an action that has no known X-Pam-Action by its method and route, and a missing client unknown', async () => {
    await send('PUT', 'tasks/t', { task: task() })
    await send('PUT', 'tasks/t', { task: task({ name: 'B' }) }, { 'X-Pam-Action': 'something_new', 'X-Pam-Client': 'web-desktop' })
    await send('POST', 'tasks/t/action', { action: 'estimate', effortMinutes: 30 }, { 'X-Pam-Client': 'tablet' })
    await send('PUT', 'projects/p', { project: { ...createEmptyProject(), id: 'p', name: 'P' } })
    await send('DELETE', 'tags/work')
    expect((await send('POST', 'settings/preset', { preset: 'deadline' })).status).toBe(200)
    expect(await tally()).toEqual([
      ['unknown', 'DELETE tags', 1],
      ['unknown', 'POST settings/preset', 1],
      ['unknown', 'POST tasks/action', 1],
      ['unknown', 'PUT projects', 1],
      ['unknown', 'PUT tasks', 1],
      ['web-desktop', 'PUT tasks', 1],
    ])
  })

  it("doesn't count reads, refusals, sign-in routes, requests marked auto or previews", async () => {
    await send('PUT', 'projects/p', { project: { ...createEmptyProject(), id: 'p', name: 'P', deliveryDate: '2026-12-01' } }, mobile('auto'))
    await send('GET', 'tasks', undefined, mobile('task_edit'))
    expect((await send('PUT', 'tasks/t', { task: { name: 'No id' } }, mobile('task_create'))).status).toBe(400)
    const late = { task: task({ dueDate: '2026-12-10' }), projectIds: ['p'] }
    expect((await send('PUT', 'tasks/t', late, mobile('task_create'))).status).toBe(409)
    expect((await send('POST', 'tasks/gone/action', { action: 'unpin' }, mobile('quick_action_unpin'))).status).toBe(404)
    expect((await send('POST', 'auth/login', { email: 'me@example.com', password: PASSWORD }, mobile('task_edit'), '')).status).toBe(200)
    expect((await send('POST', 'auth/logout', undefined, mobile('task_edit'))).status).toBe(204)
    expect((await send('PUT', 'tasks/t', { task: task() }, mobile('task_create'), '')).status).toBe(401)
    const preview = await send('POST', 'settings/preview', { today: '2026-11-20', preset: 'deadline' }, mobile('settings_save'), await signUp('b@example.com'))
    expect(preview.status).toBe(200)
    expect(await tally()).toEqual([])
    expect(await tally('b@example.com')).toEqual([])
  })

  it("doesn't count the scheduled run", async () => {
    await worker.scheduled(createScheduledController({ scheduledTime: Date.now() }), env as unknown as Env)
    expect((await env.DB.prepare('SELECT count(*) AS n FROM usage_counts').first<number>('n'))).toBe(0)
  })

  it("keeps each account's counts apart", async () => {
    const other = await signUp('other@example.com')
    await send('PUT', 'tasks/t', { task: task() }, mobile('task_create'))
    await send('PUT', 'tasks/t', { task: task() }, mobile('task_create'), other)
    await send('PUT', 'tasks/t', { task: task({ name: 'B' }) }, mobile('task_edit'), other)
    expect(await tally()).toEqual([['web-mobile', 'task_create', 1]])
    expect(await tally('other@example.com')).toEqual([
      ['web-mobile', 'task_create', 1],
      ['web-mobile', 'task_edit', 1],
    ])
  })

  it('answers as usual when the count cannot be written', async () => {
    const counted = await send('PUT', 'tasks/t', { task: task() }, mobile('task_create'))
    const expected = await counted.json()
    await env.DB.prepare('ALTER TABLE usage_counts RENAME TO usage_counts_away').run()
    try {
      const response = await send('PUT', 'tasks/u', { task: task({ id: 'u' }) }, mobile('task_create'))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ...(expected as object), tasks: [{ ...task({ id: 'u' }) }] })
    } finally {
      await env.DB.prepare('ALTER TABLE usage_counts_away RENAME TO usage_counts').run()
    }
    expect(await tally()).toEqual([['web-mobile', 'task_create', 1]])
  })
})

describe('POST /api/usage', () => {
  it('counts an action that happens only in the browser, and answers 204', async () => {
    const response = await send('POST', 'usage', { action: 'export' }, { 'X-Pam-Client': 'web-desktop' })
    expect(response.status).toBe(204)
    // The body names the action, whatever the header says
    await send('POST', 'usage', { action: 'export' }, { 'X-Pam-Client': 'web-desktop', 'X-Pam-Action': 'task_delete' })
    expect(await tally()).toEqual([['web-desktop', 'export', 2]])
  })

  it('refuses any other action, another method, and a request that is not signed in', async () => {
    expect((await send('POST', 'usage', { action: 'task_create' })).status).toBe(400)
    expect((await send('POST', 'usage', {})).status).toBe(400)
    expect((await send('GET', 'usage')).status).toBe(405)
    expect((await send('POST', 'usage', { action: 'export' }, {}, '')).status).toBe(401)
    expect((await send('POST', 'usage/x', { action: 'export' })).status).toBe(404)
    expect(await tally()).toEqual([])
  })
})
