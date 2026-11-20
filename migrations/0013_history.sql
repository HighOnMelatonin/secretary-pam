-- History (README, "History"): an append-only log of every change to tasks, projects, tags and the
-- tables holding their lists, written by triggers, so every write path is logged without each one
-- having to remember to: the app, the Telegram bot, the Google sync and cascading deletes alike.
-- And usage_counts: how many actions each account takes, from which client, in each UTC hour.
--
-- !! ANY LATER MIGRATION THAT ADDS A COLUMN TO tasks, projects, tags, project_tasks, project_tags,
-- !! task_tags OR task_relations MUST DROP AND RECREATE THAT TABLE'S TRIGGERS BELOW WITH THE NEW
-- !! COLUMN IN THEIR json_object(...) (and, for an update trigger, in its WHEN), or the new column
-- !! won't be recorded. A migration that rebuilds one of these tables drops its triggers with it, so
-- !! it must recreate them too.
--
-- Each trigger is written across several lines, ending with END; on a line of its own, which is
-- how worker/migrate.ts tells where a trigger ends.

-- Who made each row's latest change, for the triggers to log as the source: web-desktop or
-- web-mobile (the web app's X-Pam-Client header), telegram (the bot), google (the sync), or unknown
-- (a request without the header). Every write sets it; the API never returns it.
ALTER TABLE tasks ADD COLUMN changed_by TEXT NOT NULL DEFAULT 'unknown'
  CHECK (changed_by IN ('web-desktop', 'web-mobile', 'telegram', 'google', 'unknown'));

ALTER TABLE projects ADD COLUMN changed_by TEXT NOT NULL DEFAULT 'unknown'
  CHECK (changed_by IN ('web-desktop', 'web-mobile', 'telegram', 'google', 'unknown'));

ALTER TABLE tags ADD COLUMN changed_by TEXT NOT NULL DEFAULT 'unknown'
  CHECK (changed_by IN ('web-desktop', 'web-mobile', 'telegram', 'google', 'unknown'));

-- No foreign keys, so history outlives the rows it is about. Not even to users: the triggers write
-- rows while a deleted account's data cascades away, which a foreign key to users would refuse, so
-- deleting an account deletes its history explicitly (deleteAccountStatements in worker/history.ts).
CREATE TABLE history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- never reused, so it orders rows logged in the same moment
  user_id TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), -- UTC timestamp
  table_name TEXT NOT NULL CHECK (table_name IN (
    'tasks', 'projects', 'tags', 'project_tasks', 'project_tags', 'task_tags', 'task_relations'
  )),
  row_key TEXT NOT NULL, -- the row's id; for a list table, its two ids, as "project_id:task_id"
  op TEXT NOT NULL CHECK (op IN ('insert', 'update', 'delete', 'baseline')),
  source TEXT NOT NULL CHECK (source IN ('web-desktop', 'web-mobile', 'telegram', 'google', 'unknown', 'baseline')),
  data TEXT NOT NULL, -- the row as JSON after the change; for a delete, before it
  old_data TEXT -- the row as JSON before an update; NULL for every other op
);

CREATE INDEX history_row ON history (user_id, table_name, row_key, id);
CREATE INDEX history_at ON history (user_id, at);

-- Rows are only ever added. Deleting is still allowed, for deleting an account.
CREATE TRIGGER history_append_only BEFORE UPDATE ON history
BEGIN
  SELECT RAISE(ABORT, 'history is append-only');
END;

-- tasks. An update is logged only when something other than updated_at or changed_by changed, so a
-- save that changes nothing logs nothing, and nor does marking who is about to delete a row.

CREATE TRIGGER history_tasks_insert AFTER INSERT ON tasks
BEGIN
  INSERT INTO history (user_id, table_name, row_key, op, source, data)
  VALUES (NEW.user_id, 'tasks', NEW.id, 'insert', NEW.changed_by,
    json_object('id', NEW.id, 'name', NEW.name, 'description', NEW.description, 'due_date', NEW.due_date,
      'priority', NEW.priority, 'completed', NEW.completed, 'effort_minutes', NEW.effort_minutes,
      'start_date', NEW.start_date, 'pinned_date', NEW.pinned_date, 'created_at', NEW.created_at,
      'updated_at', NEW.updated_at));
END;

