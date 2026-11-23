<script setup lang="ts">
// Component to create or edit the details of a single task. A task can't be due after the
// delivery date of a project it's in: each clash offers to extend the project's deadline (saved
// with the task) or move the task's due date, and blocks saving until one is fixed. Saving is
// also blocked by a start date after the due date, an estimate that isn't a number of hours, and
// relations that would make a loop of blocking tasks. An estimate bigger than the working time
// left before the due date is pointed out, but doesn't block saving.
//
// A Task / Errand switch at the top makes it an errand (src/types/errand.ts): a personal to-do in
// no project. That hides the projects, related tasks, priority and start date, none of which an
// errand has, and shows its planned day, how it repeats and its checklist. An errand planned after
// its due date, or repeating on no days, can't be saved.
import { computed, ref, toRaw, watch } from 'vue'
import {
  formatRecurrence,
  isErrand,
  parseRecurrence,
  MAX_EVERY_DAYS,
  RECURRENCE_DAYS,
  RECURRENCE_DAY_LABELS,
  type RecurrenceDay,
} from '@/types/errand'
import {
  createEmptyTask,
  hoursFromMinutes,
  parseEstimateHours,
  PRIORITIES,
  RELATION_TYPES,
  relationLabel,
  type RelationType,
  type Task,
  type TaskKind,
} from '@/types/task'
import { isPastDeadline, type Project } from '@/types/project'
import { MAX_DESCRIPTION_LENGTH, MAX_EFFORT_MINUTES, MAX_NAME_LENGTH } from '@/types/limits'
import { describeLoop, findBlockCycle, startsAfterDue } from '@/types/rules'
import { capacityBetween, DEFAULT_SETTINGS, type UserSettings } from '@/types/settings'
import { localToday } from '@/types/calendar'
import { ARCHIVE_TAG_ID, type Tag } from '@/types/tag'
import NamePicker from './namePicker.vue'
import TagPicker from './tagPicker.vue'

const props = defineProps<{
  task?: Task // task to edit; a new empty task is used when omitted
  newTask?: Task // what a new task starts out as instead, such as an errand with a name
  // tasks that can be linked as relations; their relations, when given, are checked for blocking loops
  availableTasks?: (Pick<Task, 'id' | 'name'> & Partial<Pick<Task, 'completed' | 'relations'>>)[]
  projects?: Pick<Project, 'id' | 'name' | 'taskIds' | 'deliveryDate'>[] // projects the task can be assigned to
  projectIds?: string[] // projects to show as assigned; defaults to the projects whose taskIds include the task
  deadlines?: Record<string, string> // project deadlines to start out extended, by project id
  capacity?: UserSettings['capacityMinutes'] // minutes for tasks each weekday; the defaults when omitted
  today?: string // YYYY-MM-DD; this browser's today when omitted
  tags?: Tag[] // all tags, to choose the task's tags from
  createTag?: (name: string) => Promise<Tag> // saves a new tag from the [+] beside the tags
}>()

const emit = defineEmits<{
  // deadlines: new delivery dates for the projects whose deadlines were extended, by project id
  save: [task: Task, projectIds: string[], deadlines: Record<string, string>]
  cancel: []
  delete: [task: Task] // only offered for an existing task, after confirming
}>()

const copyOf = (task?: Task): Task =>
  task ? structuredClone(toRaw(task)) : props.newTask ? structuredClone(toRaw(props.newTask)) : createEmptyTask()

const assignedIdsOf = (task?: Task): string[] => {
  if (props.projectIds) return [...props.projectIds]
  if (!task) return []
  return (props.projects ?? []).filter((p) => p.taskIds.includes(task.id)).map((p) => p.id)
}

// Edits happen on a copy so the original is only changed when saved
const draft = ref<Task>(copyOf(props.task))
const projectIds = ref<string[]>(assignedIdsOf(props.task))
const deadlines = ref<Record<string, string>>({ ...props.deadlines })
// The estimate as typed, in hours, so a half-typed number isn't lost; saved into effortMinutes
const estimateOf = (task: Task) => (task.effortMinutes === undefined ? '' : String(hoursFromMinutes(task.effortMinutes)))
const estimate = ref(estimateOf(draft.value))

