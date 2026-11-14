-- The Telegram companion bot (worker/pamBot/, docs/telegram-bot.md).

-- Change tracking gets a fourth source, 'telegram', for changes made from the bot. SQLite can't
-- change a CHECK constraint in place, so task_events is rebuilt: copied whole, ids included, into a
-- table with the new constraint, which then takes the old one's name. The ids are copied as they
-- are, so AUTOINCREMENT carries on after the largest of them and never reuses one.
CREATE TABLE task_events_new (
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
  source TEXT NOT NULL CHECK (source IN ('app', 'google', 'telegram', 'backfill')), -- who made the change
  task_source TEXT CHECK (task_source IN ('app', 'google')) -- where the task came from; NULL for a project
);

INSERT INTO task_events_new (user_id, id, at, kind, task_id, project_id, old_value, new_value, delivery_date_at_time, source, task_source)
SELECT user_id, id, at, kind, task_id, project_id, old_value, new_value, delivery_date_at_time, source, task_source
FROM task_events;

DROP TABLE task_events;

ALTER TABLE task_events_new RENAME TO task_events;

CREATE INDEX task_events_project ON task_events (user_id, project_id, at);
CREATE INDEX task_events_task ON task_events (user_id, task_id, at);

-- A Telegram chat linked to an account, at most one each way. The bot only answers chats with a
-- row here, apart from "/start <code>", which makes one.
CREATE TABLE telegram_links (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  chat_id INTEGER NOT NULL UNIQUE, -- Telegram's id for the private chat with the user
  time_zone TEXT NOT NULL, -- IANA name, e.g. "Asia/Singapore", for the user's local date and time
  brief_minutes INTEGER NOT NULL DEFAULT 450 CHECK (brief_minutes BETWEEN 0 AND 1439), -- local time of the morning brief, 450 = 07:30
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)), -- whether the morning brief is sent
  last_brief_date TEXT, -- the user's local date the last brief was sent on
  last_added_task_id TEXT, -- the task last made with /add in this chat, for /desc
  last_update_id INTEGER NOT NULL DEFAULT 0, -- the newest Telegram update handled, so a repeat is skipped
  linked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- A one-time code for linking a chat, from the settings page. Like a session, the id is the
-- SHA-256 hash of the code, so the database alone can't be used to link a chat. It works once,
-- until expires_at (10 minutes); asking for another replaces it. The browser's time zone comes
-- with it, so the brief is at the right time from the start.
CREATE TABLE telegram_link_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  time_zone TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX telegram_link_codes_user_id ON telegram_link_codes (user_id);
