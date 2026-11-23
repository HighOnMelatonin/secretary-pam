<script setup lang="ts">
// Page for one task: its status, priority, due date, a timeline of today, its start and its due
// date, and its description, the projects it belongs to
// and the tasks it is related to, each linking to its own page. Edit opens the task's form;
// Delete removes the task, done or not, once confirmed.
import { computed } from 'vue'
import { errandDay, isErrand, recurrenceLabel } from '@/types/errand'
import type { Project } from '@/types/project'
import { relatedTasks, relationLabel, type Task } from '@/types/task'
import { tagStyle, type Tag } from '@/types/tag'
import TaskTimeline from './taskTimeline.vue'

const props = defineProps<{
  task: Task
  tasks: Task[] // all tasks, to look up related ones
  projects: Project[] // all projects; the ones holding this task are listed
  tags?: Tag[] // all tags; the task's own are shown
}>()

const emit = defineEmits<{
  edit: [task: Task]
  delete: [task: Task]
}>()

const today = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD in local time
const isOverdue = computed(
  () => !props.task.completed && props.task.dueDate !== null && props.task.dueDate < today,
)

// An errand's planned day, and how many days it has rolled over by (src/types/errand.ts)
const errand = computed(() => isErrand(props.task))
const rolled = computed(() => errandDay(props.task, today))

const inProjects = computed(() => props.projects.filter((p) => p.taskIds.includes(props.task.id)))
const related = computed(() => relatedTasks(props.task, props.tasks))
const taskTags = computed(() =>
  (props.task.tagIds ?? []).map((id) => props.tags?.find((t) => t.id === id)).filter((t) => t !== undefined),
)

function confirmDelete() {
  // An imported task comes back on the next sync while its event is still in Google Calendar
  const comesBack = props.task.googleAccount ? ' It will be imported again on the next sync unless its event is deleted in Google Calendar.' : ''
  if (confirm(`Delete "${props.task.name}"?${comesBack}`)) emit('delete', props.task)
}
</script>

<template>
  <article class="task-page details-page">
    <RouterLink :to="{ name: 'dashboard' }" class="back-link">← Live projects</RouterLink>

    <header class="heading-row page-header">
      <h2 :class="{ struck: task.completed }">
        {{ task.name }}<span v-if="task.completed" class="sr-only"> (completed)</span>
      </h2>
      <div class="page-actions">
        <button type="button" class="secondary outline" @click="emit('edit', task)">Edit</button>
        <button type="button" class="secondary outline" @click="confirmDelete">Delete</button>
      </div>
    </header>

    <div class="meta">
      <span v-for="tag in taskTags" :key="tag.id" class="tag project-tag" :style="tagStyle(tag)">{{ tag.name }}</span>
      <span class="tag" :class="{ 'done-tag': task.completed }">{{ task.completed ? '✓ done' : 'to do' }}</span>
      <span v-if="errand" class="tag errand-tag">errand</span>
      <span v-else class="tag" :class="`priority-${task.priority}`">{{ task.priority }}</span>
      <span v-if="task.googleAccount" class="tag project-tag" title="Imported from Google Calendar">{{ task.googleAccount }}</span>
      <span v-if="isOverdue" class="tag overdue">overdue</span>
      <small v-if="errand && task.pinnedDate">
        Planned {{ task.pinnedDate }}<template v-if="rolled && rolled.carriedDays > 0">, rolled over to today</template>
      </small>
      <small>{{ task.dueDate ? `Due ${task.dueDate}` : 'No due date' }}</small>
      <small v-if="task.recurrence">{{ recurrenceLabel(task.recurrence) }}</small>
    </div>

    <TaskTimeline v-if="!errand" :task="task" />

    <p v-if="task.googleAccount" class="source">
      <small>From Google Calendar. Syncing sets its name, due date and description from the event again.</small>
    </p>

    <p class="description">{{ task.description || 'No description.' }}</p>

    <section v-if="task.checklist?.length" class="checklist">
      <h3 class="section-heading">Checklist</h3>
      <ul class="plain-list">
        <li v-for="(item, i) in task.checklist" :key="i" :class="{ struck: item.done }">
          {{ item.done ? '✓' : '○' }} {{ item.text }}<span v-if="item.done" class="sr-only"> (done)</span>
        </li>
      </ul>
    </section>

    <!-- An errand is in no project and has no related tasks, so neither is listed -->
    <div v-if="!errand" class="columns">
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
.page-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

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
