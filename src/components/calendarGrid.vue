<script setup lang="ts">
// A month as a table of weeks, from monthGrid, with the weekday names across the top. The
// compact version, for phones, shows each day as a dot-marked button that selects it.
import { computed } from 'vue'
import CalendarDay from './calendarDay.vue'
import type { CalendarItem, GridDay } from '@/types/calendar'

const props = defineProps<{
  weeks: GridDay[][]
  itemsByDate: Map<string, CalendarItem[]>
  compact: boolean
  today: string
  selectedDate: string
}>()

defineEmits<{
  select: [date: string]
}>()

// Named from the first week's own dates, so they follow whichever day the week starts on
const weekdays = computed(() =>
  (props.weeks[0] ?? []).map(({ date }) => {
    const day = new Date(`${date}T00:00`)
    return {
      date,
      long: day.toLocaleDateString('en-GB', { weekday: 'long' }),
      short: day.toLocaleDateString('en-GB', { weekday: props.compact ? 'narrow' : 'short' }),
    }
  }),
)
</script>

<template>
  <table class="calendar-grid" :class="{ compact }">
    <thead>
      <tr>
        <th v-for="weekday in weekdays" :key="weekday.date" scope="col">
          <abbr :title="weekday.long">{{ weekday.short }}</abbr>
        </th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="week in weeks" :key="week[0]!.date">
        <CalendarDay
          v-for="day in week"
          :key="day.date"
          :day="day"
          :items="itemsByDate.get(day.date) ?? []"
          :compact="compact"
          :today="today"
          :selected="day.date === selectedDate"
          @select="$emit('select', $event)"
        />
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
/* Seven equal columns however long the chips' names are */
.calendar-grid {
  width: 100%;
  margin-bottom: 1.5rem;
  table-layout: fixed;
  border-collapse: collapse;
}

th {
  padding: 0.35rem;
  border: none;
  background: none;
  font-size: 0.8rem;
  font-weight: normal;
  letter-spacing: 0.06em;
  text-align: left;
  text-transform: uppercase;
  color: var(--pico-muted-color);
}

.compact th {
  text-align: center;
}

abbr {
  border: none;
  text-decoration: none;
  cursor: default;
}
</style>
