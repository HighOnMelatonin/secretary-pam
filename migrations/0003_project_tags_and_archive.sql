-- Projects can have several tags (Project.tagIds), so they move from projects.tag_id to their
-- own table. projects.tag_id is no longer read or written; it stays because SQLite can't drop a
-- column with a foreign key.
-- Deleting a tag removes it from its projects.

CREATE TABLE project_tags (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (project_id, tag_id)
);

CREATE INDEX project_tags_tag_id ON project_tags (tag_id);

INSERT INTO project_tags (project_id, tag_id, position)
SELECT id, tag_id, 0 FROM projects WHERE tag_id IS NOT NULL;

UPDATE projects SET tag_id = NULL;

-- The built-in tag the app gives a project when its last task is completed (ARCHIVE_TAG_ID in
-- src/types/tag.ts). Named differently if the user already has a tag called Archive.
INSERT INTO tags (id, name)
SELECT 'archive', CASE WHEN EXISTS (SELECT 1 FROM tags WHERE name = 'Archive') THEN 'Archive (completed)' ELSE 'Archive' END;

-- Projects that are already completed (they have tasks, all done) start archived
INSERT INTO project_tags (project_id, tag_id, position)
SELECT p.id, 'archive', (SELECT count(*) FROM project_tags pt WHERE pt.project_id = p.id)
FROM projects p
WHERE EXISTS (SELECT 1 FROM project_tasks WHERE project_id = p.id)
  AND NOT EXISTS (
    SELECT 1 FROM project_tasks JOIN tasks ON tasks.id = project_tasks.task_id
    WHERE project_tasks.project_id = p.id AND tasks.completed = 0
  );
