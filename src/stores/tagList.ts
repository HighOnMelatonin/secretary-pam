import { ref } from 'vue'
import { acceptHMRUpdate, defineStore } from 'pinia'
import * as api from '@/api'
import type { Tag } from '@/types/tag'
import { useProjectList } from './projectList'

// Alphabetical, ignoring case, like the API returns them
const byName = (a: Tag, b: Tag) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

export const useTagList = defineStore('tagList', () => {
  const projectList = useProjectList()
  const tags = ref<Tag[]>([])

  async function load() {
    tags.value = await api.list('tags')
  }

  // Stores the tag, then adds it or replaces the existing tag with the same id
  async function saveTag(tag: Tag) {
    const saved = await api.save('tags', tag)
    const index = tags.value.findIndex((t) => t.id === saved.id)
    if (index === -1) tags.value.push(saved)
    else tags.value[index] = saved
    tags.value.sort(byName)
  }

  // The API also removes the tag from its projects, so the loaded projects are updated to match
  async function deleteTag(id: string) {
    await api.remove('tags', id)
    tags.value = tags.value.filter((t) => t.id !== id)
    for (const project of projectList.projects) {
      project.tagIds = project.tagIds.filter((tagId) => tagId !== id)
    }
  }

  return { tags, load, saveTag, deleteTag }
})

// Lets Vite hot-swap this store when the file changes, instead of keeping the old one
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useTagList, import.meta.hot))
}