// How an errand repeats, as chosen in the form, and written into recurrence when it's saved
type Repeat = 'none' | 'daily' | 'weekly' | 'every'
const repeat = ref<Repeat>('none')
const weeklyDays = ref<RecurrenceDay[]>([])
const everyDays = ref('2')
function loadRepeat(task: Task) {
  const rule = task.recurrence === undefined ? null : parseRecurrence(task.recurrence)
  repeat.value = !rule ? 'none' : rule.every === 'day' ? 'daily' : rule.every === 'week' ? 'weekly' : 'every'
  weeklyDays.value = rule?.every === 'week' ? [...rule.days] : []
  everyDays.value = rule?.every === 'days' ? String(rule.days) : '2'
}
loadRepeat(draft.value)

watch(
  () => props.task,
  (task) => {
    draft.value = copyOf(task)
    projectIds.value = assignedIdsOf(task)
    deadlines.value = { ...props.deadlines }
    estimate.value = estimateOf(draft.value)
    loadRepeat(draft.value)
  },
)

const isNew = computed(() => !props.task)

// Task or errand
const errand = computed(() => isErrand(draft.value))
function setKind(kind: TaskKind) {
  if (kind === 'errand') draft.value.kind = 'errand'
  else delete draft.value.kind
}
const noun = computed(() => (errand.value ? 'errand' : 'task'))

// An errand's planned day (pinnedDate), which a blank input leaves to the save: today
function setPlannedDay(value: string) {
  if (value) draft.value.pinnedDate = value
  else delete draft.value.pinnedDate
}
const plannedAfterDue = computed(
  () => errand.value && !!draft.value.pinnedDate && draft.value.dueDate !== null && draft.value.pinnedDate > draft.value.dueDate,
)

// The recurrence the choices make: undefined for none, null when they don't make one yet (weekly
// with no days, or a number of days out of range)
const recurrence = computed<string | undefined | null>(() => {
  switch (repeat.value) {
    case 'none':
      return undefined
    case 'daily':
      return 'daily'
    case 'weekly':
      return weeklyDays.value.length ? formatRecurrence({ every: 'week', days: RECURRENCE_DAYS.filter((d) => weeklyDays.value.includes(d)) }) : null
    case 'every': {
      const days = Number(everyDays.value)
      return Number.isInteger(days) && days >= 1 && days <= MAX_EVERY_DAYS ? `every:${days}d` : null
    }
  }
})
const recurrenceInvalid = computed(() => errand.value && recurrence.value === null)

function toggleWeekday(day: RecurrenceDay) {
  weeklyDays.value = weeklyDays.value.includes(day) ? weeklyDays.value.filter((d) => d !== day) : [...weeklyDays.value, day]
}

// The checklist: items are edited in place, and a new one is added with Add or Enter
const newItem = ref('')
const checklist = computed(() => draft.value.checklist ?? [])
function addItem() {
  const text = newItem.value.trim()
  if (!text) return
  draft.value.checklist = [...checklist.value, { text, done: false }]
  newItem.value = ''
}
function removeItem(index: number) {
  draft.value.checklist = checklist.value.filter((_, i) => i !== index)
}

// Tags: the same ones as projects, except Archive, which only means something for a project
const taskTags = computed(() => (props.tags ?? []).filter((t) => t.id !== ARCHIVE_TAG_ID))
const tagIds = computed({
  get: () => draft.value.tagIds ?? [],
  set: (ids: string[]) => (draft.value.tagIds = ids),
})

// Project assignment
const newProjectId = ref('')

const assignedProjects = computed(() =>
  (props.projects ?? []).filter((p) => projectIds.value.includes(p.id)),
)
const assignableProjects = computed(() =>
  (props.projects ?? []).filter((p) => !projectIds.value.includes(p.id)),
)

// Relation input
const newRelationTaskId = ref('')
const newRelationType = ref<RelationType>('related_to')

// Deadlines: a project's delivery date, or the one it's being extended to
type AssignableProject = NonNullable<typeof props.projects>[number]
const deadlineOf = (project: AssignableProject) => deadlines.value[project.id] ?? project.deliveryDate
const isLateFor = (project: AssignableProject) => isPastDeadline(draft.value.dueDate, deadlineOf(project))

const selectedProject = computed(() => assignableProjects.value.find((p) => p.id === newProjectId.value))
// Assigned projects the task is due after block saving; the project picked to assign blocks Assign
const lateProjects = computed(() => assignedProjects.value.filter(isLateFor))
const selectionIsLate = computed(() => selectedProject.value !== undefined && isLateFor(selectedProject.value))
const clashes = computed(() =>
  selectionIsLate.value ? [...lateProjects.value, selectedProject.value!] : lateProjects.value,
)

