-- Task.tagIds: tasks can have tags too, chosen from the same tags as projects.
-- Deleting a tag removes it from its tasks, as it does from its projects.

CREATE TABLE task_tags (
  user_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (user_id, task_id, tag_id),
  FOREIGN KEY (user_id, task_id) REFERENCES tasks (user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, tag_id) REFERENCES tags (user_id, id) ON DELETE CASCADE
);

CREATE INDEX task_tags_tag_id ON task_tags (user_id, tag_id);
