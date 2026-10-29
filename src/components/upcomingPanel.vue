<script setup lang="ts">
// The tasks coming up across every project (see types/upcoming.ts): overdue ones first, then
// the ones due in the next two weeks, each with its check mark, Edit button and projects.
// A section at the top of the dashboard, above the projects. It can be collapsed to its first
// PREVIEW_COUNT tasks, which this browser remembers. Once it has scrolled out of view, a counter
// of the overdue tasks floats in the corner, and clicking it scrolls back up to it.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
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

// How many tasks a collapsed panel still shows: the first ones, overdue before upcoming
const PREVIEW_COUNT = 2
const STORAGE_KEY = 'pam.upcomingCollapsed'

function loadCollapsed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false // storage blocked: start expanded
  }
}

const collapsed = ref(loadCollapsed())
watch(collapsed, () => {
  try {
    localStorage.setItem(STORAGE_KEY, String(collapsed.value))
  } catch {
    // Not remembered, but the panel still works
  }
})

const total = computed(() => list.value.overdue.length + list.value.upcoming.length)
// Collapsing only hides something when there are more tasks than the preview shows
const canCollapse = computed(() => total.value > PREVIEW_COUNT)
const isCollapsed = computed(() => collapsed.value && canCollapse.value)

// Each heading with its tasks; a collapsed panel keeps the headings of the tasks it still shows
const sections = computed(() => {
  let room = isCollapsed.value ? PREVIEW_COUNT : Infinity
  return [
    { heading: 'Overdue', items: list.value.overdue },
    { heading: `Next ${UPCOMING_DAYS} days`, items: list.value.upcoming },
  ]
    .map((section) => {
      const items = section.items.slice(0, room)
      room -= items.length
      return { ...section, items }
    })
    .filter((s) => s.items.length > 0)
})
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
    <div class="heading-row upcoming-heading">
      <h2 id="upcoming-heading">Upcoming</h2>
      <button
        v-if="canCollapse"
        type="button"
        class="secondary outline compact collapse-toggle"
        aria-controls="upcoming-tasks"
        :aria-expanded="!isCollapsed"
        @click="collapsed = !isCollapsed"
      >
        {{ isCollapsed ? `Show all ${total}` : 'Show fewer' }}
      </button>
    </div>

    <div id="upcoming-tasks">
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
      <p v-if="isCollapsed" class="more">
        <small>{{ total - PREVIEW_COUNT }} more hidden</small>
      </p>
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

/* The heading, with the button to collapse or expand the panel */
.upcoming-heading {
  margin-bottom: 1rem;
}

.more {
  margin: 0.25rem 0 0;
}

.more small {
  color: var(--pico-muted-color);
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
