<script setup lang="ts">
// The Suggested view of the Upcoming panel: the open tasks as prioritise() ranks them (see
// types/priority.ts), under Overdue, Do nowww and Do next. Each row says why it's there, marks
// pinned, unestimated and looped tasks, and has quick actions: Do today (or Unpin), Not today,
// priority up and down, and the estimate, edited in place. The actions are emitted for the
// dashboard to send as quick actions (POST /api/tasks/:id/action), never as whole task saves.
import { computed, nextTick, ref } from 'vue'
import TaskRow from './taskRow.vue'
import { MAX_EFFORT_MINUTES } from '@/types/limits'
import type { TaskAction } from '@/types/operations'
import { CATEGORY_LABELS, CATEGORIES, formatHours, type Priorities, type ScoredTask } from '@/types/priority'
import { isArchived, type Project } from '@/types/project'
import { NOT_TODAY_REFUSALS, notTodayRefusal } from '@/types/rules'
import { hoursFromMinutes, parseEstimateHours, stepPriority, type Task } from '@/types/task'

const props = defineProps<{
  priorities: Priorities
  tasks: Task[]
  projects: Project[]
  today: string
  limit: number | null // a collapsed panel shows only this many rows; null shows them all
}>()

const emit = defineEmits<{
  editTask: [task: Task]
  toggleTask: [task: Task]
  action: [task: Task, action: TaskAction]
}>()

// Do next can be long, so it starts with its first DO_NEXT_COUNT tasks
const DO_NEXT_COUNT = 10
const showAllNext = ref(false)

const tasksById = computed(() => new Map(props.tasks.map((t) => [t.id, t])))
const scoredById = computed(() => new Map(props.priorities.tasks.map((t) => [t.taskId, t])))

interface Row {
  task: Task
  scored: ScoredTask
}

// Each category with its rows, cut to the collapsed panel's limit, then Do next's first rows
const sections = computed(() => {
  let room = props.limit ?? Infinity
  return CATEGORIES.map((category) => {
    const ids = props.priorities.sections[category]
    const rows: Row[] = ids.map((id) => ({ task: tasksById.value.get(id)!, scored: scoredById.value.get(id)! }))
    const shown = rows.slice(0, Math.min(room, category === 'do_next' && !showAllNext.value ? DO_NEXT_COUNT : Infinity))
    room -= shown.length
    return { category, label: CATEGORY_LABELS[category], rows: shown, more: rows.length - shown.length }
  }).filter((s) => s.rows.length > 0)
})
const visibleCount = computed(() => CATEGORIES.reduce((sum, c) => sum + props.priorities.sections[c].length, 0))


const projectNames = (task: Task) =>
  props.projects.filter((p) => !isArchived(p) && p.taskIds.includes(task.id)).map((p) => p.name)

const notTodayNote = (task: Task) => {
  const refusal = notTodayRefusal(task, props.today)
  return refusal ? NOT_TODAY_REFUSALS[refusal] : null
}

// The estimate being edited in place: whose, and what's typed so far
const editingId = ref<string | null>(null)
const estimateText = ref('')
const estimateMinutes = computed(() => parseEstimateHours(estimateText.value))
const estimateInvalid = computed(() => Number.isNaN(estimateMinutes.value))

async function editEstimate(task: Task) {
  editingId.value = task.id
  estimateText.value = task.effortMinutes === undefined ? '' : String(hoursFromMinutes(task.effortMinutes))
  await nextTick()
  document.getElementById(`estimate-${task.id}`)?.focus()
}

function saveEstimate(task: Task) {
  if (estimateInvalid.value) return
  emit('action', task, { action: 'estimate', effortMinutes: estimateMinutes.value ?? null })
  editingId.value = null
}

const estimateLabel = (task: Task) =>
  task.effortMinutes === undefined ? 'Add estimate' : `Estimate: ${formatHours(task.effortMinutes / 60)}`
</script>

