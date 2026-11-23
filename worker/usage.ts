// Usage counts (README, "Usage"): how many actions each account takes, from which client, in each
// UTC hour. Only actions a person takes are counted: every successful non-GET request that is
// signed in, apart from what the app marks as sent on its own, and the bot's commands and buttons,
// which it counts itself (pamBot/index.ts). Counting never holds up or fails what it counts.
import {
  ACTION_HEADER,
  AUTO_ACTION,
  CLIENT_ONLY_ACTIONS,
  isUsageAction,
  type Client,
  type ClientOnlyAction,
} from '../src/types/usage'
import { HttpError } from './auth'
import { clientOf } from './history'

// Requests that change nothing, whatever their method: a preview of new settings is only looked at
const NOT_ACTIONS = new Set(['POST settings/preview'])

// Adds one to the account's count for this hour. The time is passed in so tests can pin it.
export async function countAction(db: D1Database, userId: string, client: Client, action: string, now = new Date()) {
  await db
    .prepare(
      `INSERT INTO usage_counts (user_id, day_utc, hour_utc, client, action, count) VALUES (?1, ?2, ?3, ?4, ?5, 1)
       ON CONFLICT (user_id, day_utc, hour_utc, client, action) DO UPDATE SET count = count + 1`,
    )
    .bind(userId, now.toISOString().slice(0, 10), now.getUTCHours(), client, action)
    .run()
}

// Counts an action after its response is known, without the request waiting for it. A count that
// can't be written is dropped: it's only a statistic.
export function countLater(ctx: ExecutionContext, db: D1Database, userId: string, client: Client, action: string) {
  ctx.waitUntil(
    countAction(db, userId, client, action).catch((e) => console.error('Counting an action failed:', String(e))),
  )
}

// Counts the request if a person took it: signed in (userId is only set once the session is
// checked, so the sign-in routes and the bot's webhook never have one), not a GET, answered 2xx and
// not marked 'auto'. `route` is the path without ids, such as "tasks" or "tasks/action", for the
// name of a request that has no known X-Pam-Action. `reported` is the action a POST /api/usage
// named in its body.
export function countRequest(
  ctx: ExecutionContext,
  db: D1Database,
  request: Request,
  response: Response,
  userId: string | undefined,
  route: string,
  reported?: ClientOnlyAction,
) {
  if (!userId || request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return
  if (response.status < 200 || response.status > 299) return
  const header = request.headers.get(ACTION_HEADER)
  const fallback = `${request.method} ${route}`
  if (header === AUTO_ACTION || NOT_ACTIONS.has(fallback)) return
  countLater(ctx, db, userId, clientOf(request), reported ?? (isUsageAction(header) ? header : fallback))
}

// POST /api/usage, for an action that happens only in the browser, such as an export: the action
// the body names, which countRequest counts once the route has answered 204
export function parseUsageReport(body: unknown): ClientOnlyAction {
  const action = typeof body === 'object' && body !== null ? (body as { action?: unknown }).action : undefined
  if (!(CLIENT_ONLY_ACTIONS as readonly unknown[]).includes(action)) {
    throw new HttpError(400, `action must be one of ${CLIENT_ONLY_ACTIONS.join(', ')}`)
  }
  return action as ClientOnlyAction
}