CREATE TRIGGER history_tasks_update AFTER UPDATE ON tasks
WHEN OLD.user_id IS NOT NEW.user_id OR OLD.id IS NOT NEW.id OR OLD.name IS NOT NEW.name
  OR OLD.description IS NOT NEW.description OR OLD.due_date IS NOT NEW.due_date
  OR OLD.priority IS NOT NEW.priority OR OLD.completed IS NOT NEW.completed
  OR OLD.effort_minutes IS NOT NEW.effort_minutes OR OLD.start_date IS NOT NEW.start_date
  OR OLD.pinned_date IS NOT NEW.pinned_date OR OLD.created_at IS NOT NEW.created_at
BEGIN
  INSERT INTO history (user_id, table_name, row_key, op, source, data, old_data)
  VALUES (NEW.user_id, 'tasks', NEW.id, 'update', NEW.changed_by,
    json_object('id', NEW.id, 'name', NEW.name, 'description', NEW.description, 'due_date', NEW.due_date,
      'priority', NEW.priority, 'completed', NEW.completed, 'effort_minutes', NEW.effort_minutes,
      'start_date', NEW.start_date, 'pinned_date', NEW.pinned_date, 'created_at', NEW.created_at,
      'updated_at', NEW.updated_at),
    json_object('id', OLD.id, 'name', OLD.name, 'description', OLD.description, 'due_date', OLD.due_date,
      'priority', OLD.priority, 'completed', OLD.completed, 'effort_minutes', OLD.effort_minutes,
      'start_date', OLD.start_date, 'pinned_date', OLD.pinned_date, 'created_at', OLD.created_at,
      'updated_at', OLD.updated_at));
END;

CREATE TRIGGER history_tasks_delete AFTER DELETE ON tasks
BEGIN
  INSERT INTO history (user_id, table_name, row_key, op, source, data)
  VALUES (OLD.user_id, 'tasks', OLD.id, 'delete', OLD.changed_by,
    json_object('id', OLD.id, 'name', OLD.name, 'description', OLD.description, 'due_date', OLD.due_date,
      'priority', OLD.priority, 'completed', OLD.completed, 'effort_minutes', OLD.effort_minutes,
      'start_date', OLD.start_date, 'pinned_date', OLD.pinned_date, 'created_at', OLD.created_at,
      'updated_at', OLD.updated_at));
END;

-- projects. tag_id went in 0004, so isn't here.

CREATE TRIGGER history_projects_insert AFTER INSERT ON projects
BEGIN
  INSERT INTO history (user_id, table_name, row_key, op, source, data)
  VALUES (NEW.user_id, 'projects', NEW.id, 'insert', NEW.changed_by,
    json_object('id', NEW.id, 'name', NEW.name, 'description', NEW.description,
      'delivery_date', NEW.delivery_date, 'priority', NEW.priority, 'created_at', NEW.created_at,
      'updated_at', NEW.updated_at));
END;

CREATE TRIGGER history_projects_update AFTER UPDATE ON projects
WHEN OLD.user_id IS NOT NEW.user_id OR OLD.id IS NOT NEW.id OR OLD.name IS NOT NEW.name
  OR OLD.description IS NOT NEW.description OR OLD.delivery_date IS NOT NEW.delivery_date
  OR OLD.priority IS NOT NEW.priority OR OLD.created_at IS NOT NEW.created_at
BEGIN
  INSERT INTO history (user_id, table_name, row_key, op, source, data, old_data)
  VALUES (NEW.user_id, 'projects', NEW.id, 'update', NEW.changed_by,
    json_object('id', NEW.id, 'name', NEW.name, 'description', NEW.description,
      'delivery_date', NEW.delivery_date, 'priority', NEW.priority, 'created_at', NEW.created_at,
      'updated_at', NEW.updated_at),
    json_object('id', OLD.id, 'name', OLD.name, 'description', OLD.description,
      'delivery_date', OLD.delivery_date, 'priority', OLD.priority, 'created_at', OLD.created_at,
      'updated_at', OLD.updated_at));
END;

CREATE TRIGGER history_projects_delete AFTER DELETE ON projects
BEGIN
  INSERT INTO history (user_id, table_name, row_key, op, source, data)
  VALUES (OLD.user_id, 'projects', OLD.id, 'delete', OLD.changed_by,
    json_object('id', OLD.id, 'name', OLD.name, 'description', OLD.description,
      'delivery_date', OLD.delivery_date, 'priority', OLD.priority, 'created_at', OLD.created_at,
      'updated_at', OLD.updated_at));
