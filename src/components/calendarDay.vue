<script setup lang="ts">
// One day of the calendar grid, carrying its date as data-date. On wide screens it lists the
// day's items as chips linking to their pages, at most MAX_CHIPS before a "+N more" that expands
// the day. In the compact grid on phones the whole day is a button showing a dot per item,
// which selects the day so its items are listed below the grid.
import { computed, ref } from 'vue'
import { isOverdue, type CalendarItem, type GridDay } from '@/types/calendar'
import { textColorOn } from '@/types/tag'

const MAX_CHIPS = 3
const MAX_DOTS = 4

const props = defineProps<{
  day: GridDay
  items: CalendarItem[] // the day's items, in order
  compact: boolean
  today: string
  selected: boolean
}>()

defineEmits<{
  select: [date: string]
}>()

const isToday = computed(() => props.day.date === props.today)
const dayNumber = computed(() => Number(props.day.date.slice(8)))
const overdue = (item: CalendarItem) => isOverdue(item, props.today)
const overdueCount = computed(() => props.items.filter(overdue).length)

// "Monday 2 November", for the compact day's button
const longDate = computed(() =>
  new Date(`${props.day.date}T00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
)
const buttonLabel = computed(() => {
  const count = props.items.length
  const parts = [longDate.value, count === 0 ? 'nothing due' : `${count} ${count === 1 ? 'item' : 'items'}`]
  if (overdueCount.value) parts.push(`${overdueCount.value} overdue`)
  if (isToday.value) parts.push('today')
  return parts.join(', ')
})

const expanded = ref(false)
const shownItems = computed(() => (expanded.value ? props.items : props.items.slice(0, MAX_CHIPS)))
const hiddenCount = computed(() => props.items.length - shownItems.value.length)

// The item's colour as the fill, with cream or green text, whichever reads better on it
const chipStyle = (item: CalendarItem) => ({ '--chip-fill': item.colour, '--chip-text': textColorOn(item.colour) })
</script>

<template>
  <td
    :data-date="day.date"
    class="day"
    :class="{ outside: !day.inMonth, today: isToday, selected, compact }"
  >
    <button
      v-if="compact"
      type="button"
      class="day-button"
      :aria-pressed="selected"
      :aria-label="buttonLabel"
      @click="$emit('select', day.date)"
    >
      <span class="day-number">{{ dayNumber }}</span>
      <span class="dots" aria-hidden="true">
        <span
          v-for="item in items.slice(0, MAX_DOTS)"
          :key="`${item.source}:${item.id}`"
          class="dot"
          :class="{ flag: item.source === 'project', overdue: overdue(item) }"
          :style="{ background: item.colour }"
        />
      </span>
    </button>

    <template v-else>
      <time class="day-number" :datetime="day.date">{{ dayNumber }}</time>
      <span v-if="isToday" class="sr-only"> (today)</span>
      <ul v-if="items.length" class="day-items">
        <li v-for="item in shownItems" :key="`${item.source}:${item.id}`">
          <RouterLink
            :to="item.link"
            class="item-chip"
            :class="{ flag: item.source === 'project', overdue: overdue(item) }"
            :style="chipStyle(item)"
            :title="item.source === 'project' ? `${item.title}: delivery date` : item.title"
          >
            <span v-if="item.source === 'project'" aria-hidden="true">⚑ </span>
            <span>{{ item.title }}</span>
            <span v-if="item.source === 'project'" class="sr-only">(delivery date)</span>
            <span v-if="overdue(item)" class="sr-only">(overdue)</span>
          </RouterLink>
        </li>
      </ul>
      <button v-if="hiddenCount > 0" type="button" class="more" @click="expanded = true">+{{ hiddenCount }} more</button>
      <button v-else-if="expanded && items.length > MAX_CHIPS" type="button" class="more" @click="expanded = false">
        Show fewer
      </button>
    </template>
  </td>
</template>

<style scoped>
.day {
  height: 7rem;
  padding: 0.35rem;
  border: 1px solid var(--pam-green-line);
  vertical-align: top;
  background: var(--pam-green);
}

.outside {
  background: transparent;
}

.outside .day-number {
  color: var(--pico-muted-color);
  opacity: 0.6;
}

.day-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.6rem;
  height: 1.6rem;
  margin-bottom: 0.25rem;
  border-radius: 999px;
  font-size: 0.85rem;
  color: var(--pico-muted-color);
}

/* Today gets a cream ring with a halo, like today's stop on a project's timeline */
.today .day-number {
  border: 2px solid var(--pam-cream);
  color: var(--pam-cream);
  box-shadow: 0 0 0 3px var(--pam-cream-faint);
}

.day-items {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin: 0;
  padding: 0;
}

.day-items li {
  margin: 0;
  list-style: none;
}

/* A task: a pill in its tag's colour. A delivery date: a squarer flag. Overdue ones get a coral
   ring, as overdue stops on the timeline turn coral. */
.item-chip {
  display: block;
  overflow: hidden;
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  background: var(--chip-fill);
  color: var(--chip-text);
  font-size: 0.75rem;
  line-height: 1.5;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-chip.flag {
  border-radius: 0.2rem;
  font-weight: 600;
}

.item-chip.overdue {
  box-shadow: 0 0 0 2px var(--pam-coral);
}

.item-chip:focus-visible {
  outline: 2px solid var(--pam-cream);
  outline-offset: 2px;
}

.more {
  width: auto;
  margin: 0.2rem 0 0;
  padding: 0;
  border: none;
  background: none;
  color: var(--pico-muted-color);
  font-size: 0.75rem;
  text-decoration: underline;
}

.more:hover {
  color: var(--pam-cream);
}

/* Compact: the day is one button, its number above a row of dots */
.day.compact {
  height: auto;
  padding: 0;
}

.day-button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  width: 100%;
  min-height: 3.25rem;
  margin: 0;
  padding: 0.25rem 0;
  border: none;
  border-radius: 0;
  background: none;
  color: inherit;
}

.day-button .day-number {
  margin: 0;
}

.selected .day-button {
  background: var(--pam-green-raised);
  box-shadow: inset 0 0 0 2px var(--pam-cream-muted);
}

.day-button:focus-visible {
  outline: 2px solid var(--pam-cream);
  outline-offset: -2px;
}

.dots {
  display: flex;
  gap: 0.2rem;
  min-height: 0.5rem;
}

/* A dot per item in its colour, with a cream edge so dark colours show on the green; delivery
   dates are diamonds, as on the timeline, and overdue ones coral-ringed */
.dot {
  width: 0.5rem;
  height: 0.5rem;
  border: 1px solid var(--pam-cream-muted);
  border-radius: 50%;
}

.dot.flag {
  border-radius: 1px;
  transform: rotate(45deg) scale(0.85);
}

.dot.overdue {
  border-color: var(--pam-coral);
  box-shadow: 0 0 0 1px var(--pam-coral);
}
</style>
