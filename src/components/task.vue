<script setup lang="ts">
// Component to create or edit the details of a single task. A task can't be due after the
// delivery date of a project it's in: each clash offers to extend the project's deadline (saved
// with the task) or move the task's due date, and blocks saving until one is fixed. Saving is
// also blocked by a start date after the due date, an estimate that isn't a number of hours, and
// relations that would make a loop of blocking tasks. An estimate bigger than the working time
// left before the due date is pointed out, but doesn't block saving.
import { computed, ref, toRaw, watch } from 'vue'
import {
  createEmptyTask,
  hoursFromMinutes,
  parseEstimateHours,
  PRIORITIES,
  RELATION_TYPES,
  relationLabel,
  type RelationType,
  type Task,
} from '@/types/task'
import { isPastDeadline, type Project } from '@/types/project'
import { MAX_DESCRIPTION_LENGTH, MAX_EFFORT_MINUTES, MAX_NAME_LENGTH } from '@/types/limits'
import { describeLoop, findBlockCycle, startsAfterDue } from '@/types/rules'
import { capacityBetween, DEFAULT_SETTINGS, type UserSettings } from '@/types/settings'
import { localToday } from '@/types/calendar'

const props = defineProps<{
  task?: Task // task to edit; a new empty task is used when omitted
  // tasks that can be linked as relations; their relations, when given, are checked for blocking loops
  availableTasks?: (Pick<Task, 'id' | 'name'> & Partial<Pick<Task, 'completed' | 'relations'>>)[]
  projects?: Pick<Project, 'id' | 'name' | 'taskIds' | 'deliveryDate'>[] // projects the task can be assigned to
  projectIds?: string[] // projects to show as assigned; defaults to the projects whose taskIds include the task
  deadlines?: Record<string, string> // project deadlines to start out extended, by project id
  capacity?: UserSettings['capacityMinutes'] // minutes for tasks each weekday; the defaults when omitted
  today?: string // YYYY-MM-DD; this browser's today when omitted
}>()

const emit = defineEmits<{
  // deadlines: new delivery dates for the projects whose deadlines were extended, by project id
  save: [task: Task, projectIds: string[], deadlines: Record<string, string>]
  cancel: []
}>()

const copyOf = (task?: Task): Task => (task ? structuredClone(toRaw(task)) : createEmptyTask())

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
watch(
  () => props.task,
  (task) => {
    draft.value = copyOf(task)
    projectIds.value = assignedIdsOf(task)
    deadlines.value = { ...props.deadlines }
    estimate.value = estimateOf(draft.value)
  },
)

const isNew = computed(() => !props.task)

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

// The picked project counts too, since saving assigns it
const canSave = computed(
  () =>
    draft.value.name.trim() !== '' &&
    clashes.value.length === 0 &&
    !estimateInvalid.value &&
    !startIsLate.value &&
    relationLoop.value === null,
)

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

function save() {
  if (!canSave.value) return
  // A project or related task picked but not yet added with Assign or Link is added now, not lost
  assignProject()
  addRelation()
  draft.value.name = draft.value.name.trim()
  if (estimateMinutes.value === undefined) delete draft.value.effortMinutes
  else draft.value.effortMinutes = estimateMinutes.value
  // Only the projects the task ends up in are extended
  const extended = Object.fromEntries(Object.entries(deadlines.value).filter(([id]) => projectIds.value.includes(id)))
  emit('save', structuredClone(toRaw(draft.value)), [...projectIds.value], extended)
  if (isNew.value) {
    draft.value = createEmptyTask()
    projectIds.value = []
    deadlines.value = {}
    estimate.value = ''
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
  emit('cancel')
}
</script>

<template>
  <article class="task-container edit-form">
    <form @submit.prevent="save">
      <p v-if="draft.googleAccount" class="source">
        <small>
          Imported from Google Calendar ({{ draft.googleAccount }}). Its name, due date and description are set from
          the event again each time you sync, so change them in Google Calendar.
        </small>
      </p>

      <label>
        Task name
        <input v-model="draft.name" placeholder="Task" required :maxlength="MAX_NAME_LENGTH" />
      </label>

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
          Priority
          <select v-model="draft.priority">
            <option v-for="p in PRIORITIES" :key="p" :value="p">{{ p }}</option>
          </select>
        </label>
      </div>

      <div class="grid">
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
          Estimate (hours)
          <input
            v-model="estimate"
            type="text"
            inputmode="decimal"
            placeholder="e.g. 1.5"
            :aria-invalid="estimateInvalid || undefined"
          />
        </label>
      </div>

      <p v-if="startIsLate" class="error" role="alert">The start date is after the due date. Move one of them.</p>
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

      <fieldset>
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

        <div v-if="assignableProjects.length" role="group">
          <select v-model="newProjectId">
            <option value="">Add to project…</option>
            <option v-for="p in assignableProjects" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
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

      <fieldset>
        <legend>Related tasks</legend>
        <ul v-if="draft.relations.length">
          <li v-for="(relation, i) in draft.relations" :key="relation.taskId">
            <span>{{ relationLabel(relation.type) }}: {{ taskName(relation.taskId) }}</span>
            <button type="button" class="secondary outline" @click="removeRelation(i)">Remove</button>
          </li>
        </ul>
        <p v-else><small>No related tasks.</small></p>

        <div v-if="relatableTasks.length" role="group">
          <select v-model="newRelationType">
            <option v-for="t in RELATION_TYPES" :key="t" :value="t">{{ relationLabel(t) }}</option>
          </select>
          <select v-model="newRelationTaskId">
            <option value="" disabled>Select task</option>
            <option v-for="t in relatableTasks" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
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
      </div>
    </form>
  </article>
</template>

<style scoped>
/* Needs attention but doesn't block saving: a coral edge, as coral is for borders on cards */
.capacity-warning {
  padding-left: 0.75rem;
  border-left: 3px solid var(--pam-coral);
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
