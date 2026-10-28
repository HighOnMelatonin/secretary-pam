<script setup lang="ts">
// Dashboard tile for one project. Clicking it expands a preview of the project's timeline, tasks
// and links; each task links to its own page, has an Edit button, and its check mark marks it done
// or not done. At the top, View more opens the project's page and Edit opens the project form.
import { computed } from 'vue'
import ProjectTimeline from './projectTimeline.vue'
import TaskRow from './taskRow.vue'
import { completionStatus, resolveTasks, type Project } from '@/types/project'
import { safeHref } from '@/types/limits'
import type { Tag } from '@/types/tag'
import type { Task } from '@/types/task'

const props = defineProps<{
  project: Project
  tasks: Task[] // all tasks; the project's own are looked up by id
  tags: Tag[] // the project's tags
}>()

defineEmits<{
  edit: [project: Project]
  editTask: [task: Task]
  toggleTask: [task: Task]
}>()

// v-model:expanded lets the dashboard open or close every tile at once; without it the
// tile keeps its own state
const expanded = defineModel<boolean>('expanded', { default: false })

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
      <div class="tile-actions">
        <RouterLink
          :to="{ name: 'project', params: { id: project.id } }"
          role="button"
          class="secondary outline small"
          :aria-label="`View more of ${project.name}`"
        >
          View more
        </RouterLink>
        <button type="button" class="secondary outline small" @click="$emit('edit', project)">Edit</button>
      </div>
    </div>

    <div class="meta">
      <span v-for="tag in tags" :key="tag.id" class="tag project-tag">{{ tag.name }}</span>
      <span class="tag" :class="`priority-${project.priority}`">{{ project.priority }}</span>
      <span v-if="isOverdue(project.deliveryDate)" class="tag overdue">overdue</span>
      <small>Due {{ project.deliveryDate ?? 'whenever' }}</small>
    </div>

    <p v-if="project.description" class="description">{{ project.description }}</p>

    <div v-if="expanded" :id="previewId" class="preview">
      <section class="timeline-section">
        <h4 class="section-heading">Timeline</h4>
        <ProjectTimeline :tasks="projectTasks" :delivery-date="project.deliveryDate" />
      </section>

      <section>
        <h4 class="section-heading">Tasks</h4>
        <ul v-if="projectTasks.length" class="plain-list">
          <TaskRow
            v-for="task in projectTasks"
            :key="task.id"
            :task="task"
            @edit="$emit('editTask', task)"
            @toggle-completed="$emit('toggleTask', task)"
          />
        </ul>
        <p v-else><small>No tasks in this project yet.</small></p>
      </section>

      <section v-if="project.links.length">
        <h4 class="section-heading">Reference links</h4>
        <ul class="plain-list">
          <li v-for="link in project.links" :key="link.url">
            <a :href="safeHref(link.url)" target="_blank" rel="noopener noreferrer">{{ link.label }}</a>
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

/* The name wraps, rather than pushing View more and Edit off the tile */
.tile-header h3 {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.tile-actions {
  display: flex;
  flex: none;
  gap: 0.5rem;
}

.tile-actions > * {
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

.small {
  padding: 0.2rem 0.75rem;
  font-size: 0.85rem;
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

/* Across the whole tile, above the task and link lists */
.timeline-section {
  grid-column: 1 / -1;
  min-width: 0; /* so a long timeline scrolls inside the tile instead of widening it */
}

.project-tile footer {
  margin-top: auto;
}

.project-tile footer progress {
  margin-bottom: 0.25rem;
}
</style>
