// Tag data model: a label such as "Work" that a project can be filed under. Projects
// refer to a tag by id, so renaming a tag renames it on every project.
export interface Tag {
  id: string
  name: string // unique, ignoring case
}

export function createEmptyTag(): Tag {
  return { id: crypto.randomUUID(), name: '' }
}
