import { ref } from 'vue'
import { acceptHMRUpdate, defineStore } from 'pinia'
import * as api from '@/api'
import type { TaskSave } from '@/types/operations'
import type { Task } from '@/types/task'
import { applyChanges } from './changes'

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

  return { tasks, load, saveTask }
})

// Lets Vite hot-swap this store when the file changes, instead of keeping the old one
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useTaskList, import.meta.hot))
}
