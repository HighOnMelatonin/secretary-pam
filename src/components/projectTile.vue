<script setup lang="ts">
// Dashboard tile for one project. Clicking it expands a read-only preview of the
// project's tasks and links; the Edit button opens the full project form.
import { computed, ref } from 'vue'
import { completionStatus, resolveTasks, type Project } from '@/types/project'
import type { Tag } from '@/types/tag'
import type { Task } from '@/types/task'

const props = defineProps<{
  project: Project
  tasks: Task[] // all tasks; the project's own are looked up by id
  tag?: Tag // the project's tag, if it has one
}>()

defineEmits<{
  edit: [project: Project]
}>()

const expanded = ref(false)

const today = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD in local time
const isOverdue = (date: string | null) => date !== null && date < today

const projectTasks = computed(() => resolveTasks(props.project, props.tasks))
const status = computed(() => completionStatus(props.project, props.tasks))
const previewId = computed(() => `project-${props.project.id}-preview`)

function toggle() {
  expanded.value = !expanded.value
}

// Clicking anywhere on the tile toggles it, except on its own buttons and links
// or when the click finishes selecting text
function onTileClick(event: MouseEvent) {
  if ((event.target as Element).closest('a, button')) return
  if (window.getSelection()?.toString()) return
  toggle()
}
</script>

<template>
  <article class="project-tile" :class="{ expanded }" @click="onTileClick">
    <div class="tile-header">
      <h3>
        <button
          type="button"
          class="tile-toggle"
          :aria-expanded="expanded"
          :aria-controls="previewId"
          @click="toggle"
        >
          <span class="chevron" aria-hidden="true">▸</span>
          {{ project.name }}
        </button>
      </h3>
      <button type="button" class="secondary outline small" @click="$emit('edit', project)">Edit</button>
    </div>

    <div class="meta">
      <span v-if="tag" class="tag project-tag">{{ tag.name }}</span>
      <span class="tag" :class="`priority-${project.priority}`">{{ project.priority }}</span>
      <span v-if="isOverdue(project.deliveryDate)" class="tag overdue">overdue</span>
      <small>Due {{ project.deliveryDate ?? 'whenever' }}</small>
    </div>

    <p v-if="project.description" class="description">{{ project.description }}</p>

    <div v-if="expanded" :id="previewId" class="preview">
      <section>
        <h4>Tasks</h4>
        <ul v-if="projectTasks.length" class="plain-list">
          <li v-for="task in projectTasks" :key="task.id" class="task" :class="{ done: task.completed }">
            <span class="check" aria-hidden="true">{{ task.completed ? '✓' : '○' }}</span>
            <span class="task-body">
              <span class="task-name">
                {{ task.name }}<span v-if="task.completed" class="sr-only"> (completed)</span>
              </span>
              <span class="tag" :class="`priority-${task.priority}`">{{ task.priority }}</span>
              <span v-if="!task.completed && isOverdue(task.dueDate)" class="tag overdue">overdue</span>
              <small v-if="task.dueDate">Due {{ task.dueDate }}</small>
            </span>
          </li>
        </ul>
        <p v-else><small>No tasks in this project yet.</small></p>
      </section>

      <section v-if="project.links.length">
        <h4>Reference links</h4>
        <ul class="plain-list">
          <li v-for="link in project.links" :key="link.url">
            <a :href="link.url" target="_blank" rel="noopener noreferrer">{{ link.label }}</a>
          </li>
        </ul>
      </section>
    </div>

    <footer>
      <progress :value="status.completed" :max="status.total || 1" />
      <small>{{ status.completed }} of {{ status.total }} tasks completed</small>
    </footer>
  </article>
</template>

<style scoped>
.project-tile {
  display: flex;
  flex-direction: column;
  margin: 0;
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;
}

.project-tile:hover {
  border-color: var(--pam-cream-muted);
}

.project-tile:not(.expanded):hover {
  transform: translateY(-2px);
}

/* An open tile takes the whole row of the dashboard grid */
.project-tile.expanded {
  grid-column: 1 / -1;
  cursor: auto;
}

.tile-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.tile-header h3 {
  margin: 0;
}

.tile-header button {
  width: auto;
  margin: 0;
}

.tile-toggle {
  display: inline-flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
}

.tile-toggle:focus-visible {
  outline: 2px solid var(--pam-cream-muted);
  outline-offset: 4px;
  box-shadow: none;
}

.chevron {
  display: inline-block;
  font-size: 0.8em;
  color: var(--pico-muted-color);
  transition: transform 0.15s;
}

.expanded .chevron {
  transform: rotate(90deg);
}

button.small {
  padding: 0.2rem 0.75rem;
  font-size: 0.85rem;
}

.meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-block: 0.75rem;
}

.meta small,
.task small {
  color: var(--pico-muted-color);
}

.description {
  color: var(--pico-muted-color);
  white-space: pre-line;
}

/* Collapsed tiles show the first few lines of the description */
.project-tile:not(.expanded) .description {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  overflow: hidden;
}

.preview {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
  gap: 1.5rem;
  padding-block: 1rem;
  border-top: 1px solid var(--pico-muted-border-color);
}

.preview section {
  margin: 0;
}

.preview h4 {
  margin-bottom: 0.75rem;
  font-size: 0.85rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--pico-muted-color);
}

.plain-list {
  margin: 0;
  padding: 0;
}

.plain-list li {
  list-style: none;
  margin-bottom: 0.5rem;
}

/* The icon keeps its own column; the name, badges and due date wrap beside it on narrow
   screens rather than under it */
.task {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.check {
  flex: none;
  width: 1.25rem;
  color: var(--pico-muted-color);
}

.task-body {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem 0.5rem;
  min-width: 0;
}

.task.done .task-name {
  text-decoration: line-through;
  opacity: 0.7;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.project-tile footer {
  margin-top: auto;
}

.project-tile footer progress {
  margin-bottom: 0.25rem;
}
</style>