<template>
  <div class="suggested">
    <div v-for="section in sections" :key="section.category" class="group">
      <h3 class="section-heading">{{ section.label }}</h3>
      <ul class="plain-list">
        <TaskRow
          v-for="{ task, scored } in section.rows"
          :key="task.id"
          :task="task"
          :project-names="projectNames(task)"
          @edit="$emit('editTask', task)"
          @toggle-completed="$emit('toggleTask', task)"
        >
          <span class="reason">
            <small>{{ scored.reason.text }}</small>
            <span v-if="scored.flags.pinned" class="tag">pinned</span>
            <span v-if="scored.flags.unestimated" class="tag" title="Counted as 2 hours until it has an estimate">no estimate</span>
            <span v-if="scored.flags.inLoop" class="tag loop" title="Part of a loop of blocking tasks; fix its relations">in a loop</span>
          </span>

          <form
            v-if="editingId === task.id"
            class="estimate-edit"
            @submit.prevent="saveEstimate(task)"
            @keydown.esc="editingId = null"
          >
            <label :for="`estimate-${task.id}`" class="sr-only">Estimate in hours for {{ task.name }}</label>
            <input
              :id="`estimate-${task.id}`"
              v-model="estimateText"
              type="text"
              inputmode="decimal"
              placeholder="Hours, e.g. 1.5"
              :aria-invalid="estimateInvalid || undefined"
            />
            <button type="submit" class="small" :disabled="estimateInvalid">Save</button>
            <button type="button" class="secondary outline small" @click="editingId = null">Cancel</button>
            <small v-if="estimateInvalid" class="action-note" role="alert">
              Enter hours: more than 0 and at most {{ MAX_EFFORT_MINUTES / 60 }}. Leave it blank for no estimate.
            </small>
          </form>

          <span v-else class="quick-actions">
            <button
              v-if="scored.flags.pinned"
              type="button"
              class="secondary outline small"
              @click="$emit('action', task, { action: 'unpin' })"
            >
              Unpin
            </button>
            <button
              v-else
              type="button"
              class="secondary outline small"
              @click="$emit('action', task, { action: 'do_today', today })"
            >
              Do today
            </button>
            <button
              type="button"
              class="secondary outline small"
              :disabled="notTodayNote(task) !== null"
              :aria-describedby="notTodayNote(task) ? `not-today-${task.id}` : undefined"
              @click="$emit('action', task, { action: 'not_today', today })"
            >
              Not today
            </button>
            <small v-if="notTodayNote(task)" :id="`not-today-${task.id}`" class="action-note">{{ notTodayNote(task) }}</small>
            <button
              type="button"
              class="secondary outline small"
              :disabled="stepPriority(task.priority, 'up') === null"
              :aria-label="`Raise the priority of ${task.name}`"
              @click="$emit('action', task, { action: 'importance', direction: 'up' })"
            >
              Priority ↑
            </button>
            <button
              type="button"
              class="secondary outline small"
              :disabled="stepPriority(task.priority, 'down') === null"
              :aria-label="`Lower the priority of ${task.name}`"
              @click="$emit('action', task, { action: 'importance', direction: 'down' })"
            >
              Priority ↓
            </button>
            <button type="button" class="secondary outline small" @click="editEstimate(task)">{{ estimateLabel(task) }}</button>
          </span>
        </TaskRow>
      </ul>
      <button
        v-if="section.category === 'do_next' && section.more > 0 && limit === null"
        type="button"
        class="secondary outline compact"
        @click="showAllNext = true"
      >
        Show {{ section.more }} more
      </button>
    </div>

    <p v-if="visibleCount === 0" class="note"><small>Nothing to do right now.</small></p>
    <p v-if="priorities.hiddenSummary" class="note"><small>{{ priorities.hiddenSummary.text }}</small></p>
  </div>
</template>

<style scoped>
.group + .group {
  margin-top: 1.25rem;
}

.reason {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.5rem;
}

.reason small,
.action-note,
.note small {
  color: var(--pico-muted-color);
}

/* Needs attention: a coral outline, as on the urgent badge */
.tag.loop {
  border-color: var(--pam-coral);
}

/* The quick actions wrap onto more lines on narrow screens rather than overflowing */
.quick-actions,
.estimate-edit {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin: 0.15rem 0 0.25rem;
}

.estimate-edit input {
  width: 9rem;
  margin: 0;
  padding: 0.2rem 0.5rem;
  height: auto;
}

.note {
  margin: 0.75rem 0 0;
}
</style>
