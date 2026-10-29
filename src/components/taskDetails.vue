<script setup lang="ts">
// Page for one task: its status, priority, due date and description, the projects it belongs to
// and the tasks it is related to, each linking to its own page. Edit opens the task's form.
import { computed } from 'vue'
import type { Project } from '@/types/project'
import { relatedTasks, relationLabel, type Task } from '@/types/task'

const props = defineProps<{
  task: Task
  tasks: Task[] // all tasks, to look up related ones
  projects: Project[] // all projects; the ones holding this task are listed
}>()

defineEmits<{
  edit: [task: Task]
}>()

const today = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD in local time
const isOverdue = computed(
  () => !props.task.completed && props.task.dueDate !== null && props.task.dueDate < today,
)

const inProjects = computed(() => props.projects.filter((p) => p.taskIds.includes(props.task.id)))
const related = computed(() => relatedTasks(props.task, props.tasks))
</script>

<template>
  <article class="task-page details-page">
    <RouterLink :to="{ name: 'dashboard' }" class="back-link">← Live projects</RouterLink>

    <header class="heading-row page-header">
      <h2 :class="{ struck: task.completed }">
        {{ task.name }}<span v-if="task.completed" class="sr-only"> (completed)</span>
      </h2>
      <button type="button" class="secondary outline" @click="$emit('edit', task)">Edit</button>
    </header>

    <div class="meta">
      <span class="tag" :class="{ 'done-tag': task.completed }">{{ task.completed ? '✓ done' : 'to do' }}</span>
      <span class="tag" :class="`priority-${task.priority}`">{{ task.priority }}</span>
      <span v-if="isOverdue" class="tag overdue">overdue</span>
      <small>{{ task.dueDate ? `Due ${task.dueDate}` : 'No due date' }}</small>
    </div>

    <p class="description">{{ task.description || 'No description.' }}</p>

    <div class="columns">
      <section>
        <h3 class="section-heading">Projects</h3>
        <ul v-if="inProjects.length" class="plain-list">
          <li v-for="project in inProjects" :key="project.id">
            <RouterLink :to="{ name: 'project', params: { id: project.id } }">{{ project.name }}</RouterLink>
          </li>
        </ul>
        <p v-else><small>Not in any project.</small></p>
      </section>

      <section>
        <h3 class="section-heading">Related tasks</h3>
        <ul v-if="related.length" class="plain-list related">
          <li v-for="relation in related" :key="`${relation.type}:${relation.task.id}`">
            <span class="relation-type">{{ relationLabel(relation.type) }}</span>
            <RouterLink
              :to="{ name: 'task', params: { id: relation.task.id } }"
              :class="{ struck: relation.task.completed }"
            >
              {{ relation.task.name }}<span v-if="relation.task.completed" class="sr-only"> (completed)</span>
            </RouterLink>
          </li>
        </ul>
        <p v-else><small>No related tasks.</small></p>
      </section>
    </div>
  </article>
</template>

<style scoped>
.done-tag {
  border-color: var(--pam-cream);
  color: var(--pam-cream);
}

/* Projects beside the related tasks on wide screens, above them on narrow ones (.columns and
   the sections are styled with the project page's, as .details-page in main.css) */
@media (min-width: 768px) {
  .columns {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.related li {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.25rem 0.75rem;
}

/* e.g. "BLOCKED BY", in a column of its own so the task names line up */
.relation-type {
  flex: none;
  min-width: 7rem;
  font-size: 0.8rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--pico-muted-color);
}
</style>
