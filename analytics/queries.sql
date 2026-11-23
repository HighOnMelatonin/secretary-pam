-- Saved queries over history and usage_counts (README, History and Usage), run by hand against
-- the live database. Every one only reads. Run them by passing this file's text to
-- wrangler d1 execute pam-data --remote --json --command (the README has the exact command for
-- bash and PowerShell), or one at a time by passing only that query. Not --file: with --remote
-- that imports the file instead, which shows no results and makes the database unavailable while
-- it runs. This file has no double quotes, so PowerShell passes it on unchanged.
--
-- SETTINGS. D1 can't bind parameters from the command line, nor keep a view between statements,
-- so each query starts with the same settings line. Change it with find and replace, so every
-- query keeps the same values (worker/__tests__/queries.spec.ts checks they match):
--   email                   whose data to read
--   local_offset            LOCAL TIME, for Singapore: at is UTC, but due and delivery dates are
--                           local dates, so every at is moved by this before it is compared with
--                           a date or put in a day, week or hour
--   planned_within_hours    how soon after its project was made a task counts as planned (query 1)
--   archive_window_seconds  how close to a task's completion an Archive tag counts as the project
--                           being completed (queries 4 and 6)
--   include_google_tasks    1 to count tasks imported from Google Calendar, which are left out by
--                           default: a task is a Google one if it was made by a sync, or if its
--                           baseline row has the Google account it came from
--   audit_id                the task or project whose history query 7 lists
--
-- RULES for all of them. Baseline rows (op = baseline) are never counted as something that
-- happened: they hold the data as it was when history began, stamped with when each row was made.
-- Their ids still come before every logged change, though, so they are used for what the data
-- was at a moment: which projects a task was in, or a project's name or delivery date then. That
-- moment is found by id, not by time, since one save writes many rows in the same millisecond.
--
-- ERRANDS (README, Errands) are tasks with kind errand: personal to-dos in no project. The project
-- metrics (queries 1, 2, 5 and 6) count project tasks only, by the kind a task had at the moment
-- counted. Rows logged before errands existed (migration 0014) have no kind, and are project tasks,
-- as every task was then. Query 10 is about errands alone.

