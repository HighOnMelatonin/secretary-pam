-- Projects and tasks, one column per field of the types in src/types.
-- Arrays get their own tables, with `position` keeping the order they had in the array.
-- Foreign keys cascade, so deleting a task also removes it from projects and relations.

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_date TEXT, -- ISO 8601 date, e.g. "2026-10-25"
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Task.relations: how task_id relates to related_task_id
CREATE TABLE task_relations (
  task_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  related_task_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('blocks', 'blocked_by', 'subtask_of', 'parent_of', 'related_to')),
  position INTEGER NOT NULL,
  PRIMARY KEY (task_id, related_task_id),
  CHECK (task_id <> related_task_id)
);

CREATE INDEX task_relations_related_task_id ON task_relations (related_task_id);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  delivery_date TEXT, -- ISO 8601 date, e.g. "2026-10-25"
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Project.taskIds: links projects to their tasks; a task can be in several projects
CREATE TABLE project_tasks (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (project_id, task_id)
);

CREATE INDEX project_tasks_task_id ON project_tasks (task_id);

-- Project.links
CREATE TABLE project_links (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  PRIMARY KEY (project_id, position)
);
