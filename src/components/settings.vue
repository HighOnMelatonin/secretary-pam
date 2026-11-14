<script setup lang="ts">
// The settings page (/settings): how many hours each weekday has for tasks, the buffer every
// estimate is multiplied by, and the preset that weighs urgency, importance and unblocking (see
// types/settings.ts and docs/priority-algorithm.md). Nothing is saved until Apply: until then a
// preview shows the Suggested list as the new settings would order it, with the rows that move
// marked, next to the order now, and the projects whose forecast pace or finish would change.
// Cancel discards the changes. Below it, the Telegram bot's section (telegramSettings.vue), which
// saves on its own.
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useProjectList } from '@/stores/projectList'
import { useSettings } from '@/stores/settings'
import { useTaskList } from '@/stores/taskList'
import { localToday } from '@/types/calendar'
import { MAX_BUFFER, MAX_DAY_CAPACITY_MINUTES, MIN_BUFFER } from '@/types/limits'
import { CATEGORY_LABELS } from '@/types/priority'
import { describePace, previewSettings, type PaceSummary } from '@/types/settingsPreview'
import { PRESET_NAMES, PRESETS, WEEKDAYS, type PresetName, type UserSettings, type WeekdayKey } from '@/types/settings'
import { hoursFromMinutes } from '@/types/task'
import TelegramSettings from './telegramSettings.vue'

const props = defineProps<{
  today?: string // YYYY-MM-DD; this browser's today when omitted
}>()

const emit = defineEmits<{
  close: []
}>()

const store = useSettings()
const { settings: saved, loaded, error: loadError } = storeToRefs(store)
const { tasks } = storeToRefs(useTaskList())
const { projects } = storeToRefs(useProjectList())
const today = computed(() => props.today ?? localToday())

const DAY_LABELS: Record<WeekdayKey, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
}

const PRESET_DESCRIPTIONS: Record<PresetName, string> = {
  balanced: 'Deadlines, importance and unblocking other tasks all count.',
  deadline: 'What is due soonest rises; looks 3 working days ahead.',
  importance: 'High-priority projects and tasks rise; deadlines count for less.',
  blockers: 'Tasks that hold others up rise, so the work behind them can start.',
}

// What's typed, kept as text so a half-typed number isn't lost; capacity in hours
const hours = ref<Record<WeekdayKey, string>>({} as Record<WeekdayKey, string>)
const buffer = ref('')
const preset = ref<PresetName>('balanced')

function reset() {
  hours.value = Object.fromEntries(
    WEEKDAYS.map((day) => [day, String(hoursFromMinutes(saved.value.capacityMinutes[day]))]),
  ) as Record<WeekdayKey, string>
  buffer.value = String(saved.value.buffer)
  preset.value = saved.value.preset
}
reset()
// Settings that arrive after the page opens replace the stand-ins, unless something was changed
watch(loaded, () => {
  if (!changed.value) reset()
})

const number = (text: string) => (text.trim() === '' ? NaN : Number(text.trim().replace(',', '.')))
const dayMinutes = (day: WeekdayKey) => Math.round(number(hours.value[day]) * 60)
const dayInvalid = (day: WeekdayKey) => {
  const minutes = dayMinutes(day)
  return !Number.isFinite(minutes) || minutes < 0 || minutes > MAX_DAY_CAPACITY_MINUTES
}
const noTime = computed(() => WEEKDAYS.every((day) => dayInvalid(day) || dayMinutes(day) === 0))
const bufferInvalid = computed(() => {
  const value = number(buffer.value)
  return !Number.isFinite(value) || value < MIN_BUFFER || value > MAX_BUFFER
})
const invalid = computed(() => WEEKDAYS.some(dayInvalid) || noTime.value || bufferInvalid.value)

// The settings as they would be saved; null while something typed isn't valid
const draft = computed<UserSettings | null>(() => {
  if (invalid.value) return null
  const { wU, k, horizonDays } = PRESETS[preset.value]
  return {
    capacityMinutes: Object.fromEntries(WEEKDAYS.map((day) => [day, dayMinutes(day)])) as UserSettings['capacityMinutes'],
    buffer: number(buffer.value),
    wU,
    k,
    horizonDays,
    preset: preset.value,
  }
})
const changed = computed(() => draft.value === null || JSON.stringify(draft.value) !== JSON.stringify(saved.value))

// What applying would change, worked out by the same function as POST /api/settings/preview
const preview = computed(() =>
  draft.value ? previewSettings(tasks.value, projects.value, saved.value, draft.value, today.value) : null,
)