// Scheduling: the estimate in minutes (undefined when blank, NaN when it isn't a valid number of
// hours), the start date, and how the estimate compares with the time left before the due date
const estimateMinutes = computed(() => parseEstimateHours(String(estimate.value ?? '')))
const estimateInvalid = computed(() => Number.isNaN(estimateMinutes.value))
const startIsLate = computed(() => startsAfterDue(draft.value))

const today = computed(() => props.today ?? localToday())
// Work counts from the start date, or from today if that's later
const workFrom = computed(() =>
  draft.value.startDate && draft.value.startDate > today.value ? draft.value.startDate : today.value,
)
const workFromText = computed(() => (workFrom.value === today.value ? 'from today' : `from ${workFrom.value}`))
// The working minutes left before the due date, when the estimate is more than that; else null
const shortOfTime = computed(() => {
  const minutes = estimateMinutes.value
  if (minutes === undefined || Number.isNaN(minutes) || draft.value.dueDate === null || startIsLate.value) return null
  const available = capacityBetween(props.capacity ?? DEFAULT_SETTINGS.capacityMinutes, workFrom.value, draft.value.dueDate)
  return minutes > available ? available : null
})

// The blocking loop the relations would make, counting a related task picked but not linked yet,
// since saving links it. Loops already in the other tasks' relations don't count.
const relationLoop = computed(() => {
  const pending = newRelationTaskId.value ? [{ taskId: newRelationTaskId.value, type: newRelationType.value }] : []
  const saved = { id: draft.value.id, relations: [...draft.value.relations, ...pending] }
  const before = (props.availableTasks ?? []).map((t) => ({ id: t.id, relations: t.relations ?? [] }))
  const after = [...before.filter((t) => t.id !== saved.id), saved]
  const loop = findBlockCycle(after, before)
  const nameOf = (id: string) => (id === draft.value.id ? draft.value.name.trim() || 'This task' : taskName(id))
  return loop ? describeLoop(loop, nameOf) : null
})

// The picked project counts too, since saving assigns it. An errand has no projects or relations,
// so only its own rules count.
const canSave = computed(() => {
  if (draft.value.name.trim() === '' || estimateInvalid.value) return false
  if (errand.value) return !plannedAfterDue.value && !recurrenceInvalid.value
  return clashes.value.length === 0 && !startIsLate.value && relationLoop.value === null
})

function extendDeadline(project: AssignableProject) {
  deadlines.value[project.id] = draft.value.dueDate!
}

function moveDueDate(project: AssignableProject) {
  draft.value.dueDate = deadlineOf(project)
}

function assignProject() {
  if (!newProjectId.value || selectionIsLate.value) return
  projectIds.value.push(newProjectId.value)
  newProjectId.value = ''
}

function unassignProject(id: string) {
  projectIds.value = projectIds.value.filter((projectId) => projectId !== id)
  delete deadlines.value[id]
}


// Completed tasks aren't offered, though relations already made to them stay listed
const relatableTasks = computed(() =>
  (props.availableTasks ?? []).filter(
    (t) => !t.completed && t.id !== draft.value.id && !draft.value.relations.some((r) => r.taskId === t.id),
  ),
)

function taskName(id: string) {
  return props.availableTasks?.find((t) => t.id === id)?.name ?? id
}

function addRelation() {
  if (!newRelationTaskId.value) return
  draft.value.relations.push({ taskId: newRelationTaskId.value, type: newRelationType.value })
  newRelationTaskId.value = ''
}

function removeRelation(index: number) {
  draft.value.relations.splice(index, 1)
}

// What an errand is saved as: in no project, with no relations, start date or priority of its own,
// and with its recurrence and the checklist's filled-in items; a project task has none of those
function asKind() {
  if (!errand.value) {
    delete draft.value.recurrence
    delete draft.value.checklist
    return
  }
  projectIds.value = []
  deadlines.value = {}
  draft.value.relations = []
  draft.value.priority = 'medium'
  delete draft.value.startDate
  if (recurrence.value) draft.value.recurrence = recurrence.value
  else delete draft.value.recurrence
  addItem() // an item typed but not added yet is kept, not lost
  const items = checklist.value.map((i) => ({ ...i, text: i.text.trim() })).filter((i) => i.text)
  if (items.length) draft.value.checklist = items
  else delete draft.value.checklist
}

