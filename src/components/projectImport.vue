<script setup lang="ts">
// The Import button on a project's page, and the dialog it opens: choose or paste a JSON export
// (the format Export makes), review what it will add, choose which version to keep of each task
// that's already in the project with different details, then save it all in one request. The
// reading and matching are in types/import.ts.
import { computed, nextTick, ref } from 'vue'
import { useTaskList } from '@/stores/taskList'
import {
  ImportError,
  parseImport,
  planImport,
  tasksToSave,
  type Choice,
  type ImportField,
  type ImportPlan,
} from '@/types/import'
import type { Project } from '@/types/project'
import type { Task } from '@/types/task'

const props = defineProps<{
  project: Project
  tasks: Task[] // all tasks; the project's own are looked up by id
}>()

// Far more than a project's worth of tasks, so a file this big is something else
const MAX_FILE_BYTES = 10_000_000

const FIELD_LABELS: Record<ImportField, string> = {
  name: 'Name',
  dueDate: 'Due date',
  priority: 'Priority',
  completed: 'Status',
  description: 'Description',
}

function shown(task: Task, field: ImportField): string {
  switch (field) {
    case 'dueDate':
      return task.dueDate ?? 'No due date'
    case 'completed':
      return task.completed ? 'Done' : 'Not done'
    case 'description':
      return task.description.trim() ? task.description : '(none)'
    default:
      return task[field]
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

const step = ref<'choose' | 'review' | 'done'>('choose')
const text = ref('')
const error = ref<string | null>(null)
const plan = ref<ImportPlan | null>(null)
const source = ref<string | null>(null) // the name of the project the file was exported from
const choices = ref<Record<string, Choice>>({}) // by the current task's id
const saving = ref(false)
const doneMessage = ref('')

const undecided = computed(() => plan.value?.duplicates.filter((d) => !choices.value[d.current.id]).length ?? 0)
const nothingToImport = computed(() => plan.value !== null && !plan.value.added.length && !plan.value.duplicates.length)

// Step 1: read the file into the text box, then review it straight away
async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  error.value = null
  try {
    if (file.size > MAX_FILE_BYTES) throw new ImportError(`"${file.name}" is too large to be a project export.`)
    text.value = await file.text()
  } catch (e) {
    error.value = e instanceof ImportError ? e.message : `Couldn't read "${file.name}": ${messageOf(e)}`
    return
  } finally {
    input.value = '' // so choosing the same file again, after Back, reads it again
  }
  review()
}

// Step 2: what the import will do. Choices start empty, so each duplicate is decided on purpose.
function review() {
  error.value = null
  try {
    const file = parseImport(text.value)
    plan.value = planImport(props.project, props.tasks, file)
    source.value = file.project?.name ?? null
    choices.value = {}
    step.value = 'review'
  } catch (e) {
    error.value = e instanceof ImportError ? e.message : `Couldn't read the export: ${messageOf(e)}`
  }
}

function chooseAll(choice: Choice) {
  choices.value = Object.fromEntries(plan.value!.duplicates.map((d) => [d.current.id, choice]))
}

function back() {
  error.value = null
  step.value = 'choose'
}

// Step 3: one request for everything, so a clash saves nothing and the choices can be changed
async function save() {
  if (!plan.value || undecided.value) return
  const toSave = tasksToSave(plan.value, choices.value)
  const added = plan.value.added.length
  const updated = toSave.length - added
  error.value = null
  if (toSave.length) {
    saving.value = true
    try {
      await useTaskList().importTasks(props.project.id, toSave)
    } catch (e) {
      error.value = `Couldn't import: ${messageOf(e)}`
      return
    } finally {
      saving.value = false
    }
  }
  const parts = [added && `added ${plural(added, 'new task')}`, updated && `updated ${plural(updated, 'task')}`].filter(Boolean)
  doneMessage.value = parts.length
    ? `${parts.join(' and ').replace(/^./, (c) => c.toUpperCase())}.`
    : 'Nothing changed: you kept the current version of every duplicate.'
  step.value = 'done'
}

// The dialog is modal where the browser supports it, as Export's is
const dialog = ref<HTMLDialogElement>()
const importButton = ref<HTMLButtonElement>()
const isOpen = ref(false)

async function open() {
  step.value = 'choose'
  text.value = ''
  error.value = null
  plan.value = null
  isOpen.value = true
  await nextTick()
  if (typeof dialog.value?.showModal === 'function') dialog.value.showModal()
  else dialog.value?.setAttribute('open', '')
}

function close() {
  if (saving.value) return // the request finishes either way; closing would hide how it went
  if (typeof dialog.value?.close === 'function' && dialog.value.open) dialog.value.close() // calls onClosed
  else {
    dialog.value?.removeAttribute('open')
    onClosed()
  }
}

function onClosed() {
  isOpen.value = false
  importButton.value?.focus()
}
</script>

<template>
  <button ref="importButton" type="button" class="secondary outline import-button" @click="open">Import</button>

  <dialog
    ref="dialog"
    class="import-dialog"
    aria-labelledby="import-title"
    @close="onClosed"
    @keydown.esc.prevent="close"
    @click.self="close"
  >
    <article v-if="isOpen">
      <header class="heading-row">
        <h3 id="import-title">Import into {{ project.name }}</h3>
        <button type="button" class="secondary outline compact" @click="close">Close</button>
      </header>

      <template v-if="step === 'choose'">
        <p class="hint">
          Choose a JSON file made by <strong>Export</strong>, or paste its text. Tasks already in this project are
          matched by id, or by name, and you choose which version to keep.
        </p>
        <label for="import-file" class="field-label">JSON file</label>
        <input id="import-file" type="file" accept=".json,application/json" @change="onFile" />
        <label for="import-text" class="field-label">Or paste the JSON</label>
        <textarea id="import-text" v-model="text" class="json" rows="8" spellcheck="false" />

        <p v-if="error" class="error" role="alert">{{ error }}</p>

        <footer>
          <button type="button" :disabled="!text.trim()" @click="review">Review import</button>
        </footer>
      </template>

      <template v-else-if="step === 'review' && plan">
        <p v-if="source" class="source"><small>From an export of “{{ source }}”</small></p>

        <p v-if="nothingToImport" class="summary">
          {{
            plan.unchanged.length
              ? 'Every task in this export is already in the project as it is. Nothing to import.'
              : 'This export has no tasks.'
          }}
        </p>
        <ul v-else class="summary">
          <li v-if="plan.added.length">{{ plural(plan.added.length, 'new task') }} to add</li>
          <li v-if="plan.duplicates.length">{{ plural(plan.duplicates.length, 'duplicate') }} to choose between</li>
          <li v-if="plan.unchanged.length">{{ plan.unchanged.length }} already in the project as they are, left alone</li>
        </ul>

        <section v-if="plan.added.length">
          <h4 class="section-heading">New tasks</h4>
          <ul class="plain-list added">
            <li v-for="task in plan.added" :key="task.id">
              <span :class="{ struck: task.completed }">{{ task.name }}</span>
              <small> · {{ task.dueDate ? `Due ${task.dueDate}` : 'No due date' }} · {{ task.priority }}</small>
            </li>
          </ul>
        </section>

        <section v-if="plan.duplicates.length" class="duplicates">
          <div class="heading-row">
            <h4 class="section-heading">Duplicates</h4>
            <div class="bulk">
              <button type="button" class="secondary outline compact" @click="chooseAll('current')">Keep all current</button>
              <button type="button" class="secondary outline compact" @click="chooseAll('imported')">Use all imported</button>
            </div>
          </div>
          <p><small>These tasks are already in the project with different details. Choose which version to keep.</small></p>

          <fieldset v-for="(dup, i) in plan.duplicates" :key="dup.current.id" class="duplicate">
            <legend>
              {{ dup.current.name }}
              <small v-if="dup.matchedBy === 'name'" class="matched">same name</small>
            </legend>
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <td></td>
                    <th scope="col">Current</th>
                    <th scope="col">Imported</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="field in dup.differences" :key="field" :data-field="field">
                    <th scope="row">{{ FIELD_LABELS[field] }}</th>
                    <td class="value">{{ shown(dup.current, field) }}</td>
                    <td class="value">{{ shown(dup.imported, field) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="choice">
              <label>
                <input v-model="choices[dup.current.id]" type="radio" :name="`duplicate-${i}`" value="current" />
                Keep current
              </label>
              <label>
                <input v-model="choices[dup.current.id]" type="radio" :name="`duplicate-${i}`" value="imported" />
                Use imported
              </label>
            </div>
          </fieldset>
        </section>

        <p v-if="undecided" class="undecided"><small>Choose a version for {{ plural(undecided, 'more duplicate') }}.</small></p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>

        <footer>
          <button type="button" class="secondary" :disabled="saving" @click="back">Back</button>
          <button type="button" :disabled="nothingToImport || undecided > 0 || saving" :aria-busy="saving" @click="save">
            Import
          </button>
        </footer>
      </template>

      <template v-else-if="step === 'done'">
        <p class="done" role="status">{{ doneMessage }}</p>
        <footer>
          <button type="button" @click="close">Done</button>
        </footer>
      </template>
    </article>
  </dialog>
</template>

<style scoped>
.import-button {
  flex: none;
  width: auto;
  margin: 0;
}

.import-dialog header h3 {
  margin: 0;
  overflow-wrap: anywhere;
}

.hint,
.source small,
.duplicates p small,
.undecided small,
.added small {
  color: var(--pico-muted-color);
}

.field-label {
  margin-bottom: 0.5rem;
  font-size: 0.85rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--pico-muted-color);
}

.json {
  font-family: ui-monospace, Consolas, 'Courier New', monospace;
  font-size: 0.8rem;
  line-height: 1.45;
  white-space: pre;
  overflow: auto;
  resize: vertical;
}

.summary {
  margin-bottom: 1.25rem;
}

.duplicates {
  margin-top: 1.25rem;
}

.duplicates > .heading-row {
  margin-bottom: 0.5rem;
}

.duplicates > .heading-row > h4 {
  margin: 0;
}

.bulk {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

/* One task's two versions, with only the fields that differ */
.duplicate {
  margin-bottom: 1rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--pico-muted-border-color);
  border-radius: var(--pico-border-radius);
}

.duplicate legend {
  padding-inline: 0.25rem;
  overflow-wrap: anywhere;
}

.matched {
  margin-left: 0.25rem;
  color: var(--pico-muted-color);
}

.table-scroll {
  overflow-x: auto;
}

.duplicate table {
  margin-bottom: 0.5rem;
  font-size: 0.9rem;
}

.duplicate th[scope='row'] {
  width: 7rem;
  color: var(--pico-muted-color);
  font-weight: normal;
}

.duplicate .value {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  vertical-align: top;
}

.choice {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1.5rem;
}

.choice label {
  margin: 0;
}

.import-dialog .error {
  margin-bottom: 0.75rem;
}

/* Phones: the footer's buttons share the width of the panel */
@media (max-width: 575px) {
  .import-dialog footer {
    display: flex;
    gap: 0.5rem;
  }

  .import-dialog footer button {
    flex: 1;
    margin: 0 !important; /* beats Pico's gap between dialog footer buttons */
  }
}
</style>
