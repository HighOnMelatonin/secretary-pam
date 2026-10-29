import { computed, ref } from 'vue'
import { acceptHMRUpdate, defineStore } from 'pinia'
import * as api from '@/api'
import type { ProjectSave } from '@/types/operations'
import { isArchived, type Project } from '@/types/project'
import { applyChanges } from './changes'

// Soonest delivery date first; projects with no date go last
const byDeliveryDate = (a: Project, b: Project) =>
  (a.deliveryDate ?? '9999-12-31').localeCompare(b.deliveryDate ?? '9999-12-31')

export const useProjectList = defineStore('projectList', () => {
  const projects = ref<Project[]>([])

  // A project is live until it has the Archive tag, which the Worker gives it when its last task
  // is completed
  const liveProjects = computed(() => projects.value.filter((p) => !isArchived(p)).sort(byDeliveryDate))
  const archivedProjects = computed(() => projects.value.filter(isArchived).sort(byDeliveryDate))

  async function load() {
    projects.value = await api.list('projects')
  }

  // Like taskList.saveTask, for a project
  async function saveProject(input: ProjectSave) {
    applyChanges(await api.saveProject(input))
  }

  return { projects, liveProjects, archivedProjects, load, saveProject }
})

// Lets Vite hot-swap this store when the file changes, instead of keeping the old one
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useProjectList, import.meta.hot))
}
