-- Errands (README, "Errands"): small personal to-dos, like groceries or paying a bill, that belong
-- to no project. They are rows in tasks with kind = 'errand' rather than a table of their own, so
-- they keep the dates, effort, calendar, bot and history that tasks already have. For an errand,
-- pinned_date is the day it's planned for and due_date its deadline, if it has one.
--
-- The rules that only make sense for one kind (an errand is in no project and has no relations, its
-- planned day isn't after its due date, recurrence is one of the formats) are checked by the Worker,
-- which can say what's wrong. The CHECKs here only stop the columns holding what no kind can.

-- Every task made before this is a project task, so the default keeps them as they were
ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'task' CHECK (kind IN ('task', 'errand'));

-- How an errand repeats: daily, weekly:MON,SAT or every:Nd. NULL for one that doesn't, and always
-- for a project task.
ALTER TABLE tasks ADD COLUMN recurrence TEXT CHECK (recurrence IS NULL OR kind = 'errand');

-- The errand made when this recurring one was completed. Reopening and completing it again then
-- doesn't make a second one. Not a foreign key: the next errand can be deleted (dropped) on its own,
-- and that must not make this one repeat again. The API never returns it.
ALTER TABLE tasks ADD COLUMN next_occurrence_id TEXT CHECK (next_occurrence_id IS NULL OR kind = 'errand');

-- Task.checklist: an errand's steps, e.g. what to buy, each ticked off on its own. Not logged to
-- history: ticking items is noise for the analytics, and logging them would mean rebuilding the
-- history table to widen its table_name CHECK.
CREATE TABLE task_checklist_items (
  user_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  PRIMARY KEY (user_id, task_id, position),
  FOREIGN KEY (user_id, task_id) REFERENCES tasks (user_id, id) ON DELETE CASCADE
);

-- The task triggers from 0013 again, with kind, recurrence and next_occurrence_id in their
-- json_object(...) and the update trigger's WHEN, as 0013 says a new column needs. Rows from before
-- this keep the data they were logged with, so a task's history only shows kind from here on;
-- analysis reads a missing kind as 'task', which is what every row before this was.

DROP TRIGGER history_tasks_insert;

DROP TRIGGER history_tasks_update;

DROP TRIGGER history_tasks_delete;

CREATE TRIGGER history_tasks_insert AFTER INSERT ON tasks
BEGIN
  INSERT INTO history (user_id, table_name, row_key, op, source, data)
  VALUES (NEW.user_id, 'tasks', NEW.id, 'insert', NEW.changed_by,
    json_object('id', NEW.id, 'name', NEW.name, 'description', NEW.description, 'due_date', NEW.due_date,
      'priority', NEW.priority, 'completed', NEW.completed, 'effort_minutes', NEW.effort_minutes,
      'start_date', NEW.start_date, 'pinned_date', NEW.pinned_date, 'kind', NEW.kind,
      'recurrence', NEW.recurrence, 'next_occurrence_id', NEW.next_occurrence_id,
      'created_at', NEW.created_at, 'updated_at', NEW.updated_at));
END;

CREATE TRIGGER history_tasks_update AFTER UPDATE ON tasks
WHEN OLD.user_id IS NOT NEW.user_id OR OLD.id IS NOT NEW.id OR OLD.name IS NOT NEW.name
  OR OLD.description IS NOT NEW.description OR OLD.due_date IS NOT NEW.due_date
  OR OLD.priority IS NOT NEW.priority OR OLD.completed IS NOT NEW.completed
  OR OLD.effort_minutes IS NOT NEW.effort_minutes OR OLD.start_date IS NOT NEW.start_date
  OR OLD.pinned_date IS NOT NEW.pinned_date OR OLD.kind IS NOT NEW.kind
  OR OLD.recurrence IS NOT NEW.recurrence OR OLD.next_occurrence_id IS NOT NEW.next_occurrence_id
  OR OLD.created_at IS NOT NEW.created_at
BEGIN
  INSERT INTO history (user_id, table_name, row_key, op, source, data, old_data)
  VALUES (NEW.user_id, 'tasks', NEW.id, 'update', NEW.changed_by,
    json_object('id', NEW.id, 'name', NEW.name, 'description', NEW.description, 'due_date', NEW.due_date,
      'priority', NEW.priority, 'completed', NEW.completed, 'effort_minutes', NEW.effort_minutes,
      'start_date', NEW.start_date, 'pinned_date', NEW.pinned_date, 'kind', NEW.kind,
      'recurrence', NEW.recurrence, 'next_occurrence_id', NEW.next_occurrence_id,
      'created_at', NEW.created_at, 'updated_at', NEW.updated_at),
    json_object('id', OLD.id, 'name', OLD.name, 'description', OLD.description, 'due_date', OLD.due_date,
      'priority', OLD.priority, 'completed', OLD.completed, 'effort_minutes', OLD.effort_minutes,
      'start_date', OLD.start_date, 'pinned_date', OLD.pinned_date, 'kind', OLD.kind,
      'recurrence', OLD.recurrence, 'next_occurrence_id', OLD.next_occurrence_id,
      'created_at', OLD.created_at, 'updated_at', OLD.updated_at));
END;

CREATE TRIGGER history_tasks_delete AFTER DELETE ON tasks
BEGIN
  INSERT INTO history (user_id, table_name, row_key, op, source, data)
  VALUES (OLD.user_id, 'tasks', OLD.id, 'delete', OLD.changed_by,
    json_object('id', OLD.id, 'name', OLD.name, 'description', OLD.description, 'due_date', OLD.due_date,
      'priority', OLD.priority, 'completed', OLD.completed, 'effort_minutes', OLD.effort_minutes,
      'start_date', OLD.start_date, 'pinned_date', OLD.pinned_date, 'kind', OLD.kind,
      'recurrence', OLD.recurrence, 'next_occurrence_id', OLD.next_occurrence_id,
      'created_at', OLD.created_at, 'updated_at', OLD.updated_at));
END;
