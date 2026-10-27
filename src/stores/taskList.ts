import { ref, toRaw } from 'vue'
import { acceptHMRUpdate, defineStore } from 'pinia'
import * as api from '@/api'
import type { Task } from '@/types/task'

export const useTaskList = defineStore('taskList', () => {
  const tasks = ref<Task[]>([])

  async function load() {
    tasks.value = await api.list('tasks')
  }

  // Stores the task, then adds it or replaces the existing task with the same id
  async function saveTask(task: Task) {
    const saved = await api.save('tasks', task)
    const index = tasks.value.findIndex((t) => t.id === saved.id)
    if (index === -1) tasks.value.push(saved)
    else tasks.value[index] = saved
  }

  // Moves the due dates of the given tasks, by task id
  async function setDueDates(dates: Record<string, string>) {
    await Promise.all(
      tasks.value
        .filter((t) => t.id in dates)
        .map((t) => saveTask({ ...structuredClone(toRaw(t)), dueDate: dates[t.id]! })),
    )
  }

  return { tasks, load, saveTask, setDueDates }
})

// Lets Vite hot-swap this store when the file changes, instead of keeping the old one
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useTaskList, import.meta.hot))
}
