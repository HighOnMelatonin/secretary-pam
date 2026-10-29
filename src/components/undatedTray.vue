<script setup lang="ts">
// Below the calendar: the unfinished tasks with no due date, which have no day to go on, in a
// section that opens and closes. Each has its check mark, Edit button and projects.
import TaskRow from './taskRow.vue'
import { isArchived, type Project } from '@/types/project'
import type { Task } from '@/types/task'

const props = defineProps<{
  tasks: Task[] // the undated tasks to list
  projects: Project[]
}>()

defineEmits<{
  editTask: [task: Task]
  toggleTask: [task: Task]
}>()

const projectNames = (task: Task) =>
  props.projects.filter((p) => !isArchived(p) && p.taskIds.includes(task.id)).map((p) => p.name)
</script>

<template>
  <details class="undated-tray">
    <summary>No due date ({{ tasks.length }})</summary>
    <ul v-if="tasks.length" class="plain-list">
      <TaskRow
        v-for="task in tasks"
        :key="task.id"
        :task="task"
        :project-names="projectNames(task)"
        @edit="$emit('editTask', task)"
        @toggle-completed="$emit('toggleTask', task)"
      />
    </ul>
    <p v-else><small>Every unfinished task has a due date.</small></p>
  </details>
</template>

<style scoped>
/* Set off from the grid by a line, like the dashboard's archived projects */
.undated-tray {
  padding-top: 1rem;
  border-top: 1px solid var(--pico-muted-border-color);
}

.undated-tray summary {
  color: var(--pico-muted-color);
}

.undated-tray p small {
  color: var(--pico-muted-color);
}
</style>