function save() {
  if (!canSave.value) return
  // A project or related task picked but not yet added with Assign or Link is added now, not lost
  if (!errand.value) {
    assignProject()
    addRelation()
  }
  asKind()
  draft.value.name = draft.value.name.trim()
  if (estimateMinutes.value === undefined) delete draft.value.effortMinutes
  else draft.value.effortMinutes = estimateMinutes.value
  if (draft.value.tagIds?.length === 0) delete draft.value.tagIds
  // Only the projects the task ends up in are extended
  const extended = Object.fromEntries(Object.entries(deadlines.value).filter(([id]) => projectIds.value.includes(id)))
  emit('save', structuredClone(toRaw(draft.value)), [...projectIds.value], extended)
  if (isNew.value) {
    draft.value = createEmptyTask()
    projectIds.value = []
    deadlines.value = {}
    estimate.value = ''
    loadRepeat(draft.value)
  }
}

// A blank date input leaves the field out, as a task with no start date has none
function setStartDate(value: string) {
  if (value) draft.value.startDate = value
  else delete draft.value.startDate
}

function cancel() {
  draft.value = copyOf(props.task)
  projectIds.value = assignedIdsOf(props.task)
  deadlines.value = { ...props.deadlines }
  estimate.value = estimateOf(draft.value)
  loadRepeat(draft.value)
  emit('cancel')
}

// Deletes the saved task, not the draft, so unsaved edits don't matter
function confirmDelete() {
  const task = props.task
  if (!task) return
  // An imported task comes back on the next sync while its event is still in Google Calendar
  const comesBack = task.googleAccount
    ? ' It will be imported again on the next sync unless its event is deleted in Google Calendar.'
    : ''
  if (confirm(`Delete "${task.name}"?${comesBack}`)) emit('delete', task)
}
</script>

