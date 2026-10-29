<script setup lang="ts">
// Component to create or edit the details of a single project. None of its tasks can be due
// after its delivery date: each clash offers to extend the delivery date or move the task's due
// date (saved with the project), and blocks saving until one is fixed.
import { computed, ref, toRaw, watch } from 'vue'
import { PRIORITIES, type Task } from '@/types/task'
import { completionStatus, createEmptyProject, isPastDeadline, resolveTasks, type Project } from '@/types/project'
import type { Tag } from '@/types/tag'
import {
  isSafeUrl,
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
  MAX_URL_LENGTH,
  safeHref,
} from '@/types/limits'

const props = defineProps<{
  project?: Project // project to edit; a new empty project is used when omitted
  tasks?: Task[] // all existing tasks, used to resolve and link the project's tasks
  tags?: Tag[] // all tags, to choose the project's tags from
  taskDueDates?: Record<string, string> // task due dates to start out moved, by task id
}>()

const emit = defineEmits<{
  // taskDueDates: new due dates for the tasks whose due dates were moved, by task id
  save: [project: Project, taskDueDates: Record<string, string>]
  cancel: []
}>()

const copyOf = (project?: Project): Project =>
  project ? structuredClone(toRaw(project)) : createEmptyProject()

// Edits happen on a copy so the original is only changed when saved
const draft = ref<Project>(copyOf(props.project))
const taskDueDates = ref<Record<string, string>>({ ...props.taskDueDates })
watch(
  () => props.project,
  (project) => {
    draft.value = copyOf(project)
    taskDueDates.value = { ...props.taskDueDates }
  },
)

const isNew = computed(() => !props.project)

// Tasks
const projectTasks = computed(() => resolveTasks(draft.value, props.tasks ?? []))
const status = computed(() => completionStatus(draft.value, props.tasks ?? []))
const linkableTasks = computed(() =>
  (props.tasks ?? []).filter((t) => !draft.value.taskIds.includes(t.id)),
)
const newTaskId = ref('')

// Due dates: a task's own, or the one it's being moved to
const dueDateOf = (task: Task) => taskDueDates.value[task.id] ?? task.dueDate
const isLate = (task: Task) => isPastDeadline(dueDateOf(task), draft.value.deliveryDate)

const selectedTask = computed(() => linkableTasks.value.find((t) => t.id === newTaskId.value))
// The project's tasks that are due late block saving; the task picked to add blocks Add task
const lateTasks = computed(() => projectTasks.value.filter(isLate))
const selectionIsLate = computed(() => selectedTask.value !== undefined && isLate(selectedTask.value))
const clashes = computed(() => (selectionIsLate.value ? [...lateTasks.value, selectedTask.value!] : lateTasks.value))

const canSave = computed(() => draft.value.name.trim() !== '' && lateTasks.value.length === 0)

function extendDeadline(task: Task) {
  draft.value.deliveryDate = dueDateOf(task)
}

function moveDueDate(task: Task) {
  taskDueDates.value[task.id] = draft.value.deliveryDate!
}

function addTask() {
  if (!newTaskId.value || selectionIsLate.value) return
  draft.value.taskIds.push(newTaskId.value)
  newTaskId.value = ''
}

function removeTask(id: string) {
  draft.value.taskIds = draft.value.taskIds.filter((taskId) => taskId !== id)
  delete taskDueDates.value[id]
}

// Reference links
const newLinkLabel = ref('')
const newLinkUrl = ref('')
const linkError = ref<string | null>(null)
watch(newLinkUrl, () => (linkError.value = null))

// Only web and email links, so a link can't run code (e.g. javascript:) when clicked
function addLink() {
  const url = newLinkUrl.value.trim()
  if (!url) return
  if (!isSafeUrl(url)) {
    linkError.value = 'Links must be full web or email addresses, starting with http://, https:// or mailto:'
    return
  }
  draft.value.links.push({ label: newLinkLabel.value.trim() || url, url })
  newLinkLabel.value = ''
  newLinkUrl.value = ''
}

function removeLink(index: number) {
  draft.value.links.splice(index, 1)
}

function save() {
  if (!canSave.value) return
  draft.value.name = draft.value.name.trim()
  // Only the tasks the project ends up with are moved
  const moved = Object.fromEntries(Object.entries(taskDueDates.value).filter(([id]) => draft.value.taskIds.includes(id)))
  emit('save', structuredClone(toRaw(draft.value)), moved)
  if (isNew.value) {
    draft.value = createEmptyProject()
    taskDueDates.value = {}
  }
}

