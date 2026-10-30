// Change tracking (src/types/events.ts): writing events to task_events, and reading them for
// GET /api/events. Events are only ever added: nothing here updates or deletes them.
import type { EventKind, EventSource, LoggedEvent, TaskEvent, TaskSource } from '../src/types/events'
import { jsonChunks } from './jsonChunks'

interface EventRow {
  id: number
  at: string
  kind: EventKind
  task_id: string | null
  project_id: string | null
  old_value: string | null
  new_value: string | null
  delivery_date_at_time: string | null
  source: EventSource
  task_source: TaskSource | null
}

// What GET /api/events filters by: one project's events, and those logged at or after `since`
export interface EventQuery {
  projectId?: string
  since?: string // a date or UTC timestamp, compared with `at` as text
}

// Statements logging the events at `at`, to go in the same batch as the change they describe so
// that a save that fails logs nothing. ORDER BY key keeps the list's order in the ids.
export function eventStatements(db: D1Database, userId: string, at: string, events: TaskEvent[]): D1PreparedStatement[] {
  return jsonChunks(events).map((json) =>
    db
      .prepare(
        `INSERT INTO task_events
           (user_id, at, kind, task_id, project_id, old_value, new_value, delivery_date_at_time, source, task_source)
         SELECT ?1, ?2, value ->> '$.kind', value ->> '$.taskId', value ->> '$.projectId', value ->> '$.oldValue',
           value ->> '$.newValue', value ->> '$.deliveryDateAtTime', value ->> '$.source', value ->> '$.taskSource'
         FROM json_each(?3) ORDER BY key`,
      )
      .bind(userId, at, json),
  )
}

// The user's events, oldest first
export async function listEvents(db: D1Database, userId: string, { projectId, since }: EventQuery): Promise<LoggedEvent[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM task_events
       WHERE user_id = ?1 AND (?2 IS NULL OR project_id = ?2) AND (?3 IS NULL OR at >= ?3)
       ORDER BY at, id`,
    )
    .bind(userId, projectId ?? null, since ?? null)
    .all<EventRow>()
  return results.map((row) => ({
    id: row.id,
    at: row.at,
    kind: row.kind,
    taskId: row.task_id,
    projectId: row.project_id,
    oldValue: row.old_value,
    newValue: row.new_value,
    deliveryDateAtTime: row.delivery_date_at_time,
    source: row.source,
    taskSource: row.task_source,
  }))
}
