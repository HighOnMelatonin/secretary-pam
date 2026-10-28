-- Accounts. Every table gets a user_id, and each user's ids are their own: keys become
-- (user_id, id), and every foreign key includes user_id, so one user's rows can never refer to
-- another's. SQLite can't change a table's primary key, so each table is rebuilt: the old one
-- is renamed (which points the other tables' foreign keys at the renamed one), a new one is
-- created and filled from it, and the old ones are dropped, children first.
--
-- The data from before accounts existed goes to the account with id 'original', which has no
-- email or password yet. The first person to sign up takes it over (see worker/auth.ts).
-- projects.tag_id, unused since 0003, is left out of the new projects table.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE COLLATE NOCASE, -- NULL only for 'original' until it is claimed
  password_hash TEXT, -- "pbkdf2-sha256$<iterations>$<salt>$<hash>", salt and hash in base64
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- A signed-in browser. The id is the SHA-256 hash of the token in the browser's cookie, so the
-- database alone can't be used to sign in.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX sessions_user_id ON sessions (user_id);

-- Failed sign-ins, so repeated guesses at one account's password can be slowed down
CREATE TABLE login_failures (
  email TEXT NOT NULL COLLATE NOCASE,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX login_failures_email ON login_failures (email, at);

INSERT INTO users (id) VALUES ('original');

ALTER TABLE task_relations RENAME TO old_task_relations;
ALTER TABLE project_tasks RENAME TO old_project_tasks;
ALTER TABLE project_links RENAME TO old_project_links;
ALTER TABLE project_tags RENAME TO old_project_tags;
ALTER TABLE tasks RENAME TO old_tasks;
ALTER TABLE projects RENAME TO old_projects;
ALTER TABLE tags RENAME TO old_tags;

CREATE TABLE tasks (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_date TEXT, -- ISO 8601 date, e.g. "2026-10-25"
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, id)
);

-- Task.relations: how task_id relates to related_task_id
CREATE TABLE task_relations (
  user_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  related_task_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('blocks', 'blocked_by', 'subtask_of', 'parent_of', 'related_to')),
  position INTEGER NOT NULL,
  PRIMARY KEY (user_id, task_id, related_task_id),
  FOREIGN KEY (user_id, task_id) REFERENCES tasks (user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, related_task_id) REFERENCES tasks (user_id, id) ON DELETE CASCADE,
  CHECK (task_id <> related_task_id)
);

CREATE TABLE projects (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  delivery_date TEXT, -- ISO 8601 date, e.g. "2026-10-25"
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, id)
);

-- Project.taskIds: links projects to their tasks; a task can be in several projects
CREATE TABLE project_tasks (
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (user_id, project_id, task_id),
  FOREIGN KEY (user_id, project_id) REFERENCES projects (user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, task_id) REFERENCES tasks (user_id, id) ON DELETE CASCADE
);

-- Project.links
CREATE TABLE project_links (
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  PRIMARY KEY (user_id, project_id, position),
  FOREIGN KEY (user_id, project_id) REFERENCES projects (user_id, id) ON DELETE CASCADE
);

-- Tag names are unique within each user's tags, ignoring case
CREATE TABLE tags (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, name)
);

-- Project.tagIds
CREATE TABLE project_tags (
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (user_id, project_id, tag_id),
  FOREIGN KEY (user_id, project_id) REFERENCES projects (user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, tag_id) REFERENCES tags (user_id, id) ON DELETE CASCADE
);

-- Parents before children, so every foreign key finds its row
INSERT INTO tasks (user_id, id, name, description, due_date, priority, completed, created_at, updated_at)
SELECT 'original', id, name, description, due_date, priority, completed, created_at, updated_at FROM old_tasks;

INSERT INTO projects (user_id, id, name, description, delivery_date, priority, created_at, updated_at)
SELECT 'original', id, name, description, delivery_date, priority, created_at, updated_at FROM old_projects;

INSERT INTO tags (user_id, id, name, created_at, updated_at)
SELECT 'original', id, name, created_at, updated_at FROM old_tags;

INSERT INTO task_relations (user_id, task_id, related_task_id, type, position)
SELECT 'original', task_id, related_task_id, type, position FROM old_task_relations;

INSERT INTO project_tasks (user_id, project_id, task_id, position)
SELECT 'original', project_id, task_id, position FROM old_project_tasks;

INSERT INTO project_links (user_id, project_id, position, label, url)
SELECT 'original', project_id, position, label, url FROM old_project_links;

INSERT INTO project_tags (user_id, project_id, tag_id, position)
SELECT 'original', project_id, tag_id, position FROM old_project_tags;

-- Children first, so dropping a table (which deletes its rows first) cascades only into old ones
DROP TABLE old_task_relations;
DROP TABLE old_project_tasks;
DROP TABLE old_project_links;
DROP TABLE old_project_tags;
DROP TABLE old_projects;
DROP TABLE old_tasks;
DROP TABLE old_tags;

-- After the drops, which free these names from the old tables' indexes
CREATE INDEX task_relations_related_task_id ON task_relations (user_id, related_task_id);
CREATE INDEX project_tasks_task_id ON project_tasks (user_id, task_id);
CREATE INDEX project_tags_tag_id ON project_tags (user_id, tag_id);
