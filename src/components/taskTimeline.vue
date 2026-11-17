<script setup lang="ts">
// A line on the task page placing today, the task's start date and its due date in order, each
// with its name above and its date (DD/MM/YYYY) below. The stretch from start to due, when the
// task has both, is drawn thicker. Points falling on the same day share one marker ("today ·
// start"). Shown only when the task has a start or due date.
import { computed } from 'vue'
import type { Task } from '@/types/task'

const props = defineProps<{
  task: Pick<Task, 'startDate' | 'dueDate' | 'completed'>
  today?: string // YYYY-MM-DD; defaults to today in local time, settable for tests
}>()

type Point = { date: string; labels: string[]; position: number; edge: 'first' | 'middle' | 'last' }

const today = computed(() => props.today ?? new Date().toLocaleDateString('en-CA'))

const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000
const formatDate = (iso: string) => iso.split('-').reverse().join('/')

const points = computed<Point[]>(() => {
  const named: [string, string | null | undefined][] = [
    ['today', today.value],
    ['start', props.task.startDate],
    ['due', props.task.dueDate],
  ]
  // Same-day points share a marker; the order above settles their label order
  const byDate = new Map<string, string[]>()
  for (const [label, date] of named) {
    if (!date) continue
    byDate.set(date, [...(byDate.get(date) ?? []), label])
  }
  const dates = [...byDate.keys()].sort()
  const first = dayNumber(dates[0]!)
  const span = dayNumber(dates[dates.length - 1]!) - first
  return dates.map((date, i) => {
    const edge = i === 0 ? 'first' : i === dates.length - 1 ? 'last' : 'middle'
    // A lone point sits in the middle. A middle point keeps clear of the ends, so its labels
    // never run into theirs, even when it is a day from one of them.
    let position = span === 0 ? 50 : ((dayNumber(date) - first) / span) * 100
    if (edge === 'middle') position = Math.min(65, Math.max(35, position))
    return { date, labels: byDate.get(date)!, position, edge: span === 0 ? 'middle' : edge }
  })
})

const shown = computed(() => Boolean(props.task.startDate || props.task.dueDate))

// The work window, from start to due, as left and width percentages of the line
const workWindow = computed(() => {
  const start = points.value.find((p) => p.labels.includes('start'))
  const due = points.value.find((p) => p.labels.includes('due'))
  if (!start || !due) return null
  return { left: start.position, width: due.position - start.position }
})

const isOverdue = computed(
  () => !props.task.completed && props.task.dueDate != null && props.task.dueDate < today.value,
)
</script>

<template>
  <figure v-if="shown" class="timeline" aria-label="Timeline">
    <div class="track">
      <div class="line" />
      <div v-if="workWindow" class="window" :style="{ left: `${workWindow.left}%`, width: `${workWindow.width}%` }" />
      <div
        v-for="point in points"
        :key="point.date"
        class="point"
        :class="[point.edge, { today: point.labels.includes('today'), late: isOverdue && point.labels.includes('due') }]"
        :style="{ left: `${point.position}%` }"
      >
        <span class="label">{{ point.labels.join(' · ') }}</span>
        <span class="marker" />
        <time class="date" :datetime="point.date">{{ formatDate(point.date) }}</time>
      </div>
    </div>
  </figure>
</template>

<style scoped>
.timeline {
  margin: 0 0 1.5rem;
  /* Room either side so the end markers' labels stay inside the page */
  padding: 0 0.25rem;
}

.track {
  position: relative;
  height: 4.25rem;
}

/* The line and the window run through the markers' middle */
.line,
.window {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
}

.line {
  left: 0;
  right: 0;
  height: 1px;
  background: var(--pam-green-line);
}

.window {
  height: 4px;
  border-radius: 2px;
  background: var(--pam-cream-muted);
}

.point {
  position: absolute;
  top: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: center;
  transform: translateX(-50%);
  white-space: nowrap;
}

/* The end points' text runs inward from the marker, so it never leaves the line's width */
.point.first {
  align-items: flex-start;
  transform: translateX(-0.375rem);
}

.point.last {
  align-items: flex-end;
  transform: translateX(calc(-100% + 0.375rem));
}

.label {
  font-size: 0.8rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--pico-muted-color);
}

.date {
  font-size: 0.85rem;
  color: var(--pam-cream);
}

.marker {
  width: 0.75rem;
  height: 0.75rem;
  border: 2px solid var(--pam-cream);
  border-radius: 50%;
  background: var(--pam-green);
}

.point.today .marker {
  background: var(--pam-cream);
}

.point.late .marker {
  border-color: var(--pam-coral);
}

.point.late .label,
.point.late .date {
  color: var(--pam-coral);
}
</style>
