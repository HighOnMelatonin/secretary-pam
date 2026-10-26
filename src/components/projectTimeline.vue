<script setup lang="ts">
// A project's tasks laid out along their due dates, shown in the expanded project tile. Tasks
// due on the same day share a stop; today and the delivery date get a stop of their own when
// no task falls on them, and tasks with no due date are gathered at the end. Runs left to right,
// scrolling sideways when crowded, and top to bottom on phones.
import { computed, onMounted, ref } from 'vue'
import type { Task } from '@/types/task'

const props = defineProps<{
  tasks: Task[] // the project's own tasks
  deliveryDate: string | null
}>()

interface Stop {
  date: string | null // null for the tasks with no due date
  tasks: Task[]
  isToday: boolean
  isDelivery: boolean
}

const today = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD in local time

const stops = computed<Stop[]>(() => {
  const byDate = new Map<string, Stop>()
  const stopAt = (date: string) => {
    let stop = byDate.get(date)
    if (!stop) {
      stop = { date, tasks: [], isToday: date === today, isDelivery: false }
      byDate.set(date, stop)
    }
    return stop
  }

  const undated = props.tasks.filter((t) => !t.dueDate)
  for (const task of props.tasks) if (task.dueDate) stopAt(task.dueDate).tasks.push(task)
  if (props.deliveryDate) stopAt(props.deliveryDate).isDelivery = true
  // Today only means something next to other dates
  if (byDate.size) stopAt(today)

  const dated = [...byDate.values()].sort((a, b) => a.date!.localeCompare(b.date!))
  return undated.length ? [...dated, { date: null, tasks: undated, isToday: false, isDelivery: false }] : dated
})

const hasDates = computed(() => stops.value.some((s) => s.date))

// Past its date with work left, or a delivery date that has passed (as the tile's overdue tag)
const isOverdue = (stop: Stop) =>
  stop.date !== null && stop.date < today && (stop.isDelivery || stop.tasks.some((t) => !t.completed))
const isDone = (stop: Stop) => stop.tasks.length > 0 && stop.tasks.every((t) => t.completed) && !isOverdue(stop)

