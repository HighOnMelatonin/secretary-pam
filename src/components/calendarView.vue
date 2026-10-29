<script setup lang="ts">
// The calendar at /calendar: a month of tasks on their due dates and projects on their delivery
// dates, with a toolbar to move between months, choose the first day of the week and filter by
// tag, then the tasks with no due date. The month is in the URL (?month=YYYY-MM), so going back
// after a visit to a form or page returns to it. Shown by the dashboard in place of the project
// list, so the forms open over it and close back to it.
//
// On wide screens each day lists its items as chips. Below 768px the grid is compact, with dots
// for each day's items, and the selected day's items are listed below it.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CalendarGrid from './calendarGrid.vue'
import TagFilter from './tagFilter.vue'
import TaskRow from './taskRow.vue'
import UndatedTray from './undatedTray.vue'
import {
  addMonths,
  calendarItems,
  isOverdue,
  itemsByDate,
  localToday,
  matchesTags,
  monthGrid,
  monthLabel,
  monthOf,
  parseMonth,
  taskTagIds,
  undatedTasks,
  type SourceState,
  type Weekday,
} from '@/types/calendar'
import { isArchived, type Project } from '@/types/project'
import type { Tag } from '@/types/tag'
import type { Task } from '@/types/task'

const props = defineProps<{
  tasks: Task[]
  projects: Project[]
  tags: Tag[]
  sources: { task: SourceState; project: SourceState }
}>()

defineEmits<{
  editTask: [task: Task]
  toggleTask: [task: Task]
}>()

const today = localToday()
const route = useRoute()
const router = useRouter()

// The month shown, from the URL; this month when there is none or it isn't a month. Moving
// replaces the URL rather than adding to history, so back leaves the calendar.
const month = computed(() => parseMonth(route.query.month) ?? monthOf(today))
const goTo = (to: string) => router.replace({ query: { ...route.query, month: to } })

// The first day of the week, remembered in this browser until there's a settings page
const WEEK_START_KEY = 'pam.calendar.weekStart'
const WEEK_STARTS: { day: Weekday; label: string }[] = [
  { day: 1, label: 'Monday' },
  { day: 0, label: 'Sunday' },
]

function loadWeekStart(): Weekday {
  try {
    const stored = localStorage.getItem(WEEK_START_KEY)
    return WEEK_STARTS.find((w) => String(w.day) === stored)?.day ?? 1
  } catch {
    return 1 // storage blocked: Monday
  }
}

const weekStart = ref<Weekday>(loadWeekStart())
watch(weekStart, () => {
  try {
    localStorage.setItem(WEEK_START_KEY, String(weekStart.value))
  } catch {
    // Not remembered, but the calendar still works
  }
})

// The tag filter, for this visit only
const selectedTags = ref<string[]>([])
const toggleTag = (id: string) =>
  (selectedTags.value = selectedTags.value.includes(id)
    ? selectedTags.value.filter((t) => t !== id)
    : [...selectedTags.value, id])

const weeks = computed(() => monthGrid(month.value, weekStart.value))
const range = computed(() => {
  const lastWeek = weeks.value[weeks.value.length - 1]!
  return { from: weeks.value[0]![0]!.date, to: lastWeek[lastWeek.length - 1]!.date }
})
const items = computed(() =>
  calendarItems(props.tasks, props.projects, range.value.from, range.value.to, props.tags).filter((item) =>
    matchesTags(item.tagIds, selectedTags.value),
  ),
)
const byDate = computed(() => itemsByDate(items.value, range.value.from, range.value.to))
const undated = computed(() =>
  undatedTasks(props.tasks, props.projects).filter((t) => matchesTags(taskTagIds(t, props.projects), selectedTags.value)),
)

// Phones get the compact grid. Without matchMedia (as in tests) the full grid shows.
const PHONE = '(max-width: 767px)'
const compact = ref(false)
let phoneQuery: MediaQueryList | undefined
const updateCompact = () => (compact.value = phoneQuery?.matches ?? false)
onMounted(() => {
  if (typeof matchMedia !== 'function') return
  phoneQuery = matchMedia(PHONE)
  updateCompact()
  phoneQuery.addEventListener('change', updateCompact)
})
onUnmounted(() => phoneQuery?.removeEventListener('change', updateCompact))

// The day whose items are listed under the compact grid: today in this month, else the 1st
const defaultDay = () => (monthOf(today) === month.value ? today : `${month.value}-01`)
const selectedDate = ref(defaultDay())
watch(month, () => (selectedDate.value = defaultDay()))

