-- Change tracking (src/types/events.ts): an append-only log of when tasks were created, joined and
-- left projects, had their due dates moved, were completed and were deleted, and of when projects
-- were created, had their delivery dates moved and were deleted. It is written in the same batch
-- as the change it describes, and never updated, so how well projects were scoped can be worked
-- out from it later.
--
-- task_id and project_id have no foreign keys, so events outlive the tasks and projects they are
-- about. Deleting the user still deletes their events.

CREATE TABLE task_events (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- never reused, so it orders events logged at the same moment
  at TEXT NOT NULL, -- UTC timestamp
  kind TEXT NOT NULL CHECK (kind IN (
    'task_created', 'task_added_to_project', 'task_removed_from_project', 'due_date_changed',
    'delivery_date_changed', 'task_completed', 'task_reopened', 'task_deleted', 'project_created',
    'project_deleted'
  )),
  task_id TEXT, -- NULL for events about a project
  project_id TEXT, -- NULL for events about a task in no project
  old_value TEXT, -- dates before and after a change, as "2026-10-25"
  new_value TEXT,
  delivery_date_at_time TEXT, -- the project's delivery date once the change was made
  source TEXT NOT NULL CHECK (source IN ('app', 'google', 'backfill')), -- who made the change
  task_source TEXT CHECK (task_source IN ('app', 'google')) -- where the task came from; NULL for a project
);

CREATE INDEX task_events_project ON task_events (user_id, project_id, at);
CREATE INDEX task_events_task ON task_events (user_id, task_id, at);

-- The data from before tracking began, logged as best it can be: each task created when its row
-- was, with the due date it has now, and added to each of its projects at that same moment, since
-- when it really joined isn't known. Marked 'backfill' so analysis can leave these out.
INSERT INTO task_events (user_id, at, kind, task_id, new_value, source, task_source)
SELECT t.user_id, t.created_at, 'task_created', t.id, t.due_date, 'backfill',
  CASE WHEN EXISTS (SELECT 1 FROM google_events g WHERE g.user_id = t.user_id AND g.task_id = t.id) THEN 'google' ELSE 'app' END
FROM tasks t
ORDER BY t.created_at, t.id;

INSERT INTO task_events (user_id, at, kind, task_id, project_id, delivery_date_at_time, source, task_source)
SELECT pt.user_id, t.created_at, 'task_added_to_project', pt.task_id, pt.project_id, p.delivery_date, 'backfill',
  CASE WHEN EXISTS (SELECT 1 FROM google_events g WHERE g.user_id = t.user_id AND g.task_id = t.id) THEN 'google' ELSE 'app' END
FROM project_tasks pt
JOIN tasks t ON t.user_id = pt.user_id AND t.id = pt.task_id
JOIN projects p ON p.user_id = pt.user_id AND p.id = pt.project_id
ORDER BY t.created_at, t.id, p.created_at, p.id;
