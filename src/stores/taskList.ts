import { ref } from 'vue'
import { acceptHMRUpdate, defineStore } from 'pinia'
import * as api from '@/api'
import type { TaskAction, TaskPatchSave, TaskSave } from '@/types/operations'
import type { Task } from '@/types/task'
import type { UsageAction } from '@/types/usage'
import { applyChanges } from './changes'
import { useProjectList } from './projectList'

// What each quick action is counted as (README, "Usage")
const QUICK_ACTIONS: Record<TaskAction['action'], UsageAction> = {
  do_today: 'quick_action_pin',
  unpin: 'quick_action_unpin',
  not_today: 'quick_action_not_today',
  importance: 'quick_action_priority',
  estimate: 'quick_action_estimate',
}

// Ticking a task off or unticking it is counted as that, whatever else the save changes
const completionAction = (completed: boolean | undefined, before: boolean | undefined): UsageAction | null =>
  completed === undefined || completed === before ? null : completed ? 'task_complete' : 'task_reopen'

export const useTaskList = defineStore('taskList', () => {
  const tasks = ref<Task[]>([])

  async function load() {
    tasks.value = await api.list('tasks')
  }

  // Saves the task under the scheduling rules, then updates every task and project the Worker
  // changed, such as a project it moved the task into or archived. Throws ApiConflict for a clash.
  async function saveTask(input: TaskSave) {
    const stored = tasks.value.find((t) => t.id === input.task.id)
    const action = stored ? (completionAction(input.task.completed, stored.completed) ?? 'task_edit') : 'task_create'
    applyChanges(await api.saveTask(input, action))
  }

  // Changes only the fields in the patch (see api.patchTask), such as ticking the task off
  async function patchTask(taskId: string, input: TaskPatchSave) {
    const stored = tasks.value.find((t) => t.id === taskId)
    applyChanges(await api.patchTask(taskId, input, completionAction(input.task.completed, stored?.completed) ?? 'task_edit'))
  }

  // Does a quick action to the task, such as pinning it to today (see api.taskAction)
  async function act(taskId: string, action: TaskAction) {
    applyChanges(await api.taskAction(taskId, action, QUICK_ACTIONS[action.action]))
  }

  // Saves the tasks into the project in one request (see api.importTasks)
  async function importTasks(projectId: string, imported: Task[]) {
    applyChanges(await api.importTasks(projectId, imported, 'task_import'))
  }

  // The API also takes the task out of its projects and other tasks' relations, so the loaded
  // projects and tasks are updated to match
  async function deleteTask(id: string) {
    await api.remove('tasks', id, 'task_delete')
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