<template>
  <article class="task-container edit-form">
    <header class="heading-row form-header">
      <h2>{{ isNew ? `New ${noun}` : `Edit ${noun}` }}</h2>
      <button type="button" class="secondary outline compact" @click="cancel">Cancel</button>
    </header>

    <form @submit.prevent="save">
      <p v-if="draft.googleAccount" class="source">
        <small>
          Imported from Google Calendar ({{ draft.googleAccount }}). Its name, due date and description are set from
          the event again each time you sync, so change them in Google Calendar.
        </small>
      </p>

      <!-- Not role="group", which Pico stretches into a full-width bar of joined buttons -->
      <div class="kind-switch" aria-label="Kind">
        <button type="button" class="chip compact" :aria-pressed="!errand" @click="setKind('task')">Task</button>
        <button type="button" class="chip compact" :aria-pressed="errand" @click="setKind('errand')">Errand</button>
      </div>

      <label>
        {{ errand ? 'Errand' : 'Task name' }}
        <input v-model="draft.name" :placeholder="errand ? 'e.g. Groceries' : 'Task'" required :maxlength="MAX_NAME_LENGTH" />
      </label>

      <div v-if="errand" class="grid">
        <label>
          Planned day
          <input
            type="date"
            :value="draft.pinnedDate ?? ''"
            :aria-invalid="plannedAfterDue || undefined"
            @input="setPlannedDay(($event.target as HTMLInputElement).value)"
          />
          <small v-if="!draft.pinnedDate">Today, if left blank</small>
        </label>
        <span />
      </div>

      <div v-else class="grid">
        <label>
          Start date
          <input
            type="date"
            :value="draft.startDate ?? ''"
            :aria-invalid="startIsLate || undefined"
            @input="setStartDate(($event.target as HTMLInputElement).value)"
          />
        </label>

        <label>
          Priority
          <select v-model="draft.priority">
            <option v-for="p in PRIORITIES" :key="p" :value="p">{{ p }}</option>
          </select>
        </label>
      </div>

      <div class="grid">
        <label>
          Due date
          <input
            type="date"
            :value="draft.dueDate ?? ''"
            @input="draft.dueDate = ($event.target as HTMLInputElement).value || null"
          />
        </label>

        <label>
          Estimate (hours)
          <input
            v-model="estimate"
            type="text"
            inputmode="decimal"
            :placeholder="errand ? 'e.g. 0.5 (30 min if blank)' : 'e.g. 1.5'"
            :aria-invalid="estimateInvalid || undefined"
          />
        </label>
      </div>

      <p v-if="plannedAfterDue" class="error" role="alert">The planned day is after the due date. Move one of them.</p>
      <p v-if="startIsLate && !errand" class="error" role="alert">The start date is after the due date. Move one of them.</p>
      <p v-if="estimateInvalid" class="error" role="alert">
        Enter the estimate in hours: more than 0 and at most {{ MAX_EFFORT_MINUTES / 60 }}.
      </p>
      <p v-if="shortOfTime === 0" class="capacity-warning" role="status">
        <small>
          There's no working time left {{ workFromText }} to the due date, so this estimate won't fit. You can still
          save it.
        </small>
      </p>
      <p v-else-if="shortOfTime !== null" class="capacity-warning" role="status">
        <small>
          Only {{ hoursFromMinutes(shortOfTime) }} h of working time {{ workFromText }} to the due date, less than this
          estimate. You can still save it.
        </small>
      </p>

      <label>
        Description
        <textarea
          v-model="draft.description"
          rows="4"
          placeholder="What needs to be delivered?"
          :maxlength="MAX_DESCRIPTION_LENGTH"
        />
      </label>

      <TagPicker v-model="tagIds" :tags="taskTags" :create-tag="createTag" />

      <template v-if="errand">
        <fieldset>
          <legend>Repeats</legend>
          <select v-model="repeat" aria-label="How it repeats">
            <option value="none">Doesn't repeat</option>
            <option value="daily">Every day</option>
            <option value="weekly">Every week, on…</option>
            <option value="every">Every few days</option>
          </select>
          <div v-if="repeat === 'weekly'" class="weekdays">
            <button
              v-for="day in RECURRENCE_DAYS"
              :key="day"
              type="button"
              class="chip compact"
              :aria-pressed="weeklyDays.includes(day)"
              @click="toggleWeekday(day)"
            >
              {{ RECURRENCE_DAY_LABELS[day] }}
            </button>
          </div>
          <label v-if="repeat === 'every'" class="every">
            Every
            <input v-model="everyDays" type="number" min="1" :max="MAX_EVERY_DAYS" inputmode="numeric" />
            days
          </label>
          <p v-if="recurrenceInvalid" class="error" role="alert">
            {{ repeat === 'weekly' ? 'Pick at least one day.' : `Enter a whole number of days from 1 to ${MAX_EVERY_DAYS}.` }}
          </p>
          <small v-if="repeat !== 'none'">Completing it adds the next one, on the next day it repeats.</small>
        </fieldset>

        <fieldset>
          <legend>Checklist</legend>
          <ul v-if="checklist.length">
            <li v-for="(item, i) in checklist" :key="i" class="checklist-item">
              <input v-model="item.done" type="checkbox" :aria-label="`Done: ${item.text}`" />
              <input v-model="item.text" :maxlength="MAX_NAME_LENGTH" aria-label="Checklist item" />
              <button type="button" class="secondary outline" @click="removeItem(i)">Remove</button>
            </li>
          </ul>
          <div role="group" class="picker-row">
            <input
              v-model="newItem"
              :maxlength="MAX_NAME_LENGTH"
              placeholder="Add an item…"
              aria-label="New checklist item"
              @keydown.enter.prevent="addItem"
            />
            <button type="button" :disabled="!newItem.trim()" @click="addItem">Add</button>
          </div>
        </fieldset>
      </template>

      <fieldset v-if="!errand">
        <legend>Projects</legend>
        <ul v-if="assignedProjects.length">
          <li v-for="project in assignedProjects" :key="project.id">
            <span>
              {{ project.name }}
              <small v-if="deadlines[project.id]" class="pending">deadline extends to {{ deadlines[project.id] }}</small>
            </span>
            <button type="button" class="secondary outline" @click="unassignProject(project.id)">Remove</button>
          </li>
        </ul>
        <p v-else><small>Not in any project.</small></p>

        <div v-if="assignableProjects.length" role="group" class="picker-row">
          <NamePicker
            v-model="newProjectId"
            :options="assignableProjects"
            placeholder="Add to project…"
            label="Project to add the task to"
            @confirm="assignProject"
          />
          <button type="button" :disabled="!newProjectId || selectionIsLate" @click="assignProject">Assign</button>
        </div>

        <div v-for="project in clashes" :key="project.id" class="date-error" role="alert">
          <p>
            This task is due {{ draft.dueDate }}, after {{ project.name }}'s deadline ({{ deadlineOf(project) }}).
            Extend the project's deadline or move the task's due date.
          </p>
          <div class="date-fixes">
            <button type="button" class="secondary compact" @click="extendDeadline(project)">
              Extend {{ project.name }} to {{ draft.dueDate }}
            </button>
            <button type="button" class="secondary outline compact" @click="moveDueDate(project)">
              Move task to {{ deadlineOf(project) }}
            </button>
          </div>
        </div>
      </fieldset>

      <fieldset v-if="!errand">
        <legend>Related tasks</legend>
        <ul v-if="draft.relations.length">
          <li v-for="(relation, i) in draft.relations" :key="relation.taskId">
            <span>{{ relationLabel(relation.type) }}: {{ taskName(relation.taskId) }}</span>
            <button type="button" class="secondary outline" @click="removeRelation(i)">Remove</button>
          </li>
        </ul>
        <p v-else><small>No related tasks.</small></p>

        <div v-if="relatableTasks.length" role="group" class="picker-row">
          <select v-model="newRelationType">
            <option v-for="t in RELATION_TYPES" :key="t" :value="t">{{ relationLabel(t) }}</option>
          </select>
          <NamePicker
            v-model="newRelationTaskId"
            :options="relatableTasks"
            placeholder="Find a task…"
            label="Task to relate"
            @confirm="addRelation"
          />
          <button type="button" :disabled="!newRelationTaskId" @click="addRelation">Link</button>
        </div>

        <div v-if="relationLoop" class="date-error" role="alert">
          <p>This would make a loop of blocking tasks: {{ relationLoop }}. Remove one of these relations.</p>
        </div>
      </fieldset>

      <label class="completed-toggle">
        <input v-model="draft.completed" type="checkbox" />
        <span>Completed</span>
      </label>

      <div class="actions">
        <button type="submit" :disabled="!canSave">{{ isNew ? 'Add' : 'Save' }}</button>
        <button type="button" class="secondary" @click="cancel">Cancel</button>
        <button v-if="!isNew" type="button" class="secondary outline delete-task" @click="confirmDelete">
          Delete
        </button>
      </div>
    </form>
  </article>
