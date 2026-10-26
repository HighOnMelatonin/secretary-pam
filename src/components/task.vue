<script setup lang="ts">
// Component to create or edit the details of a single task
import { computed, ref, toRaw, watch } from 'vue'
import {
  createEmptyTask,
  PRIORITIES,
  RELATION_TYPES,
  type RelationType,
  type Task,
} from '@/types/task'
import type { Project } from '@/types/project'

const props = defineProps<{
  task?: Task // task to edit; a new empty task is used when omitted
  availableTasks?: Pick<Task, 'id' | 'name'>[] // tasks that can be linked as relations
  projects?: Pick<Project, 'id' | 'name' | 'taskIds'>[] // projects the task can be assigned to
  projectIds?: string[] // projects to show as assigned; defaults to the projects whose taskIds include the task
}>()

const emit = defineEmits<{
  save: [task: Task, projectIds: string[]]
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
watch(
  () => props.task,
  (task) => {
    draft.value = copyOf(task)
    projectIds.value = assignedIdsOf(task)
  },
)

const isNew = computed(() => !props.task)
const canSave = computed(() => draft.value.name.trim() !== '')

// Project assignment
const newProjectId = ref('')

const assignedProjects = computed(() =>
  (props.projects ?? []).filter((p) => projectIds.value.includes(p.id)),
)
const assignableProjects = computed(() =>
  (props.projects ?? []).filter((p) => !projectIds.value.includes(p.id)),
)

function assignProject() {
  if (!newProjectId.value) return
  projectIds.value.push(newProjectId.value)
  newProjectId.value = ''
}

function unassignProject(id: string) {
  projectIds.value = projectIds.value.filter((projectId) => projectId !== id)
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
  emit('save', structuredClone(toRaw(draft.value)), [...projectIds.value])
  if (isNew.value) {
    draft.value = createEmptyTask()
    projectIds.value = []
  }
}

function cancel() {
  draft.value = copyOf(props.task)
  projectIds.value = assignedIdsOf(props.task)
  emit('cancel')
}
</script>

<template>
  <article class="task-container">
    <form @submit.prevent="save">
      <label>
        Task name
        <input v-model="draft.name" placeholder="Task" required />
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
        <textarea v-model="draft.description" rows="4" placeholder="What needs to be delivered?" />
      </label>

      <fieldset>
        <legend>Projects</legend>
        <ul v-if="assignedProjects.length">
          <li v-for="project in assignedProjects" :key="project.id">
            <span>{{ project.name }}</span>
            <button type="button" class="secondary outline" @click="unassignProject(project.id)">Remove</button>
          </li>
        </ul>
        <p v-else><small>Not in any project.</small></p>

        <div v-if="assignableProjects.length" role="group">
          <select v-model="newProjectId">
            <option value="" disabled>Select project</option>
            <option v-for="p in assignableProjects" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <button type="button" :disabled="!newProjectId" @click="assignProject">Assign</button>
        </div>
      </fieldset>

      <fieldset>
        <legend>Related tasks</legend>
        <ul v-if="draft.relations.length">
          <li v-for="(relation, i) in draft.relations" :key="relation.taskId">
            <span>{{ relation.type.replace('_', ' ') }}: {{ taskName(relation.taskId) }}</span>
            <button type="button" class="secondary outline" @click="removeRelation(i)">Remove</button>
          </li>
        </ul>
        <p v-else><small>No related tasks.</small></p>

        <div v-if="relatableTasks.length" role="group">
          <select v-model="newRelationType">
            <option v-for="t in RELATION_TYPES" :key="t" :value="t">{{ t.replace('_', ' ') }}</option>
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
