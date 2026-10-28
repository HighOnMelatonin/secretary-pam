<script setup lang="ts">
// Component to create or edit the details of a single task. A task can't be due after the
// delivery date of a project it's in: each clash offers to extend the project's deadline (saved
// with the task) or move the task's due date, and blocks saving until one is fixed.
import { computed, ref, toRaw, watch } from 'vue'
import {
  createEmptyTask,
  PRIORITIES,
  RELATION_TYPES,
  relationLabel,
  type RelationType,
  type Task,
} from '@/types/task'
import { isPastDeadline, type Project } from '@/types/project'
import { MAX_DESCRIPTION_LENGTH, MAX_NAME_LENGTH } from '@/types/limits'

const props = defineProps<{
  task?: Task // task to edit; a new empty task is used when omitted
  availableTasks?: Pick<Task, 'id' | 'name'>[] // tasks that can be linked as relations
  projects?: Pick<Project, 'id' | 'name' | 'taskIds' | 'deliveryDate'>[] // projects the task can be assigned to
  projectIds?: string[] // projects to show as assigned; defaults to the projects whose taskIds include the task
  deadlines?: Record<string, string> // project deadlines to start out extended, by project id
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
watch(
  () => props.task,
  (task) => {
    draft.value = copyOf(task)
    projectIds.value = assignedIdsOf(task)
    deadlines.value = { ...props.deadlines }
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

const canSave = computed(() => draft.value.name.trim() !== '' && lateProjects.value.length === 0)

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

// Relation input
const newRelationTaskId = ref('')
const newRelationType = ref<RelationType>('related_to')

const relatableTasks = computed(() =>
  (props.availableTasks ?? []).filter(
    (t) => t.id !== draft.value.id && !draft.value.relations.some((r) => r.taskId === t.id),
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
  draft.value.name = draft.value.name.trim()
  // Only the projects the task ends up in are extended
  const extended = Object.fromEntries(Object.entries(deadlines.value).filter(([id]) => projectIds.value.includes(id)))
  emit('save', structuredClone(toRaw(draft.value)), [...projectIds.value], extended)
  if (isNew.value) {
    draft.value = createEmptyTask()
    projectIds.value = []
    deadlines.value = {}
  }
}

function cancel() {
  draft.value = copyOf(props.task)
  projectIds.value = assignedIdsOf(props.task)
  deadlines.value = { ...props.deadlines }
  emit('cancel')
}
</script>

<template>
  <article class="task-container">
    <form @submit.prevent="save">
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
            <option value="" disabled>Select project</option>
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
            <button type="button" class="secondary" @click="extendDeadline(project)">
              Extend {{ project.name }} to {{ draft.dueDate }}
            </button>
            <button type="button" class="secondary outline" @click="moveDueDate(project)">
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
      </fieldset>

      <label>
        <input v-model="draft.completed" type="checkbox" />
        Completed
      </label>

      <div class="actions">
        <button type="submit" :disabled="!canSave">{{ isNew ? 'Add' : 'Save' }}</button>
        <button type="button" class="secondary" @click="cancel">Cancel</button>
      </div>
    </form>
  </article>
</template>

<style scoped>
li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

li button {
  width: auto;
  margin: 0;
  padding: 0.25rem 0.75rem;
}

.pending {
  margin-left: 0.5rem;
  color: var(--pico-muted-color);
}

.actions {
  display: flex;
  gap: 0.5rem;
}

/* Below Pico's 768px breakpoint, where .grid would put each field on its own line:
   due date and priority share one */
@media (max-width: 767px) {
  .grid {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 575px) {
  fieldset ul {
    padding-left: 0;
  }

  /* Add/Save and Cancel stay at the bottom of the screen while the long form scrolls */
  .actions {
    position: sticky;
    bottom: 0;
    z-index: 1;
    margin: 0 calc(var(--pico-block-spacing-horizontal) * -1) calc(var(--pico-block-spacing-vertical) * -1);
    padding: 0.75rem var(--pico-block-spacing-horizontal) calc(0.75rem + env(safe-area-inset-bottom));
    border-top: 1px solid var(--pico-muted-border-color);
    border-radius: 0 0 var(--pico-border-radius) var(--pico-border-radius);
    background: var(--pico-card-background-color);
  }

  .actions button {
    margin: 0;
  }
}
</style>
