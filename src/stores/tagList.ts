import { ref } from 'vue'
import { acceptHMRUpdate, defineStore } from 'pinia'
import * as api from '@/api'
import type { Tag } from '@/types/tag'
import { useProjectList } from './projectList'
import { useTaskList } from './taskList'

// Alphabetical, ignoring case, like the API returns them
const byName = (a: Tag, b: Tag) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

export const useTagList = defineStore('tagList', () => {
  const projectList = useProjectList()
  const taskList = useTaskList()
  const tags = ref<Tag[]>([])

  async function load() {
    tags.value = await api.list('tags')
  }

  // Stores the tag, then adds it or replaces the existing tag with the same id. Returns the tag
  // as stored.
  async function saveTag(tag: Tag): Promise<Tag> {
    const saved = await api.save('tags', tag, tags.value.some((t) => t.id === tag.id) ? 'tag_edit' : 'tag_create')
    const index = tags.value.findIndex((t) => t.id === saved.id)
    if (index === -1) tags.value.push(saved)
    else tags.value[index] = saved
    tags.value.sort(byName)
    return saved
  }

  // The API also removes the tag from its projects and tasks, so the loaded ones are updated to match
  async function deleteTag(id: string) {
    await api.remove('tags', id, 'tag_delete')
    tags.value = tags.value.filter((t) => t.id !== id)
    for (const project of projectList.projects) {
      project.tagIds = project.tagIds.filter((tagId) => tagId !== id)
    }
    for (const task of taskList.tasks) {
      if (!task.tagIds?.includes(id)) continue
      const tagIds = task.tagIds.filter((tagId) => tagId !== id)
      if (tagIds.length) task.tagIds = tagIds
      else delete task.tagIds
    }
  }

  return { tags, load, saveTag, deleteTag }
})

// Lets Vite hot-swap this store when the file changes, instead of keeping the old one
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useTagList, import.meta.hot))
}