const selectedItems = computed(() => byDate.value.get(selectedDate.value) ?? [])
const selectedTasks = computed(() =>
  selectedItems.value
    .filter((i) => i.source === 'task')
    .map((i) => props.tasks.find((t) => t.id === i.id))
    .filter((t) => t !== undefined),
)
const selectedDeliveries = computed(() => selectedItems.value.filter((i) => i.source === 'project'))
const selectedLabel = computed(() =>
  new Date(`${selectedDate.value}T00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
)
const projectNames = (task: Task) =>
  props.projects.filter((p) => !isArchived(p) && p.taskIds.includes(task.id)).map((p) => p.name)

// A notice for each source that failed to load, so what did load still shows
const SOURCE_NAMES = { task: 'Tasks', project: 'Project delivery dates' }
const failedSources = computed(() =>
  (Object.keys(props.sources) as (keyof typeof props.sources)[])
    .filter((source) => props.sources[source].error)
    .map((source) => ({ source, name: SOURCE_NAMES[source], error: props.sources[source].error })),
)
const loadingSources = computed(() => Object.values(props.sources).some((s) => s.loading))
</script>

<template>
  <section class="calendar" aria-labelledby="calendar-heading">
    <div class="heading-row toolbar">
      <h2 id="calendar-heading">{{ monthLabel(month) }}</h2>
      <div class="month-nav">
        <button type="button" class="secondary outline compact" aria-label="Previous month" @click="goTo(addMonths(month, -1))">
          ‹
        </button>
        <button
          type="button"
          class="secondary outline compact"
          :disabled="month === monthOf(today)"
          @click="goTo(monthOf(today))"
        >
          Today
        </button>
        <button type="button" class="secondary outline compact" aria-label="Next month" @click="goTo(addMonths(month, 1))">
          ›
        </button>
      </div>
    </div>

    <div class="options">
      <label class="week-start">
        Week starts on
        <select v-model.number="weekStart">
          <option v-for="w in WEEK_STARTS" :key="w.day" :value="w.day">{{ w.label }}</option>
        </select>
      </label>
      <details class="filters">
        <summary>
          Filter<span v-if="selectedTags.length"> ({{ selectedTags.length }} on)</span>
        </summary>
        <TagFilter :tags="tags" :selected="selectedTags" @toggle="toggleTag" />
      </details>
    </div>

    <p v-if="loadingSources" aria-busy="true">Loading…</p>
    <p v-for="failed in failedSources" :key="failed.source" class="error" role="alert">
      {{ failed.name }} couldn't be loaded, so they aren't shown: {{ failed.error }}
    </p>

    <CalendarGrid
      :weeks="weeks"
      :items-by-date="byDate"
      :compact="compact"
      :today="today"
      :selected-date="selectedDate"
      @select="selectedDate = $event"
    />

    <section v-if="compact" class="selected-day" aria-live="polite">
      <h3 class="section-heading">{{ selectedLabel }}</h3>
      <ul v-if="selectedItems.length" class="plain-list">
        <li v-for="item in selectedDeliveries" :key="item.id" class="delivery">
          <RouterLink :to="item.link">{{ item.title }}</RouterLink>
          <span class="tag">Delivery</span>
          <span v-if="isOverdue(item, today)" class="tag overdue">overdue</span>
        </li>
        <TaskRow
          v-for="task in selectedTasks"
          :key="task.id"
          :task="task"
          :project-names="projectNames(task)"
          @edit="$emit('editTask', task)"
          @toggle-completed="$emit('toggleTask', task)"
        />
      </ul>
      <p v-else><small>Nothing due.</small></p>
    </section>

    <UndatedTray
      :tasks="undated"
      :projects="projects"
      @edit-task="$emit('editTask', $event)"
      @toggle-task="$emit('toggleTask', $event)"
    />
  </section>
</template>

<style scoped>
.toolbar {
  margin-bottom: 0.75rem;
}

.month-nav {
  display: flex;
  gap: 0.25rem;
}

.month-nav button {
  min-width: 2.5rem;
}

/* The week start and the filter, under the month */
.options {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.5rem 1.5rem;
  margin-bottom: 1rem;
}

.week-start {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  color: var(--pico-muted-color);
  white-space: nowrap;
}

.week-start select {
  width: auto;
  margin: 0;
  padding-block: 0.3rem;
}

.filters {
  margin: 0;
}

.filters summary {
  color: var(--pico-muted-color);
}

.filters .chips {
  margin-top: 0.75rem;
}

.selected-day {
  margin-bottom: 1.5rem;
}

.delivery {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem 0.5rem;
}
</style>
