-- Scheduling inputs for task prioritisation (docs/priority-algorithm.md): each task's effort
-- estimate, the day work on it can start and the day it's pinned to, and each user's settings for
-- how much time they have and how tasks are weighed. Scores and forecasts are worked out from
-- these when read, never stored.

-- Estimated work in minutes; NULL when the task has no estimate
ALTER TABLE tasks ADD COLUMN effort_minutes INTEGER CHECK (effort_minutes IS NULL OR effort_minutes > 0);

-- ISO 8601 date work can start from; never after the due date
ALTER TABLE tasks ADD COLUMN start_date TEXT CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date);

-- ISO 8601 date the task was pinned to with "Do today"; ignored once that date has passed
ALTER TABLE tasks ADD COLUMN pinned_date TEXT;

-- One row per user, written the first time they save their settings; until then the defaults in
-- src/types/settings.ts apply. Capacity is the minutes available for tasks on each weekday.
CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  capacity_mon INTEGER NOT NULL DEFAULT 480 CHECK (capacity_mon BETWEEN 0 AND 1440),
  capacity_tue INTEGER NOT NULL DEFAULT 480 CHECK (capacity_tue BETWEEN 0 AND 1440),
  capacity_wed INTEGER NOT NULL DEFAULT 480 CHECK (capacity_wed BETWEEN 0 AND 1440),
  capacity_thu INTEGER NOT NULL DEFAULT 480 CHECK (capacity_thu BETWEEN 0 AND 1440),
  capacity_fri INTEGER NOT NULL DEFAULT 480 CHECK (capacity_fri BETWEEN 0 AND 1440),
  capacity_sat INTEGER NOT NULL DEFAULT 0 CHECK (capacity_sat BETWEEN 0 AND 1440),
  capacity_sun INTEGER NOT NULL DEFAULT 0 CHECK (capacity_sun BETWEEN 0 AND 1440),
  buffer REAL NOT NULL DEFAULT 1.0 CHECK (buffer > 0), -- estimates are multiplied by this
  w_u REAL NOT NULL DEFAULT 1 CHECK (w_u >= 0), -- weight of urgency against importance
  k REAL NOT NULL DEFAULT 1 CHECK (k >= 0), -- weight of the work a task unblocks
  horizon_days INTEGER NOT NULL DEFAULT 2 CHECK (horizon_days > 0), -- working days of the proximity lift
  preset TEXT NOT NULL DEFAULT 'balanced' CHECK (preset IN ('balanced', 'deadline', 'importance', 'blockers')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
