-- Tags, and an optional tag on each project (Project.tagId).
-- Deleting a tag leaves its projects untagged.

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

ALTER TABLE projects ADD COLUMN tag_id TEXT REFERENCES tags (id) ON DELETE SET NULL;

CREATE INDEX projects_tag_id ON projects (tag_id);

-- Starting tags, which can be renamed or deleted in the app
INSERT INTO tags (id, name) VALUES ('school', 'School (SUTD)'), ('work', 'Work'), ('personal', 'Personal');
