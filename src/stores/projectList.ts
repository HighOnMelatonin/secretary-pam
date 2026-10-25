import { computed, ref, toRaw } from 'vue'
import { acceptHMRUpdate, defineStore } from 'pinia'
import * as api from '@/api'
import { completionStatus, type Project } from '@/types/project'
import { useTaskList } from './taskList'

export const useProjectList = defineStore('projectList', () => {
  const taskList = useTaskList()
  const projects = ref<Project[]>([])

  // A project is live until it has tasks and all of them are completed
  function isLive(project: Project) {
    const { completed, total } = completionStatus(project, taskList.tasks)
    return total === 0 || completed < total
  }

  // Live projects, soonest delivery date first; projects with no date go last
  const liveProjects = computed(() =>
    projects.value
      .filter(isLive)
      .sort((a, b) => (a.deliveryDate ?? '9999-12-31').localeCompare(b.deliveryDate ?? '9999-12-31')),
  )

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
    const changed = projects.value.filter(
      (p) => p.taskIds.includes(taskId) !== projectIds.includes(p.id),
    )
    await Promise.all(
      changed.map((p) =>
        saveProject({
          ...structuredClone(toRaw(p)),
          taskIds: projectIds.includes(p.id)
            ? [...p.taskIds, taskId]
            : p.taskIds.filter((id) => id !== taskId),
        }),
      ),
    )
  }

  return { projects, liveProjects, load, saveProject, assignTask }
})

// Lets Vite hot-swap this store when the file changes, instead of keeping the old one
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useProjectList, import.meta.hot))
}