END;

-- tags

CREATE TRIGGER history_tags_insert AFTER INSERT ON tags
BEGIN
  INSERT INTO history (user_id, table_name, row_key, op, source, data)
  VALUES (NEW.user_id, 'tags', NEW.id, 'insert', NEW.changed_by,
    json_object('id', NEW.id, 'name', NEW.name, 'color', NEW.color, 'created_at', NEW.created_at,
      'updated_at', NEW.updated_at));
END;

CREATE TRIGGER history_tags_update AFTER UPDATE ON tags
WHEN OLD.user_id IS NOT NEW.user_id OR OLD.id IS NOT NEW.id OR OLD.name IS NOT NEW.name
  OR OLD.color IS NOT NEW.color OR OLD.created_at IS NOT NEW.created_at
BEGIN
  INSERT INTO history (user_id, table_name, row_key, op, source, data, old_data)
  VALUES (NEW.user_id, 'tags', NEW.id, 'update', NEW.changed_by,
    json_object('id', NEW.id, 'name', NEW.name, 'color', NEW.color, 'created_at', NEW.created_at,
      'updated_at', NEW.updated_at),
    json_object('id', OLD.id, 'name', OLD.name, 'color', OLD.color, 'created_at', OLD.created_at,
      'updated_at', OLD.updated_at));
END;

CREATE TRIGGER history_tags_delete AFTER DELETE ON tags
BEGIN
  INSERT INTO history (user_id, table_name, row_key, op, source, data)
  VALUES (OLD.user_id, 'tags', OLD.id, 'delete', OLD.changed_by,
    json_object('id', OLD.id, 'name', OLD.name, 'color', OLD.color, 'created_at', OLD.created_at,
      'updated_at', OLD.updated_at));
END;

-- The list tables have no changed_by of their own: a row takes its source from the row that owns
-- the list, and from its other row when that one is gone. A cascade deletes a list row after the
-- row it hangs from, so deleting a task leaves its project_tasks rows only their projects to read;
-- that's why a delete first marks the rows on the other side of its links with who is deleting
-- (worker/history.ts). Their positions change as lists are reordered, which isn't logged, so
-- project_tasks, project_tags and task_tags, whose only other column is position, have no update
-- trigger.

CREATE TRIGGER history_project_tasks_insert AFTER INSERT ON project_tasks
BEGIN
  INSERT INTO history (user_id, table_name, row_key, op, source, data)
  VALUES (NEW.user_id, 'project_tasks', NEW.project_id || ':' || NEW.task_id, 'insert',
    coalesce(
      (SELECT changed_by FROM projects WHERE user_id = NEW.user_id AND id = NEW.project_id),
      (SELECT changed_by FROM tasks WHERE user_id = NEW.user_id AND id = NEW.task_id),
      'unknown'),
    json_object('project_id', NEW.project_id, 'task_id', NEW.task_id, 'position', NEW.position));
END;

CREATE TRIGGER history_project_tasks_delete AFTER DELETE ON project_tasks
BEGIN
  INSERT INTO history (user_id, table_name, row_key, op, source, data)
  VALUES (OLD.user_id, 'project_tasks', OLD.project_id || ':' || OLD.task_id, 'delete',
    coalesce(
      (SELECT changed_by FROM projects WHERE user_id = OLD.user_id AND id = OLD.project_id),
      (SELECT changed_by FROM tasks WHERE user_id = OLD.user_id AND id = OLD.task_id),
      'unknown'),
    json_object('project_id', OLD.project_id, 'task_id', OLD.task_id, 'position', OLD.position));
END;

CREATE TRIGGER history_project_tags_insert AFTER INSERT ON project_tags
BEGIN
  INSERT INTO history (user_id, table_name, row_key, op, source, data)
  VALUES (NEW.user_id, 'project_tags', NEW.project_id || ':' || NEW.tag_id, 'insert',
    coalesce(
      (SELECT changed_by FROM projects WHERE user_id = NEW.user_id AND id = NEW.project_id),
      (SELECT changed_by FROM tags WHERE user_id = NEW.user_id AND id = NEW.tag_id),
      'unknown'),
    json_object('project_id', NEW.project_id, 'tag_id', NEW.tag_id, 'position', NEW.position));
