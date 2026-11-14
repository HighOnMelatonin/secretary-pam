<script setup lang="ts">
// The tasks coming up across every project, in one of two views, chosen with a switch that this
// browser remembers:
// - By date (see types/upcoming.ts): overdue ones first, then the ones due in the next two weeks,
//   each with its check mark, Edit button and projects.
// - Suggested (see types/priority.ts and suggestedList.vue): every open task ranked into Overdue,
//   Do nowww and Do next, with why and quick actions.
// A section at the top of the dashboard, above the projects. It can be collapsed to its first
// PREVIEW_COUNT tasks, which this browser remembers. Once it has scrolled out of view, a counter
// of the overdue tasks floats in the corner, and clicking it scrolls back up to it.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import SuggestedList from './suggestedList.vue'
import TaskRow from './taskRow.vue'
import { localToday } from '@/types/calendar'
import type { TaskAction } from '@/types/operations'
import { prioritise } from '@/types/priority'
import type { Project } from '@/types/project'
import { DEFAULT_SETTINGS, type UserSettings } from '@/types/settings'
import type { Task } from '@/types/task'
import { UPCOMING_DAYS, upcomingTasks, type UpcomingTask } from '@/types/upcoming'

const props = defineProps<{
  tasks: Task[]
  projects: Project[]
  settings?: UserSettings // for Suggested; the defaults when omitted
  today?: string // YYYY-MM-DD; this browser's today when omitted
}>()

defineEmits<{
  editTask: [task: Task]
  toggleTask: [task: Task]
  action: [task: Task, action: TaskAction]
}>()

const today = props.today ?? localToday()
const list = computed(() => upcomingTasks(props.tasks, props.projects, today))
const overdueCount = computed(() => list.value.overdue.length)

// Which view is shown
type Mode = 'by-date' | 'suggested'
const MODE_KEY = 'pam.upcomingMode'

function loadMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'suggested' ? 'suggested' : 'by-date'
  } catch {
    return 'by-date' // storage blocked: start with the list by date
  }
}

const mode = ref<Mode>(loadMode())
watch(mode, () => {
  try {
    localStorage.setItem(MODE_KEY, mode.value)
  } catch {
    // Not remembered, but the switch still works
  }
})

const priorities = computed(() => prioritise(props.tasks, props.projects, props.settings ?? DEFAULT_SETTINGS, today))
const suggestedCount = computed(() => Object.values(priorities.value.sections).reduce((sum, ids) => sum + ids.length, 0))

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

const total = computed(() =>
  mode.value === 'suggested' ? suggestedCount.value : list.value.overdue.length + list.value.upcoming.length,
)
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
      <!-- Not role="group", which Pico stretches into a full-width bar of joined buttons -->
      <div class="mode-switch">
        <button
          type="button"
          class="chip compact"
          :aria-pressed="mode === 'by-date'"
          @click="mode = 'by-date'"
        >
          By date
        </button>
        <button
          type="button"
          class="chip compact"
          :aria-pressed="mode === 'suggested'"
          @click="mode = 'suggested'"
        >
          Suggested
        </button>
      </div>
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

    <div v-if="mode === 'suggested'" id="upcoming-tasks">
      <SuggestedList
        :priorities="priorities"
        :tasks="tasks"
        :projects="projects"
        :today="today"
        :limit="isCollapsed ? PREVIEW_COUNT : null"
        @edit-task="$emit('editTask', $event)"
        @toggle-task="$emit('toggleTask', $event)"
        @action="(task, action) => $emit('action', task, action)"
      />
      <p v-if="isCollapsed" class="more">
        <small>{{ total - PREVIEW_COUNT }} more hidden</small>
      </p>
    </div>

    <div v-else id="upcoming-tasks">
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
    <p v-if="mode === 'by-date' && sections.length === 0" class="empty"><small>Nothing due in the next {{ UPCOMING_DAYS }} days.</small></p>
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

/* The heading, with the view switch and the button to collapse or expand the panel */
.upcoming-heading {
  margin-bottom: 1rem;
}

/* By date and Suggested, side by side, as chips. The chosen one is filled cream, like a primary
   button, rather than indigo, which is kept for areas of life */
.mode-switch {
  display: flex;
  gap: 0.4rem;
  margin-right: auto;
}

.mode-switch .chip[aria-pressed='true'] {
  border-color: var(--pam-cream);
  background: var(--pam-cream);
  color: var(--pam-green);
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
