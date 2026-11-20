// History (migrations/0013_history.sql): the triggers log every change by themselves, and take
// who made it from the changed_by column of the row. This is what the writes do for them: work out
// the client a request came from, mark rows with who is deleting them, and delete an account's
// history with the account.
import { CLIENT_HEADER, WEB_CLIENTS, type ChangeSource, type Client } from '../src/types/usage'
import { jsonChunks } from './jsonChunks'

// The web app's layout, from its X-Pam-Client header. Only a label, never trusted for anything else.
export function clientOf(request: Request): Client {
  const value = request.headers.get(CLIENT_HEADER)
  return (WEB_CLIENTS as readonly (string | null)[]).includes(value) ? (value as Client) : 'unknown'
}

type Owner = 'tasks' | 'projects' | 'tags'

// SQL for the ids in ?2, a JSON array
const IDS = '(SELECT value FROM json_each(?2))'

// The rows on the other side of each kind of row's lists. A cascade deletes a list row after the
// row it hangs from, so its trigger can only read who is deleting from the row at its other end.
const LINKED: Record<Owner, string[]> = {
  tasks: [
    `UPDATE tasks SET changed_by = ?3 WHERE user_id = ?1 AND (
       id IN (SELECT related_task_id FROM task_relations WHERE user_id = ?1 AND task_id IN ${IDS})
       OR id IN (SELECT task_id FROM task_relations WHERE user_id = ?1 AND related_task_id IN ${IDS}))`,
    `UPDATE projects SET changed_by = ?3
     WHERE user_id = ?1 AND id IN (SELECT project_id FROM project_tasks WHERE user_id = ?1 AND task_id IN ${IDS})`,
    `UPDATE tags SET changed_by = ?3
     WHERE user_id = ?1 AND id IN (SELECT tag_id FROM task_tags WHERE user_id = ?1 AND task_id IN ${IDS})`,
  ],
  projects: [
    `UPDATE tasks SET changed_by = ?3
     WHERE user_id = ?1 AND id IN (SELECT task_id FROM project_tasks WHERE user_id = ?1 AND project_id IN ${IDS})`,
    `UPDATE tags SET changed_by = ?3
     WHERE user_id = ?1 AND id IN (SELECT tag_id FROM project_tags WHERE user_id = ?1 AND project_id IN ${IDS})`,
  ],
  tags: [
    `UPDATE projects SET changed_by = ?3
     WHERE user_id = ?1 AND id IN (SELECT project_id FROM project_tags WHERE user_id = ?1 AND tag_id IN ${IDS})`,
    `UPDATE tasks SET changed_by = ?3
     WHERE user_id = ?1 AND id IN (SELECT task_id FROM task_tags WHERE user_id = ?1 AND tag_id IN ${IDS})`,
  ],
}

// Deletes the rows, cascading to their lists, so that every row it logs is from `source`: the rows
// themselves and the ones at the other end of their lists are marked first. Marking changes only
// changed_by, which the triggers don't log. The table names are constants, never from a request.
export function deleteStatements(
  db: D1Database,
  userId: string,
  table: Owner,
  ids: string[],
  source: ChangeSource,
): D1PreparedStatement[] {
  // Every chunk is marked before any is deleted, for links between rows in different chunks
  const chunks = jsonChunks(ids)
  const marks = [`UPDATE ${table} SET changed_by = ?3 WHERE user_id = ?1 AND id IN ${IDS}`, ...LINKED[table]]
  return [
    ...chunks.flatMap((json) => marks.map((sql) => db.prepare(sql).bind(userId, json, source))),
    ...chunks.map((json) => db.prepare(`DELETE FROM ${table} WHERE user_id = ?1 AND id IN ${IDS}`).bind(userId, json)),
  ]
}

// Deletes an account and everything in it, in one batch. history has no foreign key to users,
// since the triggers write to it while the account's data cascades away, so its rows go last,
// after the ones the cascade itself logs. usage_counts goes with the account by its foreign key.
export function deleteAccountStatements(db: D1Database, userId: string): D1PreparedStatement[] {
  return [
    db.prepare('DELETE FROM users WHERE id = ?1').bind(userId),
    db.prepare('DELETE FROM history WHERE user_id = ?1').bind(userId),
  ]
}