-- 1. Planned or added later (feature creep). Every time a task joined a project: how many hours
-- after the project was made, whether that counts as planned, and how far into the project's
-- life it was, from when it was made to the end of the delivery date in effect then (over 100
-- means after it). Projects made before history began have no creation to measure from.
WITH settings AS (SELECT 'you@example.com' AS email, '+8 hours' AS local_offset, 24 AS planned_within_hours, 10 AS archive_window_seconds, 0 AS include_google_tasks, 'the-task-or-project-id' AS audit_id),
me AS (SELECT users.id AS user_id FROM users, settings WHERE users.email = settings.email),
logged AS (SELECT history.* FROM history JOIN me USING (user_id)),
changes AS (SELECT * FROM logged WHERE op <> 'baseline'),
google_tasks AS (
  SELECT row_key AS task_id FROM logged, settings
  WHERE settings.include_google_tasks = 0 AND table_name = 'tasks'
    AND ((op = 'insert' AND source = 'google') OR (op = 'baseline' AND data ->> '$.google_account' IS NOT NULL))
),
created AS (
  SELECT row_key AS project_id, min(at) AS at FROM changes
  WHERE table_name = 'projects' AND op = 'insert'
  GROUP BY row_key
),
adds AS (
  SELECT a.id, a.at, a.data ->> '$.project_id' AS project_id, a.data ->> '$.task_id' AS task_id,
    (SELECT p.data ->> '$.delivery_date' FROM logged p
     WHERE p.table_name = 'projects' AND p.row_key = a.data ->> '$.project_id' AND p.id < a.id
     ORDER BY p.id DESC LIMIT 1) AS delivery_date
  FROM changes a
  WHERE a.table_name = 'project_tasks' AND a.op = 'insert'
    AND a.data ->> '$.task_id' NOT IN (SELECT task_id FROM google_tasks)
    -- A project task when it joined (an errand can't be in a project, but say so rather than rely on it)
    AND coalesce((SELECT t.data ->> '$.kind' FROM logged t
                  WHERE t.table_name = 'tasks' AND t.row_key = a.data ->> '$.task_id' AND t.id < a.id
                  ORDER BY t.id DESC LIMIT 1), 'task') = 'task'
)
SELECT
  adds.project_id,
  (SELECT p.data ->> '$.name' FROM logged p WHERE p.table_name = 'projects' AND p.row_key = adds.project_id
   ORDER BY p.id DESC LIMIT 1) AS project_name,
  adds.task_id,
  (SELECT t.data ->> '$.name' FROM logged t WHERE t.table_name = 'tasks' AND t.row_key = adds.task_id
   ORDER BY t.id DESC LIMIT 1) AS task_name,
  datetime(adds.at, settings.local_offset) AS added_at_local,
  round((julianday(adds.at) - julianday(created.at)) * 24, 1) AS hours_after_project_made,
  CASE
    WHEN created.at IS NULL THEN 'unknown'
    WHEN (julianday(adds.at) - julianday(created.at)) * 24 <= settings.planned_within_hours THEN 'planned'
    ELSE 'added later'
  END AS kind,
  adds.delivery_date AS delivery_date_then,
  round(100.0 * (julianday(datetime(adds.at, settings.local_offset)) - julianday(datetime(created.at, settings.local_offset)))
    / nullif(julianday(adds.delivery_date, '+1 day') - julianday(datetime(created.at, settings.local_offset)), 0), 1)
    AS percent_of_lifespan
FROM adds
CROSS JOIN settings
LEFT JOIN created ON created.project_id = adds.project_id
ORDER BY adds.project_id, adds.id;

-- 2. Task completion rate. Project tasks ticked off, and reopened (unticked), in each local week
-- (from Monday): over all of them, and for each project the task was in when it was ticked off or
-- reopened. Errands are in query 10.
WITH settings AS (SELECT 'you@example.com' AS email, '+8 hours' AS local_offset, 24 AS planned_within_hours, 10 AS archive_window_seconds, 0 AS include_google_tasks, 'the-task-or-project-id' AS audit_id),
me AS (SELECT users.id AS user_id FROM users, settings WHERE users.email = settings.email),
logged AS (SELECT history.* FROM history JOIN me USING (user_id)),
changes AS (SELECT * FROM logged WHERE op <> 'baseline'),
google_tasks AS (
  SELECT row_key AS task_id FROM logged, settings
  WHERE settings.include_google_tasks = 0 AND table_name = 'tasks'
    AND ((op = 'insert' AND source = 'google') OR (op = 'baseline' AND data ->> '$.google_account' IS NOT NULL))
),
ticks AS (
  SELECT c.id, c.row_key AS task_id,
    date(datetime(c.at, settings.local_offset), '-6 days', 'weekday 1') AS week,
    CASE WHEN c.data ->> '$.completed' = 1 THEN 1 ELSE 0 END AS completed,
    CASE WHEN c.data ->> '$.completed' = 0 THEN 1 ELSE 0 END AS reopened
  FROM changes c, settings
  WHERE c.table_name = 'tasks' AND c.op = 'update'
    AND c.old_data ->> '$.completed' IS NOT c.data ->> '$.completed'
    AND c.row_key NOT IN (SELECT task_id FROM google_tasks)
    AND coalesce(c.data ->> '$.kind', 'task') = 'task'
),
-- Each tick with each project the task was in just before it: the link's latest row then is an
-- insert or its baseline, not a delete
in_projects AS (
  SELECT ticks.*, m.data ->> '$.project_id' AS project_id
  FROM ticks
  JOIN logged m ON m.table_name = 'project_tasks' AND m.data ->> '$.task_id' = ticks.task_id
    AND m.id < ticks.id AND m.op IN ('insert', 'baseline')
    AND NOT EXISTS (
      SELECT 1 FROM logged later
      WHERE later.table_name = 'project_tasks' AND later.row_key = m.row_key AND later.id > m.id AND later.id < ticks.id
    )
)
SELECT * FROM (
  SELECT week, NULL AS project_id, '(all tasks)' AS project, sum(completed) AS completed, sum(reopened) AS reopened
  FROM ticks GROUP BY week
  UNION ALL
  SELECT week, project_id,
    (SELECT p.data ->> '$.name' FROM logged p WHERE p.table_name = 'projects' AND p.row_key = in_projects.project_id
     ORDER BY p.id DESC LIMIT 1),
    sum(completed), sum(reopened)
  FROM in_projects GROUP BY week, project_id
)
ORDER BY week, project_id IS NOT NULL, project;

-- 3. Projects created, in each local week (from Monday) and month
WITH settings AS (SELECT 'you@example.com' AS email, '+8 hours' AS local_offset, 24 AS planned_within_hours, 10 AS archive_window_seconds, 0 AS include_google_tasks, 'the-task-or-project-id' AS audit_id),
me AS (SELECT users.id AS user_id FROM users, settings WHERE users.email = settings.email),
logged AS (SELECT history.* FROM history JOIN me USING (user_id)),
changes AS (SELECT * FROM logged WHERE op <> 'baseline'),
made AS (
  SELECT date(datetime(changes.at, settings.local_offset)) AS day FROM changes, settings
  WHERE changes.table_name = 'projects' AND changes.op = 'insert'
)
SELECT * FROM (
  SELECT 'week' AS period, date(day, '-6 days', 'weekday 1') AS starting, count(*) AS projects_created FROM made GROUP BY 2
  UNION ALL
  SELECT 'month', strftime('%Y-%m-01', day), count(*) FROM made GROUP BY 2
)
ORDER BY period DESC, starting;

-- 4. Projects completed. The app gives a project the Archive tag (id archive) when its last task is
-- ticked off, in the same save, so an Archive tag added within archive_window_seconds of ticking
-- off a task that was in the project counts as the project being completed. Any other Archive tag
-- was added by hand: the project was put on hold or archived. This is a heuristic: the history
-- doesn't record why a tag was added, and a hand-added tag right after a tick would count as
-- completed. Google tasks count here, since they can complete a project too.
WITH settings AS (SELECT 'you@example.com' AS email, '+8 hours' AS local_offset, 24 AS planned_within_hours, 10 AS archive_window_seconds, 0 AS include_google_tasks, 'the-task-or-project-id' AS audit_id),
me AS (SELECT users.id AS user_id FROM users, settings WHERE users.email = settings.email),
logged AS (SELECT history.* FROM history JOIN me USING (user_id)),
changes AS (SELECT * FROM logged WHERE op <> 'baseline'),
ticked AS (
  SELECT id, at, row_key AS task_id FROM changes
  WHERE table_name = 'tasks' AND op = 'update' AND old_data ->> '$.completed' = 0 AND data ->> '$.completed' = 1
),
archived AS (
  SELECT a.id, a.at, a.data ->> '$.project_id' AS project_id,
    EXISTS (
      SELECT 1 FROM ticked, settings
      WHERE abs(julianday(a.at) - julianday(ticked.at)) * 86400 <= settings.archive_window_seconds
        AND EXISTS (
          SELECT 1 FROM logged m
          WHERE m.table_name = 'project_tasks' AND m.row_key = (a.data ->> '$.project_id') || ':' || ticked.task_id
            AND m.id < ticked.id AND m.op IN ('insert', 'baseline')
            AND NOT EXISTS (
              SELECT 1 FROM logged later
              WHERE later.table_name = 'project_tasks' AND later.row_key = m.row_key AND later.id > m.id AND later.id < ticked.id
            )
        )
    ) AS completed
  FROM changes a
  WHERE a.table_name = 'project_tags' AND a.op = 'insert' AND a.data ->> '$.tag_id' = 'archive'
)
SELECT
  archived.project_id,
  (SELECT p.data ->> '$.name' FROM logged p WHERE p.table_name = 'projects' AND p.row_key = archived.project_id
   ORDER BY p.id DESC LIMIT 1) AS project_name,
  datetime(archived.at, settings.local_offset) AS archived_at_local,
  CASE WHEN archived.completed THEN 'completed' ELSE 'put on hold / archived manually' END AS outcome
FROM archived, settings
ORDER BY archived.id;

-- 5. Deadline extensions. Each time a project task's due date or a project's delivery date moved
-- later, counted for each project, with the days added. A task's extension counts for every project
-- it was in at the time, or under no project. Setting a first date, clearing one, moving one
-- earlier and changing a start date aren't extensions, and nor is an errand's due date moving.
WITH settings AS (SELECT 'you@example.com' AS email, '+8 hours' AS local_offset, 24 AS planned_within_hours, 10 AS archive_window_seconds, 0 AS include_google_tasks, 'the-task-or-project-id' AS audit_id),
me AS (SELECT users.id AS user_id FROM users, settings WHERE users.email = settings.email),
logged AS (SELECT history.* FROM history JOIN me USING (user_id)),
changes AS (SELECT * FROM logged WHERE op <> 'baseline'),
google_tasks AS (
  SELECT row_key AS task_id FROM logged, settings
  WHERE settings.include_google_tasks = 0 AND table_name = 'tasks'
    AND ((op = 'insert' AND source = 'google') OR (op = 'baseline' AND data ->> '$.google_account' IS NOT NULL))
),
moves AS (
  SELECT id, 'task due date' AS kind, row_key AS item_id, old_data ->> '$.due_date' AS old_date, data ->> '$.due_date' AS new_date
  FROM changes
  WHERE table_name = 'tasks' AND op = 'update' AND data ->> '$.due_date' > old_data ->> '$.due_date'
    AND row_key NOT IN (SELECT task_id FROM google_tasks)
    AND coalesce(data ->> '$.kind', 'task') = 'task'
  UNION ALL
  SELECT id, 'delivery date', row_key, old_data ->> '$.delivery_date', data ->> '$.delivery_date'
  FROM changes
  WHERE table_name = 'projects' AND op = 'update' AND data ->> '$.delivery_date' > old_data ->> '$.delivery_date'
),
by_project AS (
  SELECT moves.*, moves.item_id AS project_id FROM moves WHERE kind = 'delivery date'
  UNION ALL
  SELECT moves.*, m.data ->> '$.project_id'
  FROM moves
  LEFT JOIN logged m ON m.table_name = 'project_tasks' AND m.data ->> '$.task_id' = moves.item_id
    AND m.id < moves.id AND m.op IN ('insert', 'baseline')
    AND NOT EXISTS (
      SELECT 1 FROM logged later
      WHERE later.table_name = 'project_tasks' AND later.row_key = m.row_key AND later.id > m.id AND later.id < moves.id
    )
  WHERE moves.kind = 'task due date'
)
SELECT
  project_id,
  coalesce((SELECT p.data ->> '$.name' FROM logged p WHERE p.table_name = 'projects' AND p.row_key = by_project.project_id
            ORDER BY p.id DESC LIMIT 1), '(no project)') AS project_name,
  kind,
  count(*) AS extensions,
  CAST(sum(julianday(new_date) - julianday(old_date)) AS INTEGER) AS days_added
FROM by_project
GROUP BY project_id, kind
ORDER BY project_id IS NULL, project_name, kind;

-- 6. Deadlines met. Each project task ticked off, on time if its local completion date is no later
-- than its due date, and each project completed (as in query 4) against its delivery date at that
-- moment. Items with no date are listed as no date and left out of on_time_percent. Errands aren't
-- judged here; query 10 has them.
WITH settings AS (SELECT 'you@example.com' AS email, '+8 hours' AS local_offset, 24 AS planned_within_hours, 10 AS archive_window_seconds, 0 AS include_google_tasks, 'the-task-or-project-id' AS audit_id),
me AS (SELECT users.id AS user_id FROM users, settings WHERE users.email = settings.email),
logged AS (SELECT history.* FROM history JOIN me USING (user_id)),
changes AS (SELECT * FROM logged WHERE op <> 'baseline'),
google_tasks AS (
  SELECT row_key AS task_id FROM logged, settings
  WHERE settings.include_google_tasks = 0 AND table_name = 'tasks'
    AND ((op = 'insert' AND source = 'google') OR (op = 'baseline' AND data ->> '$.google_account' IS NOT NULL))
),
ticked AS (
  SELECT id, at, row_key AS task_id, data FROM changes
  WHERE table_name = 'tasks' AND op = 'update' AND old_data ->> '$.completed' = 0 AND data ->> '$.completed' = 1
),
completed_projects AS (
  SELECT a.id, a.at, a.data ->> '$.project_id' AS project_id
  FROM changes a
  WHERE a.table_name = 'project_tags' AND a.op = 'insert' AND a.data ->> '$.tag_id' = 'archive'
    AND EXISTS (
      SELECT 1 FROM ticked, settings
      WHERE abs(julianday(a.at) - julianday(ticked.at)) * 86400 <= settings.archive_window_seconds
        AND EXISTS (
          SELECT 1 FROM logged m
          WHERE m.table_name = 'project_tasks' AND m.row_key = (a.data ->> '$.project_id') || ':' || ticked.task_id
            AND m.id < ticked.id AND m.op IN ('insert', 'baseline')
            AND NOT EXISTS (
              SELECT 1 FROM logged later
              WHERE later.table_name = 'project_tasks' AND later.row_key = m.row_key AND later.id > m.id AND later.id < ticked.id
            )
        )
    )
),
items AS (
  SELECT 'task' AS kind, ticked.task_id AS id, ticked.data ->> '$.name' AS name,
    date(datetime(ticked.at, settings.local_offset)) AS done_on, ticked.data ->> '$.due_date' AS deadline
  FROM ticked, settings
  WHERE ticked.task_id NOT IN (SELECT task_id FROM google_tasks)
    AND coalesce(ticked.data ->> '$.kind', 'task') = 'task'
  UNION ALL
  SELECT 'project', c.project_id,
    (SELECT p.data ->> '$.name' FROM logged p WHERE p.table_name = 'projects' AND p.row_key = c.project_id AND p.id < c.id
     ORDER BY p.id DESC LIMIT 1),
    date(datetime(c.at, settings.local_offset)),
    (SELECT p.data ->> '$.delivery_date' FROM logged p WHERE p.table_name = 'projects' AND p.row_key = c.project_id AND p.id < c.id
     ORDER BY p.id DESC LIMIT 1)
  FROM completed_projects c, settings
),
judged AS (
  SELECT items.*,
    CASE WHEN deadline IS NULL THEN 'no date' WHEN done_on <= deadline THEN 'on time' ELSE 'late' END AS status
  FROM items
)
SELECT kind, id, name, done_on, deadline, status,
  round(100.0 * sum(status = 'on time') OVER (PARTITION BY kind) / nullif(sum(status <> 'no date') OVER (PARTITION BY kind), 0), 1)
    AS on_time_percent
FROM judged
ORDER BY kind, status = 'no date', done_on, id;

-- 7. Audit. Everything logged about one task or project (audit_id in the settings line): its own
-- rows and the rows of the lists it is in or holds, oldest first. Its baseline row is included,
-- marked as such, since it's where the history of a row from before history began starts.
WITH settings AS (SELECT 'you@example.com' AS email, '+8 hours' AS local_offset, 24 AS planned_within_hours, 10 AS archive_window_seconds, 0 AS include_google_tasks, 'the-task-or-project-id' AS audit_id),
me AS (SELECT users.id AS user_id FROM users, settings WHERE users.email = settings.email),
logged AS (SELECT history.* FROM history JOIN me USING (user_id))
SELECT logged.id, datetime(logged.at, settings.local_offset) AS at_local, logged.table_name, logged.row_key, logged.op,
  logged.source, logged.data, logged.old_data
FROM logged, settings
WHERE (logged.table_name IN ('tasks', 'projects') AND logged.row_key = settings.audit_id)
  OR (logged.table_name IN ('project_tasks', 'project_tags', 'task_tags', 'task_relations') AND settings.audit_id IN (
    logged.data ->> '$.project_id', logged.data ->> '$.task_id', logged.data ->> '$.related_task_id'
  ))
ORDER BY logged.id;

-- 8. Usage by client. Actions from each client in each local week (from Monday), with its share of
-- that week, then over all time.
WITH settings AS (SELECT 'you@example.com' AS email, '+8 hours' AS local_offset, 24 AS planned_within_hours, 10 AS archive_window_seconds, 0 AS include_google_tasks, 'the-task-or-project-id' AS audit_id),
me AS (SELECT users.id AS user_id FROM users, settings WHERE users.email = settings.email),
counted AS (
  SELECT u.client, u.count, datetime(u.day_utc || ' ' || printf('%02d:00:00', u.hour_utc), settings.local_offset) AS local
  FROM usage_counts u JOIN me USING (user_id), settings
),
weekly AS (
  SELECT date(local, '-6 days', 'weekday 1') AS week, client, sum(count) AS actions FROM counted GROUP BY 1, 2
)
SELECT * FROM (
  SELECT week, client, actions, round(100.0 * actions / sum(actions) OVER (PARTITION BY week), 1) AS percent
  FROM weekly
  UNION ALL
  SELECT 'all time', client, sum(count), round(100.0 * sum(count) / (SELECT sum(count) FROM counted), 1)
  FROM counted GROUP BY client
)
ORDER BY week = 'all time', week, client;

-- 9. Usage by time of day. Actions in each local hour (0 to 23) from each client: on all days, then
-- on weekdays and at weekends apart.
WITH settings AS (SELECT 'you@example.com' AS email, '+8 hours' AS local_offset, 24 AS planned_within_hours, 10 AS archive_window_seconds, 0 AS include_google_tasks, 'the-task-or-project-id' AS audit_id),
me AS (SELECT users.id AS user_id FROM users, settings WHERE users.email = settings.email),
counted AS (
  SELECT u.client, u.count, datetime(u.day_utc || ' ' || printf('%02d:00:00', u.hour_utc), settings.local_offset) AS local
  FROM usage_counts u JOIN me USING (user_id), settings
)
SELECT * FROM (
  SELECT 'all days' AS days, CAST(strftime('%H', local) AS INTEGER) AS local_hour, client, sum(count) AS actions
  FROM counted GROUP BY 2, 3
  UNION ALL
  SELECT CASE WHEN strftime('%w', local) IN ('0', '6') THEN 'weekends' ELSE 'weekdays' END, CAST(strftime('%H', local) AS INTEGER),
    client, sum(count)
  FROM counted GROUP BY 1, 2, 3
)
ORDER BY days, local_hour, client;

-- 10. Errands. How many were ticked off in each local week (from Monday) and over all time, how many
-- of those had rolled over, and by how many days on average: from the day each was planned for
-- when it was ticked off (its pinned_date then) to its local completion date, 0 when done on or
-- before that day. Today, Tomorrow and Pick date in the bot, and a new planned day in the app, move
-- that day on, so avg_days_since_first_planned also counts from the day it was first planned for.
WITH settings AS (SELECT 'you@example.com' AS email, '+8 hours' AS local_offset, 24 AS planned_within_hours, 10 AS archive_window_seconds, 0 AS include_google_tasks, 'the-task-or-project-id' AS audit_id),
me AS (SELECT users.id AS user_id FROM users, settings WHERE users.email = settings.email),
logged AS (SELECT history.* FROM history JOIN me USING (user_id)),
changes AS (SELECT * FROM logged WHERE op <> 'baseline'),
done AS (
  SELECT c.id, date(datetime(c.at, settings.local_offset)) AS done_on, c.data ->> '$.pinned_date' AS planned,
    (SELECT f.data ->> '$.pinned_date' FROM logged f
     WHERE f.table_name = 'tasks' AND f.row_key = c.row_key AND f.op IN ('insert', 'baseline')
     ORDER BY f.id LIMIT 1) AS first_planned
  FROM changes c, settings
  WHERE c.table_name = 'tasks' AND c.op = 'update' AND c.data ->> '$.kind' = 'errand'
    AND c.old_data ->> '$.completed' = 0 AND c.data ->> '$.completed' = 1
),
judged AS (
  SELECT date(done_on, '-6 days', 'weekday 1') AS week,
    max(0, julianday(done_on) - julianday(planned)) AS carried,
    max(0, julianday(done_on) - julianday(coalesce(first_planned, planned))) AS since_first
  FROM done
)
SELECT * FROM (
  SELECT week, count(*) AS completed, sum(carried > 0) AS rolled_over, round(avg(carried), 1) AS avg_days_carried,
    round(avg(since_first), 1) AS avg_days_since_first_planned
  FROM judged GROUP BY week
  UNION ALL
  SELECT 'all time', count(*), sum(carried > 0), round(avg(carried), 1), round(avg(since_first), 1) FROM judged
)
ORDER BY week = 'all time', week;