END;

CREATE TRIGGER history_project_tags_delete AFTER DELETE ON project_tags
BEGIN
  INSERT INTO history (user_id, table_name, row_key, op, source, data)
  VALUES (OLD.user_id, 'project_tags', OLD.project_id || ':' || OLD.tag_id, 'delete',
    coalesce(
      (SELECT changed_by FROM projects WHERE user_id = OLD.user_id AND id = OLD.project_id),
      (SELECT changed_by FROM tags WHERE user_id = OLD.user_id AND id = OLD.tag_id),
      'unknown'),
    json_object('project_id', OLD.project_id, 'tag_id', OLD.tag_id, 'position', OLD.position));
END;

CREATE TRIGGER history_task_tags_insert AFTER INSERT ON task_tags
BEGIN
  INSERT INTO history (user_id, table_name, row_key, op, source, data)
  VALUES (NEW.user_id, 'task_tags', NEW.task_id || ':' || NEW.tag_id, 'insert',
    coalesce(
      (SELECT changed_by FROM tasks WHERE user_id = NEW.user_id AND id = NEW.task_id),
      (SELECT changed_by FROM tags WHERE user_id = NEW.user_id AND id = NEW.tag_id),
      'unknown'),
    json_object('task_id', NEW.task_id, 'tag_id', NEW.tag_id, 'position', NEW.position));
END;

CREATE TRIGGER history_task_tags_delete AFTER DELETE ON task_tags
BEGIN
  INSERT INTO history (user_id, table_name, row_key, op, source, data)
  VALUES (OLD.user_id, 'task_tags', OLD.task_id || ':' || OLD.tag_id, 'delete',
    coalesce(
      (SELECT changed_by FROM tasks WHERE user_id = OLD.user_id AND id = OLD.task_id),
      (SELECT changed_by FROM tags WHERE user_id = OLD.user_id AND id = OLD.tag_id),
      'unknown'),
    json_object('task_id', OLD.task_id, 'tag_id', OLD.tag_id, 'position', OLD.position));
END;

-- A relation's type can change in place, which is logged; its position alone isn't
CREATE TRIGGER history_task_relations_insert AFTER INSERT ON task_relations
BEGIN
  INSERT INTO history (user_id, table_name, row_key, op, source, data)
  VALUES (NEW.user_id, 'task_relations', NEW.task_id || ':' || NEW.related_task_id, 'insert',
    coalesce(
      (SELECT changed_by FROM tasks WHERE user_id = NEW.user_id AND id = NEW.task_id),
      (SELECT changed_by FROM tasks WHERE user_id = NEW.user_id AND id = NEW.related_task_id),
      'unknown'),
    json_object('task_id', NEW.task_id, 'related_task_id', NEW.related_task_id, 'type', NEW.type,
      'position', NEW.position));
END;

CREATE TRIGGER history_task_relations_update AFTER UPDATE ON task_relations
WHEN OLD.user_id IS NOT NEW.user_id OR OLD.task_id IS NOT NEW.task_id
  OR OLD.related_task_id IS NOT NEW.related_task_id OR OLD.type IS NOT NEW.type
BEGIN
  INSERT INTO history (user_id, table_name, row_key, op, source, data, old_data)
  VALUES (NEW.user_id, 'task_relations', NEW.task_id || ':' || NEW.related_task_id, 'update',
    coalesce(
      (SELECT changed_by FROM tasks WHERE user_id = NEW.user_id AND id = NEW.task_id),
      (SELECT changed_by FROM tasks WHERE user_id = NEW.user_id AND id = NEW.related_task_id),
      'unknown'),
    json_object('task_id', NEW.task_id, 'related_task_id', NEW.related_task_id, 'type', NEW.type,
      'position', NEW.position),
    json_object('task_id', OLD.task_id, 'related_task_id', OLD.related_task_id, 'type', OLD.type,
      'position', OLD.position));
END;

CREATE TRIGGER history_task_relations_delete AFTER DELETE ON task_relations
BEGIN
  INSERT INTO history (user_id, table_name, row_key, op, source, data)
  VALUES (OLD.user_id, 'task_relations', OLD.task_id || ':' || OLD.related_task_id, 'delete',
    coalesce(
      (SELECT changed_by FROM tasks WHERE user_id = OLD.user_id AND id = OLD.task_id),
      (SELECT changed_by FROM tasks WHERE user_id = OLD.user_id AND id = OLD.related_task_id),
      'unknown'),
    json_object('task_id', OLD.task_id, 'related_task_id', OLD.related_task_id, 'type', OLD.type,
      'position', OLD.position));
