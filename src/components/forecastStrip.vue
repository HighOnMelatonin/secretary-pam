<script setup lang="ts">
// The workload at a glance, above the upcoming tasks (see types/forecast.ts): the forecast's brief,
// then a strip of the next STRIP_DAYS days, each with the hours planned against the hours there are.
// A day is marked overbooked when more work is due by its end than there's time for from today.
import { computed } from 'vue'
import type { Forecast } from '@/types/forecast'
import { weekdayKeyOf } from '@/types/settings'

const props = defineProps<{
  forecast: Forecast
}>()

const STRIP_DAYS = 7
const hours = (value: number) => Math.round(value * 10) / 10

const days = computed(() =>
  props.forecast.days.slice(0, STRIP_DAYS).map((day) => {
    const weekday = weekdayKeyOf(day.date)
    return {
      ...day,
      label: weekday.charAt(0).toUpperCase() + weekday.slice(1),
      dayOfMonth: Number(day.date.slice(8)),
      // How full the day is, 0 to 100
      fill: day.capacityHours === 0 ? 0 : Math.round((day.plannedHours / day.capacityHours) * 100),
      description:
        day.capacityHours === 0
          ? `${day.date}: day off`
          : `${day.date}: ${hours(day.plannedHours)} of ${hours(day.capacityHours)} hours planned` +
            (day.overbooked ? ', overbooked' : ''),
    }
  }),
)
</script>

<template>
  <section class="workload" aria-labelledby="workload-heading">
    <h2 id="workload-heading" class="section-heading">Workload</h2>
    <p class="brief">{{ forecast.brief.text }}</p>
    <ol class="strip">
      <li
        v-for="day in days"
        :key="day.date"
        :class="{ off: day.capacityHours === 0, overbooked: day.overbooked }"
        :aria-label="day.description"
        :title="day.description"
      >
        <span class="day" aria-hidden="true">{{ day.label }} {{ day.dayOfMonth }}</span>
        <span class="bar" aria-hidden="true"><span class="planned" :style="{ width: `${day.fill}%` }" /></span>
        <small aria-hidden="true">
          <template v-if="day.capacityHours === 0">off</template>
          <template v-else>{{ hours(day.plannedHours) }}/{{ hours(day.capacityHours) }} h</template>
        </small>
        <small v-if="day.overbooked" class="over" aria-hidden="true">over</small>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.workload {
  margin-bottom: 1.5rem;
}

.brief {
  margin-bottom: 0.75rem;
}

/* Seven equal columns, which fit a phone's width */
.strip {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.strip li {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
  margin: 0;
  padding: 0.4rem 0.35rem;
  border: 1px solid var(--pam-green-line);
  border-radius: var(--pico-border-radius);
  list-style: none;
  text-align: center;
}

.day {
  font-size: 0.8rem;
  white-space: nowrap;
}

.strip small {
  color: var(--pico-muted-color);
  font-size: 0.75rem;
  white-space: nowrap;
}

.bar {
  height: 0.4rem;
  overflow: hidden;
  border-radius: 999px;
  background: var(--pam-green-line);
}

.planned {
  display: block;
  height: 100%;
  background: var(--pam-cream);
}

.off {
  opacity: 0.55;
}

/* Needs attention: a coral border, with "over" spelt out so colour isn't the only cue */
.overbooked {
  border-color: var(--pam-coral);
}

.strip .over {
  color: var(--pam-cream);
}
</style>
