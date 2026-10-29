import { computed, ref, toRaw } from 'vue'
import { acceptHMRUpdate, defineStore } from 'pinia'
import * as api from '@/api'
import { isArchived, type Project } from '@/types/project'
import { applyMembership, projectsToArchive } from '@/types/rules'
import { ARCHIVE_TAG_ID } from '@/types/tag'
import { useTaskList } from './taskList'

// Soonest delivery date first; projects with no date go last
const byDeliveryDate = (a: Project, b: Project) =>
  (a.deliveryDate ?? '9999-12-31').localeCompare(b.deliveryDate ?? '9999-12-31')

export const useProjectList = defineStore('projectList', () => {
  const taskList = useTaskList()
  const projects = ref<Project[]>([])

  // A project is live until it has the Archive tag, which it gets when its last task is completed
  const liveProjects = computed(() => projects.value.filter((p) => !isArchived(p)).sort(byDeliveryDate))
  const archivedProjects = computed(() => projects.value.filter(isArchived).sort(byDeliveryDate))

  async function load() {
    projects.value = await api.list('projects')
  }

  // Stores the project, then adds it or replaces the existing project with the same id
  async function saveProject(project: Project) {
    const saved = await api.save('projects', project)
    const index = projects.value.findIndex((p) => p.id === saved.id)
    if (index === -1) projects.value.push(saved)
    else projects.value[index] = saved
  }

  // Puts the task in exactly the given projects, saving only the projects that change
  async function assignTask(taskId: string, projectIds: string[]) {
    const changed = applyMembership(toRaw(projects.value), taskId, projectIds)
    await Promise.all(changed.map((p) => saveProject(structuredClone(p))))
  }

  // Moves the delivery dates of the given projects, by project id
  async function setDeliveryDates(dates: Record<string, string>) {
    await Promise.all(
      projects.value
        .filter((p) => p.id in dates)
        .map((p) => saveProject({ ...structuredClone(toRaw(p)), deliveryDate: dates[p.id]! })),
    )
  }

  // Runs a change to tasks or projects, then archives the projects it completed. Only projects
  // that weren't completed before are archived, so one taken out of the archive stays out.
  async function archivingCompleted(change: () => Promise<void>) {
    // Saves replace items rather than editing them, so copying the lists is enough of a snapshot
    const before = { projects: [...projects.value], tasks: [...taskList.tasks] }
    await change()
    const ids = projectsToArchive(before, { projects: projects.value, tasks: taskList.tasks })
    const newlyCompleted = projects.value.filter((p) => ids.includes(p.id))
    await Promise.all(
      newlyCompleted.map((p) => saveProject({ ...structuredClone(toRaw(p)), tagIds: [...p.tagIds, ARCHIVE_TAG_ID] })),
    )
  }

  return {
    projects,
    liveProjects,
    archivedProjects,
    load,
    saveProject,
    assignTask,
    setDeliveryDates,
    archivingCompleted,
  }
})

// Lets Vite hot-swap this store when the file changes, instead of keeping the old one
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useProjectList, import.meta.hot))
}
