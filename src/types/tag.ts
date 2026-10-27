// Tag data model: a label such as "Work" that a project can be filed under. Projects
// refer to their tags by id, so renaming a tag renames it on every project.
export interface Tag {
  id: string
  name: string // unique, ignoring case
}

// Built-in tag (created by migrations/0003) that a project gets when its last task is
// completed. Archived projects are listed apart from the live ones; removing the tag brings a
// project back. It can be renamed but not deleted.
export const ARCHIVE_TAG_ID = 'archive'

export function createEmptyTag(): Tag {
  return { id: crypto.randomUUID(), name: '' }
}
