import { ref } from 'vue'
import { acceptHMRUpdate, defineStore } from 'pinia'
import * as api from '@/api'
import type { TaskAction, TaskPatchSave, TaskSave } from '@/types/operations'
import type { Task } from '@/types/task'
import { applyChanges } from './changes'
import { useProjectList } from './projectList'

export const useTaskList = defineStore('taskList', () => {
  const tasks = ref<Task[]>([])

  async function load() {
    tasks.value = await api.list('tasks')
  }

  // Saves the task under the scheduling rules, then updates every task and project the Worker
  // changed, such as a project it moved the task into or archived. Throws ApiConflict for a clash.
  async function saveTask(input: TaskSave) {
    applyChanges(await api.saveTask(input))
  }

  // Changes only the fields in the patch (see api.patchTask), such as ticking the task off
  async function patchTask(taskId: string, input: TaskPatchSave) {
    applyChanges(await api.patchTask(taskId, input))
  }

  // Does a quick action to the task, such as pinning it to today (see api.taskAction)
  async function act(taskId: string, action: TaskAction) {
    applyChanges(await api.taskAction(taskId, action))
  }

  // Saves the tasks into the project in one request (see api.importTasks)
  async function importTasks(projectId: string, imported: Task[]) {
    applyChanges(await api.importTasks(projectId, imported))
  }

  // The API also takes the task out of its projects and other tasks' relations, so the loaded
  // projects and tasks are updated to match
  async function deleteTask(id: string) {
    await api.remove('tasks', id)
    tasks.value = tasks.value
      .filter((t) => t.id !== id)
      .map((t) => (t.relations.some((r) => r.taskId === id) ? { ...t, relations: t.relations.filter((r) => r.taskId !== id) } : t))
    const projectList = useProjectList()
    projectList.projects = projectList.projects.map((p) =>
      p.taskIds.includes(id) ? { ...p, taskIds: p.taskIds.filter((t) => t !== id) } : p,
    )
  }

  return { tasks, load, saveTask, patchTask, act, importTasks, deleteTask }
})

// Lets Vite hot-swap this store when the file changes, instead of keeping the old one
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useTaskList, import.meta.hot))
}
