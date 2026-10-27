<script setup lang="ts">
// Page for one project, using the whole width of the screen: its details and progress, its
// timeline, every task with its description, and its reference links. Each task links to its own
// page and its check mark marks it done or not done; the Edit buttons open the project's or a
// task's form.
import { computed } from 'vue'
import ProjectTimeline from './projectTimeline.vue'
import TaskRow from './taskRow.vue'
import { completionStatus, resolveTasks, type Project } from '@/types/project'
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

const today = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD in local time
const isOverdue = computed(() => props.project.deliveryDate !== null && props.project.deliveryDate < today)

const projectTasks = computed(() => resolveTasks(props.project, props.tasks))
const status = computed(() => completionStatus(props.project, props.tasks))
</script>

<template>
  <article class="project-page">
    <RouterLink :to="{ name: 'dashboard' }" class="back-link">← Live projects</RouterLink>

    <header class="page-header">
      <h2>{{ project.name }}</h2>
      <button type="button" class="secondary outline" @click="$emit('edit', project)">Edit</button>
    </header>

    <div class="meta">
      <span v-for="tag in tags" :key="tag.id" class="tag project-tag">{{ tag.name }}</span>
      <span class="tag" :class="`priority-${project.priority}`">{{ project.priority }}</span>
      <span v-if="isOverdue" class="tag overdue">overdue</span>
      <small>Due {{ project.deliveryDate ?? 'whenever' }}</small>
    </div>

    <div class="progress">
      <progress :value="status.completed" :max="status.total || 1" />
      <small>{{ status.completed }} of {{ status.total }} tasks completed</small>
    </div>

    <p v-if="project.description" class="description">{{ project.description }}</p>

    <section class="timeline-section">
      <h3 class="section-heading">Timeline</h3>
      <ProjectTimeline :tasks="projectTasks" :delivery-date="project.deliveryDate" />
    </section>

    <div class="columns" :class="{ 'with-links': project.links.length }">
      <section>
        <h3 class="section-heading">Tasks</h3>
        <ul v-if="projectTasks.length" class="plain-list">
          <TaskRow
            v-for="task in projectTasks"
            :key="task.id"
            :task="task"
            show-description
            @edit="$emit('editTask', task)"
            @toggle-completed="$emit('toggleTask', task)"
          />
        </ul>
        <p v-else><small>No tasks in this project yet.</small></p>
      </section>

      <section v-if="project.links.length">
        <h3 class="section-heading">Reference links</h3>
        <ul class="plain-list">
          <li v-for="link in project.links" :key="link.url">
            <a :href="link.url" target="_blank" rel="noopener noreferrer">{{ link.label }}</a>
          </li>
        </ul>
      </section>
    </div>
  </article>
</template>

<style scoped>
.progress {
  max-width: 32rem;
  margin-bottom: 1rem;
}

.progress progress {
  margin-bottom: 0.25rem;
}

.progress small {
  color: var(--pico-muted-color);
}

.description {
  max-width: 48rem;
  color: var(--pico-muted-color);
  white-space: pre-line;
}

.project-page section {
  margin: 0;
  padding-block: 1.25rem;
  border-top: 1px solid var(--pico-muted-border-color);
}

.timeline-section {
  min-width: 0; /* so a long timeline scrolls inside the page instead of widening it */
}

/* Tasks beside the reference links on wide screens, above them on narrow ones */
.columns {
  display: grid;
  column-gap: 2rem;
}

@media (min-width: 768px) {
  .columns.with-links {
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  }
}
</style>
