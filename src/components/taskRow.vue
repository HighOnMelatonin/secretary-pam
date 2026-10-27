<script setup lang="ts">
// One task in a project's task list: its check mark (a button that marks it done or not done), its
// name (a link to the task's page), priority, overdue tag and due date, with an Edit button at the
// end of the row. Used in the expanded project tile, on the project page, which also shows each
// task's description, and in the upcoming tasks panel, which also names each task's projects.
import type { Task } from '@/types/task'

defineProps<{
  task: Task
  showDescription?: boolean
  projectNames?: string[] // shown under the task, for lists that mix projects
}>()

defineEmits<{
  edit: [task: Task]
  toggleCompleted: [task: Task]
}>()

const today = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD in local time
const isOverdue = (date: string | null) => date !== null && date < today
</script>

<template>
  <li class="task" :class="{ done: task.completed }">
    <button
      type="button"
      class="check"
      :aria-pressed="task.completed"
      :aria-label="`Done: ${task.name}`"
      :title="task.completed ? 'Mark as not done' : 'Mark as done'"
      @click="$emit('toggleCompleted', task)"
    >
      {{ task.completed ? '✓' : '○' }}
    </button>
    <span class="task-body">
      <span class="task-line">
        <RouterLink :to="{ name: 'task', params: { id: task.id } }" class="task-name">
          {{ task.name }}<span v-if="task.completed" class="sr-only"> (completed)</span>
        </RouterLink>
        <span class="tag" :class="`priority-${task.priority}`">{{ task.priority }}</span>
        <span v-if="!task.completed && isOverdue(task.dueDate)" class="tag overdue">overdue</span>
        <small v-if="task.dueDate">Due {{ task.dueDate }}</small>
      </span>
      <small v-if="projectNames" class="task-projects">{{ projectNames.join(' · ') || 'No project' }}</small>
      <span v-if="showDescription && task.description" class="task-description">{{ task.description }}</span>
    </span>
    <button
      type="button"
      class="secondary outline small task-edit"
      :aria-label="`Edit task ${task.name}`"
      @click="$emit('edit', task)"
    >
      Edit
    </button>
  </li>
</template>

<style scoped>
/* The icon keeps its own column; the name, badges and due date wrap beside it on narrow
   screens rather than under it */
.task {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  list-style: none;
}

.check {
  flex: none;
  width: 1.25rem;
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  color: var(--pico-muted-color);
  font: inherit;
  line-height: inherit;
  cursor: pointer;
}

.check:hover {
  color: var(--pico-color);
}

.check:focus-visible {
  outline: 2px solid var(--pam-cream-muted);
  outline-offset: 2px;
  box-shadow: none;
}

.task-body {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}

.task-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem 0.5rem;
}

.task-line small,
.task-projects,
.task-description {
  color: var(--pico-muted-color);
}

.task-description {
  white-space: pre-line;
  overflow-wrap: anywhere;
}

/* At the end of the row, however long the task's details are */
.task-edit {
  flex: none;
  align-self: center;
  width: auto;
  margin: 0 0 0 auto;
  padding: 0.2rem 0.75rem;
  font-size: 0.85rem;
}

.task.done .task-name {
  text-decoration: line-through;
  opacity: 0.7;
}
</style>