// e.g. "Tight, finishing 2026-11-17"
const paceText = (summary: PaceSummary) => {
  const text = describePace(summary)
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const saving = ref(false)
const saveError = ref<string | null>(null)

async function apply() {
  if (!draft.value || !loaded.value) return
  saving.value = true
  saveError.value = null
  try {
    await store.save(draft.value)
    emit('close')
  } catch (e) {
    saveError.value = `Couldn't save your settings: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    saving.value = false
  }
}

async function retry() {
  try {
    await store.load()
  } catch {
    // The store keeps the error, which the page shows
  }
}
</script>

<template>
  <div class="settings-page">
    <article class="settings edit-form">
      <form @submit.prevent="apply">
        <h2>Settings</h2>

        <div v-if="loadError" class="error" role="alert">
          <p>Couldn't load your settings: {{ loadError }}</p>
          <button type="button" class="secondary compact" @click="retry">Try again</button>
        </div>
        <p v-else-if="!loaded" aria-busy="true">Loading your settings…</p>
        <p v-if="saveError" class="error" role="alert">{{ saveError }}</p>

        <fieldset>
          <legend>Hours for tasks each day</legend>
          <p class="hint"><small>Suggested and the warnings in the task form plan work into these hours. 0 means a day off.</small></p>
          <div class="days">
            <label v-for="day in WEEKDAYS" :key="day">
              {{ DAY_LABELS[day] }}
              <input v-model="hours[day]" type="text" inputmode="decimal" :aria-invalid="dayInvalid(day) || undefined" />
            </label>
          </div>
          <p v-if="WEEKDAYS.some(dayInvalid)" class="error" role="alert">
            Each day needs a number of hours from 0 to {{ MAX_DAY_CAPACITY_MINUTES / 60 }}.
          </p>
          <p v-else-if="noTime" class="error" role="alert">At least one day needs some hours.</p>
        </fieldset>

        <label>
          Buffer
          <input v-model="buffer" type="text" inputmode="decimal" :aria-invalid="bufferInvalid || undefined" />
          <small>Every estimate is multiplied by this: 1.25 allows a quarter more time than estimated.</small>
        </label>
        <p v-if="bufferInvalid" class="error" role="alert">The buffer must be from {{ MIN_BUFFER }} to {{ MAX_BUFFER }}.</p>

        <fieldset>
          <legend>How Suggested weighs tasks</legend>
          <label v-for="name in PRESET_NAMES" :key="name" class="preset">
            <input v-model="preset" type="radio" name="preset" :value="name" />
            <span>
              {{ PRESETS[name].label }}
              <small>{{ PRESET_DESCRIPTIONS[name] }}</small>
            </span>
          </label>
        </fieldset>

        <section v-if="changed && preview" class="preview" aria-labelledby="preview-heading">
          <h3 id="preview-heading" class="section-heading">Preview</h3>
          <p v-if="preview.rows.length === 0"><small>There are no tasks to suggest yet.</small></p>
          <p v-else-if="preview.moved === 0"><small>The Suggested list stays in the same order.</small></p>
          <p v-else><small>{{ preview.moved }} of {{ preview.rows.length }} tasks move in Suggested:</small></p>
          <ol v-if="preview.rows.length" class="preview-list">
            <li v-for="row in preview.rows" :key="row.taskId" :class="{ moved: row.move }">
              <span class="row">
                <span>{{ row.name }}</span>
                <small class="category">{{ CATEGORY_LABELS[row.category] }}</small>
                <span v-if="row.move" class="tag">{{ row.move.text }}</span>
              </span>
            </li>
          </ol>

          <h3 class="section-heading">Forecast</h3>
          <p v-if="preview.projects.length === 0 && !preview.allDone"><small>No project's pace or finish changes.</small></p>
          <ul v-else class="plain-list forecast-changes">
            <li v-for="change in preview.projects" :key="change.projectId">
              <strong>{{ change.name }}</strong>: {{ paceText(change.before) }} →
              <span class="will">{{ paceText(change.after) }}</span>
            </li>
            <li v-if="preview.allDone">
              <strong>Everything</strong>: done by {{ preview.allDone.before ?? 'no date' }} →
              <span class="will">done by {{ preview.allDone.after ?? 'no date' }}</span>
            </li>
          </ul>
        </section>

        <div class="actions">
          <button type="submit" :disabled="!loaded || !changed || !draft || saving">Apply</button>
          <button type="button" class="secondary" @click="emit('close')">Cancel</button>
        </div>
      </form>
    </article>
    <TelegramSettings />
  </div>
</template>

<style scoped>
.hint small,
label small,
.preset small,
.category,
.preview p small {
  color: var(--pico-muted-color);
}

/* A field per weekday: seven across on wide screens, fewer on narrow ones */
.days {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
  gap: 0 0.75rem;
}

.preset {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.preset span {
  display: flex;
  flex-direction: column;
}

/* Long lists scroll inside the preview rather than pushing Apply far down */
.preview-list {
  max-height: 22rem;
  overflow-y: auto;
  margin: 0 0 1rem;
  padding-left: 1.75rem;
}

.preview-list li {
  margin-bottom: 0.35rem;
}

.preview-list .row {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.5rem;
}

.preview-list li:not(.moved) {
  color: var(--pico-muted-color);
}

/* Sentences that wrap as text, not the form's rows of an item and its Remove button */
.forecast-changes li {
  display: block;
}

/* What a project's forecast would become: underlined in coral, as something to look at */
.forecast-changes .will {
  border-bottom: 1px solid var(--pam-coral);
}

/* A moved row's tag has a coral edge, as something to look at */
.preview-list .tag {
  border-color: var(--pam-coral);
}
</style>