</template>

<style scoped>
/* Task and Errand, and an errand's weekdays: chips, the chosen ones filled cream, as the Upcoming
   panel's view switch */
.kind-switch,
.weekdays {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 1rem;
}

.weekdays {
  margin-top: 0.5rem;
}

.kind-switch .chip[aria-pressed='true'],
.weekdays .chip[aria-pressed='true'] {
  border-color: var(--pam-cream);
  background: var(--pam-cream);
  color: var(--pam-green);
}

.every {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.every input {
  width: 5rem;
  margin: 0;
}

/* Its tick, its text, then Remove, on one line */
.checklist-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.checklist-item input[type='checkbox'] {
  flex: none;
  width: 1.25rem;
  height: 1.25rem;
  margin: 0;
  accent-color: var(--primary);
}

.checklist-item input:not([type='checkbox']) {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
}

.checklist-item button {
  flex: none;
  width: auto;
  margin: 0;
}

/* Needs attention but doesn't block saving: a coral edge, as coral is for borders on cards */
.capacity-warning {
  padding-left: 0.75rem;
  border-left: 3px solid var(--pam-coral);
}

/* Assigning a project and relating a task: the relation type and the button take only the width
   they need, leaving the rest for the name being searched. Phones keep main.css's wrapped rows,
   where the name already has a line of its own. */
@media (min-width: 576px) {
  .picker-row > select,
  .picker-row > button {
    flex: none;
    width: auto;
  }

  .picker-row > .name-picker {
    flex: 1 1 auto;
    min-width: 0;
  }
}

/* Away from Save and Cancel, so it isn't pressed by mistake */
.actions .delete-task {
  margin-left: auto;
  border-color: var(--pam-coral);
  color: var(--pam-coral);
}

.completed-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.completed-toggle input[type='checkbox'] {
  width: 1.5rem;
  height: 1.5rem;
  margin: 0;
  accent-color: var(--primary);
}
</style>