// "2 Nov", with the year only when it isn't this one
function formatDate(date: string) {
  const sameYear = date.slice(0, 4) === today.slice(0, 4)
  return new Date(`${date}T00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
  })
}

// Starts scrolled so today is in view, a little in from the left, when the stops overflow
const list = ref<HTMLOListElement>()
onMounted(() => {
  const todayStop = list.value?.querySelector<HTMLElement>('.stop.today')
  if (list.value && todayStop) list.value.scrollLeft = todayStop.offsetLeft - list.value.clientWidth / 4
})
</script>

<template>
  <ol v-if="hasDates" ref="list" class="timeline">
    <li
      v-for="stop in stops"
      :key="stop.date ?? 'undated'"
      class="stop"
      :class="{
        today: stop.isToday,
        delivery: stop.isDelivery,
        undated: !stop.date,
        overdue: isOverdue(stop),
        done: isDone(stop),
      }"
    >
      <span class="when">
        <time v-if="stop.date" :datetime="stop.date">{{ formatDate(stop.date) }}</time>
        <span v-else>No due date</span>
        <span v-if="stop.isToday" class="tag today-tag">Today</span>
        <span v-if="stop.isDelivery" class="tag">Delivery</span>
        <span v-if="isOverdue(stop)" class="sr-only">(overdue)</span>
      </span>
      <span class="rail" aria-hidden="true"><span class="marker" /></span>
      <ul v-if="stop.tasks.length" class="stop-tasks">
        <li v-for="task in stop.tasks" :key="task.id" :class="{ done: task.completed }">
          <span class="check" aria-hidden="true">{{ task.completed ? '✓' : '○' }}</span>
          <span class="task-name">
            {{ task.name }}<span v-if="task.completed" class="sr-only"> (completed)</span>
          </span>
        </li>
      </ul>
    </li>
  </ol>
  <p v-else><small>Give this project's tasks due dates to see them on a timeline.</small></p>
</template>

<style scoped>
/* Left to right: each stop is a column of the date, the rail with its marker, then the tasks.
   The stops share the list's rows (subgrid), so every marker sits on one line however tall the
   dates above it wrap */
.timeline {
  position: relative; /* so a stop's offsetLeft is measured from here */
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(9rem, 1fr);
  grid-template-rows: auto 1rem auto;
  row-gap: 0.5rem;
  margin: 0;
  padding: 0 0 0.75rem;
  overflow-x: auto;
}

.stop {
  display: grid;
  grid-row: span 3;
  grid-template-rows: subgrid;
  margin: 0;
  list-style: none;
}

.when {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem 0.4rem;
  padding-right: 1rem;
  font-size: 0.85rem;
  color: var(--pico-muted-color);
}

.today .when {
  color: var(--pam-cream);
}

.today-tag {
  border-color: var(--pam-cream);
  color: var(--pam-cream);
}

.rail {
  position: relative;
}

/* The line runs through every stop, from the first marker to the last */
.rail::before {
  content: '';
  position: absolute;
  top: calc(50% - 1px);
  left: 0;
  right: 0;
  border-top: 2px solid var(--pam-green-line);
}

.stop:first-child .rail::before {
  left: 0.5rem;
}

.stop:last-child .rail::before {
  right: calc(100% - 0.5rem);
}

.stop:only-child .rail::before {
  display: none;
}

/* The undated tasks aren't on the calendar, so the line to them is dashed */
.undated .rail::before {
  border-top-style: dashed;
}

/* Hollow while there is work to do, filled cream once it is all done, coral when overdue.
   The delivery date is a diamond, and today has a halo */
.marker {
  position: absolute;
  top: 50%;
  left: 0;
  width: 1rem;
  height: 1rem;
  margin-top: -0.5rem;
  border: 2px solid var(--pam-cream-muted);
  border-radius: 50%;
  background: var(--pico-card-background-color);
}

.done .marker {
  border-color: var(--pam-cream);
  background: var(--pam-cream);
}

.overdue .marker {
  border-color: var(--pam-coral);
  background: var(--pam-coral);
}

.today .marker {
  border-color: var(--pam-cream);
  box-shadow: 0 0 0 4px var(--pam-cream-faint);
}

.delivery .marker {
  border-radius: 2px;
  transform: rotate(45deg) scale(0.9);
}

.undated .marker {
  border-style: dashed;
}

.stop-tasks {
  margin: 0;
  padding: 0 1rem 0 0;
  font-size: 0.9rem;
}

.stop-tasks li {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  margin-bottom: 0.35rem;
  list-style: none;
}

.check {
  flex: none;
  color: var(--pico-muted-color);
}

.stop-tasks li.done .task-name {
  text-decoration: line-through;
  opacity: 0.7;
}

/* Phones: top to bottom, with the rail down the left. The line is drawn on the stop itself so
   it runs through the space between stops */
@media (max-width: 575px) {
  .timeline {
    display: flex;
    flex-direction: column;
    overflow-x: visible;
  }

  .stop {
    position: relative;
    grid-row: auto;
    grid-template-columns: 1rem 1fr;
    grid-template-rows: auto 1fr;
    column-gap: 0.75rem;
    row-gap: 0.35rem;
    padding-bottom: 1rem;
  }

  .when {
    grid-column: 2;
    grid-row: 1;
  }

  .rail {
    grid-column: 1;
    grid-row: 1 / -1;
  }

  .stop-tasks {
    grid-column: 2;
    grid-row: 2;
  }

  .rail::before {
    display: none;
  }

  .stop::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(0.5rem - 1px);
    border-left: 2px solid var(--pam-green-line);
  }

  .stop:first-child::before {
    top: 0.75rem;
  }

  .stop:last-child::before {
    bottom: auto;
    height: 0.75rem;
  }

  .stop:only-child::before {
    display: none;
  }

  .undated::before {
    border-left-style: dashed;
  }

  .marker {
    top: 0.25rem;
    margin-top: 0;
  }
}
</style>
