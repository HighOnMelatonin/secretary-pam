import { ref } from 'vue'
import { acceptHMRUpdate, defineStore } from 'pinia'
import * as api from '@/api'
import type { TaskAction, TaskPatchSave, TaskSave } from '@/types/operations'
import { isErrand } from '@/types/errand'
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
  plan: 'errand_reschedule',
}

// Ticking a task off or unticking it is counted as that, whatever else the save changes, and an
// errand's as errand_complete (reopening either is task_reopen)
const completionAction = (completed: boolean | undefined, before: boolean | undefined, errand = false): UsageAction | null =>
  completed === undefined || completed === before ? null : completed ? (errand ? 'errand_complete' : 'task_complete') : 'task_reopen'

// A save that changes an errand's planned day and nothing about its completion is a reschedule
const editAction = (task: Pick<Task, 'kind' | 'pinnedDate'>, stored: Task): UsageAction =>
  isErrand(task) && isErrand(stored) && task.pinnedDate !== stored.pinnedDate ? 'errand_reschedule' : 'task_edit'

export const useTaskList = defineStore('taskList', () => {
  const tasks = ref<Task[]>([])

  async function load() {
    tasks.value = await api.list('tasks')
  }

  // Saves the task under the scheduling rules, then updates every task and project the Worker
  // changed, such as a project it moved the task into or archived. Throws ApiConflict for a clash.
  async function saveTask(input: TaskSave) {
    const stored = tasks.value.find((t) => t.id === input.task.id)
    const errand = isErrand(input.task)
    const action = stored
      ? (completionAction(input.task.completed, stored.completed, errand) ?? editAction(input.task, stored))
      : errand
        ? 'errand_create'
        : 'task_create'
    applyChanges(await api.saveTask(input, action))
  }

  // Changes only the fields in the patch (see api.patchTask), such as ticking the task off
  async function patchTask(taskId: string, input: TaskPatchSave) {
    const stored = tasks.value.find((t) => t.id === taskId)
    const errand = stored !== undefined && isErrand(stored)
    // The planned day after the patch: the patch's when it names one, null clearing it
    const pinnedDate = 'pinnedDate' in input.task ? (input.task.pinnedDate ?? undefined) : stored?.pinnedDate
    const edit = stored ? editAction({ kind: stored.kind, pinnedDate }, stored) : 'task_edit'
    applyChanges(await api.patchTask(taskId, input, completionAction(input.task.completed, stored?.completed, errand) ?? edit))
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
    const stored = tasks.value.find((t) => t.id === id)
    await api.remove('tasks', id, stored && isErrand(stored) ? 'errand_drop' : 'task_delete')
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