END;

-- The baseline: every row as it is now, so the history of a row from before this migration has
-- somewhere to start. Each is stamped with its row's created_at, or with now for the list tables,
-- which have none, but holds today's values, not the ones it was created with; analysis leaves
-- these rows out. Their ids still come before every logged change, so the state they show is right
-- for "as it was just before the first change". A task's baseline also has the Google account it
-- was imported from, as google_account, since an imported task has no logged insert to show it.
INSERT INTO history (user_id, at, table_name, row_key, op, source, data)
SELECT t.user_id, t.created_at, 'tasks', t.id, 'baseline', 'baseline',
  json_object('id', t.id, 'name', t.name, 'description', t.description, 'due_date', t.due_date,
    'priority', t.priority, 'completed', t.completed, 'effort_minutes', t.effort_minutes,
    'start_date', t.start_date, 'pinned_date', t.pinned_date, 'created_at', t.created_at,
    'updated_at', t.updated_at, 'google_account', g.account_email)
FROM tasks t
LEFT JOIN google_events g ON g.user_id = t.user_id AND g.task_id = t.id
ORDER BY t.created_at, t.user_id, t.id;

INSERT INTO history (user_id, at, table_name, row_key, op, source, data)
SELECT user_id, created_at, 'projects', id, 'baseline', 'baseline',
  json_object('id', id, 'name', name, 'description', description, 'delivery_date', delivery_date,
    'priority', priority, 'created_at', created_at, 'updated_at', updated_at)
FROM projects
ORDER BY created_at, user_id, id;

INSERT INTO history (user_id, at, table_name, row_key, op, source, data)
SELECT user_id, created_at, 'tags', id, 'baseline', 'baseline',
  json_object('id', id, 'name', name, 'color', color, 'created_at', created_at, 'updated_at', updated_at)
FROM tags
ORDER BY created_at, user_id, id;

INSERT INTO history (user_id, table_name, row_key, op, source, data)
SELECT user_id, 'project_tasks', project_id || ':' || task_id, 'baseline', 'baseline',
  json_object('project_id', project_id, 'task_id', task_id, 'position', position)
FROM project_tasks
ORDER BY user_id, project_id, position;

INSERT INTO history (user_id, table_name, row_key, op, source, data)
SELECT user_id, 'project_tags', project_id || ':' || tag_id, 'baseline', 'baseline',
  json_object('project_id', project_id, 'tag_id', tag_id, 'position', position)
FROM project_tags
ORDER BY user_id, project_id, position;

INSERT INTO history (user_id, table_name, row_key, op, source, data)
SELECT user_id, 'task_tags', task_id || ':' || tag_id, 'baseline', 'baseline',
  json_object('task_id', task_id, 'tag_id', tag_id, 'position', position)
FROM task_tags
ORDER BY user_id, task_id, position;

INSERT INTO history (user_id, table_name, row_key, op, source, data)
SELECT user_id, 'task_relations', task_id || ':' || related_task_id, 'baseline', 'baseline',
  json_object('task_id', task_id, 'related_task_id', related_task_id, 'type', type, 'position', position)
FROM task_relations
ORDER BY user_id, task_id, position;

-- Usage (README, "Usage"): how many actions each account took in each UTC hour, from each client,
-- counted by worker/usage.ts. One row per hour, client and action, not one per action. Nothing
-- writes to it during a cascade, so unlike history it can have a foreign key to users.
CREATE TABLE usage_counts (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day_utc TEXT NOT NULL, -- ISO 8601 date, e.g. "2026-10-25"
  hour_utc INTEGER NOT NULL CHECK (hour_utc BETWEEN 0 AND 23),
  client TEXT NOT NULL CHECK (client IN ('web-desktop', 'web-mobile', 'telegram', 'unknown')),
  action TEXT NOT NULL, -- a name from USAGE_ACTIONS in src/types/usage.ts, or "METHOD route"
  count INTEGER NOT NULL CHECK (count > 0),
  PRIMARY KEY (user_id, day_utc, hour_utc, client, action)
);
