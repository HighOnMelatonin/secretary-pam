<script setup lang="ts">
// The tasks coming up across every project (see types/upcoming.ts): overdue ones first, then
// the ones due in the next two weeks, each with its check mark, Edit button and projects.
// A section at the top of the dashboard, above the projects. Once it has scrolled out of view,
// a counter of the overdue tasks floats in the corner, and clicking it scrolls back up to it.
import { computed, onMounted, onUnmounted, ref } from 'vue'
import TaskRow from './taskRow.vue'
import type { Project } from '@/types/project'
import type { Task } from '@/types/task'
import { UPCOMING_DAYS, upcomingTasks, type UpcomingTask } from '@/types/upcoming'

const props = defineProps<{
  tasks: Task[]
  projects: Project[]
}>()

defineEmits<{
  editTask: [task: Task]
  toggleTask: [task: Task]
}>()

const today = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD in local time
const list = computed(() => upcomingTasks(props.tasks, props.projects, today))
const overdueCount = computed(() => list.value.overdue.length)

const sections = computed(() =>
  [
    { heading: 'Overdue', items: list.value.overdue },
    { heading: `Next ${UPCOMING_DAYS} days`, items: list.value.upcoming },
  ].filter((s) => s.items.length > 0),
)
const namesOf = (item: UpcomingTask) => item.projects.map((p) => p.name)

// Whether any of the panel is on screen; the counter only shows once none of it is
const panel = ref<HTMLElement>()
const inView = ref(true)
let observer: IntersectionObserver | undefined

onMounted(() => {
  // Not available in every browser (or in tests); the counter then never shows
  if (typeof IntersectionObserver === 'undefined' || !panel.value) return
  observer = new IntersectionObserver(([entry]) => (inView.value = entry!.isIntersecting))
  observer.observe(panel.value)
})
onUnmounted(() => observer?.disconnect())

function scrollToPanel() {
  panel.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <section ref="panel" class="upcoming" aria-labelledby="upcoming-heading">
    <h2 id="upcoming-heading">Upcoming</h2>

    <div v-for="section in sections" :key="section.heading" class="group">
      <h3 class="section-heading">{{ section.heading }}</h3>
      <ul class="plain-list">
        <TaskRow
          v-for="item in section.items"
          :key="item.task.id"
          :task="item.task"
          :project-names="namesOf(item)"
          @edit="$emit('editTask', item.task)"
          @toggle-completed="$emit('toggleTask', item.task)"
        />
      </ul>
    </div>
    <p v-if="sections.length === 0" class="empty"><small>Nothing due in the next {{ UPCOMING_DAYS }} days.</small></p>
  </section>

  <button
    v-if="!inView && overdueCount > 0"
    type="button"
    class="overdue-counter"
    :aria-label="`${overdueCount} overdue ${overdueCount === 1 ? 'task' : 'tasks'}: back to upcoming tasks`"
    @click="scrollToPanel"
  >
    {{ overdueCount }} overdue <span aria-hidden="true">↑</span>
  </button>
</template>

<style scoped>
/* Set off from the projects below by a line, like the archived section */
.upcoming {
  margin-bottom: 2.5rem;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid var(--pico-muted-border-color);
  scroll-margin-top: 1rem;
}

.upcoming h2 {
  margin-bottom: 1rem;
}

.group + .group {
  margin-top: 1.25rem;
}

.empty {
  margin: 0;
}

.empty small {
  color: var(--pico-muted-color);
}

/* Floats in the top-right corner, out of the way of the + button at the bottom */
.overdue-counter {
  position: fixed;
  top: calc(1rem + env(safe-area-inset-top));
  right: 1rem;
  z-index: 10;
  width: auto;
  margin: 0;
  padding: 0.4rem 1rem;
  border: none;
  border-radius: 999px;
  background: var(--pam-coral);
  color: var(--pam-green);
  font-size: 0.9rem;
  font-weight: 600;
  box-shadow: 0 0.5rem 1.5rem rgba(0, 0, 0, 0.35);
}

.overdue-counter:hover {
  background: #eeb293;
}
</style>