function cancel() {
  draft.value = copyOf(props.project)
  taskDueDates.value = { ...props.taskDueDates }
  emit('cancel')
}
</script>

<template>
  <article class="project-container edit-form">
    <form @submit.prevent="save">
      <label>
        Project name
        <input v-model="draft.name" placeholder="Project" required :maxlength="MAX_NAME_LENGTH" />
      </label>

      <div class="grid">
        <label>
          Delivery date
          <input
            type="date"
            :value="draft.deliveryDate ?? ''"
            @input="draft.deliveryDate = ($event.target as HTMLInputElement).value || null"
          />
        </label>

        <label>
          Priority
          <select v-model="draft.priority">
            <option v-for="p in PRIORITIES" :key="p" :value="p">{{ p }}</option>
          </select>
        </label>
      </div>

      <fieldset v-if="tags?.length" class="tags">
        <legend>Tags</legend>
        <label v-for="t in tags" :key="t.id">
          <input v-model="draft.tagIds" type="checkbox" :value="t.id" />
          {{ t.name }}
        </label>
      </fieldset>

      <label>
        Description
        <textarea
          v-model="draft.description"
          rows="4"
          placeholder="What does this project deliver?"
          :maxlength="MAX_DESCRIPTION_LENGTH"
        />
      </label>

      <fieldset>
        <legend>Tasks ({{ status.completed }} / {{ status.total }} completed)</legend>
        <progress :value="status.completed" :max="status.total || 1" />

        <ul v-if="projectTasks.length">
          <li v-for="task in projectTasks" :key="task.id">
            <span>
              <!-- On one line, so the space between the name and the note is kept -->
              <span :class="{ struck: task.completed }">{{ task.name }}</span> <small v-if="taskDueDates[task.id]" class="pending">due date moves to {{ taskDueDates[task.id] }}</small>
            </span>
            <button type="button" class="secondary outline" @click="removeTask(task.id)">Remove</button>
          </li>
        </ul>
        <p v-else><small>No tasks in this project.</small></p>

        <div v-if="linkableTasks.length" role="group">
          <select v-model="newTaskId">
            <option value="" disabled>Select task</option>
            <option v-for="t in linkableTasks" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
          <button type="button" :disabled="!newTaskId || selectionIsLate" @click="addTask">Add task</button>
        </div>

        <div v-for="task in clashes" :key="task.id" class="date-error" role="alert">
          <p>
            {{ task.name }} is due {{ dueDateOf(task) }}, after this project's delivery date
            ({{ draft.deliveryDate }}). Extend the project's deadline or move the task's due date.
          </p>
          <div class="date-fixes">
            <button type="button" class="secondary compact" @click="extendDeadline(task)">
              Extend project to {{ dueDateOf(task) }}
            </button>
            <button type="button" class="secondary outline compact" @click="moveDueDate(task)">
              Move {{ task.name }} to {{ draft.deliveryDate }}
            </button>
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Reference links</legend>
        <ul v-if="draft.links.length">
          <li v-for="(link, i) in draft.links" :key="link.url">
            <a :href="safeHref(link.url)" target="_blank" rel="noopener noreferrer">{{ link.label }}</a>
            <button type="button" class="secondary outline" @click="removeLink(i)">Remove</button>
          </li>
        </ul>
        <p v-else><small>No reference links.</small></p>

        <div role="group">
          <input v-model="newLinkLabel" placeholder="Label (e.g. GitHub repo)" :maxlength="MAX_NAME_LENGTH" />
          <input
            v-model="newLinkUrl"
            type="url"
            placeholder="https://"
            :maxlength="MAX_URL_LENGTH"
            @keydown.enter.prevent="addLink"
          />
          <button type="button" :disabled="!newLinkUrl.trim()" @click="addLink">Add link</button>
        </div>
        <p v-if="linkError" class="error" role="alert">{{ linkError }}</p>
      </fieldset>

      <div class="actions">
        <button type="submit" :disabled="!canSave">{{ isNew ? 'Add' : 'Save' }}</button>
        <button type="button" class="secondary" @click="cancel">Cancel</button>
      </div>
    </form>
  </article>
</template>

<style scoped>
/* The lists, the sticky Save and Cancel and the date fields' layout are shared with the task
   form (.edit-form in main.css) */

/* The tags sit side by side, wrapping onto more lines as needed */
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1.5rem;
}

.tags legend {
  width: 100%;
}

.tags label {
  margin: 0;
}

</style>
