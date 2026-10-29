<script setup lang="ts">
// The Export button on a project's page, and the dialog it opens: choose a format and whether to
// include completed tasks, see a preview, then copy it or download it as a file. Exporting only
// reads the project and tasks it is given; the text comes from the functions in types/export.ts.
import { computed, nextTick, onUnmounted, ref } from 'vue'
import { CSV_BOM, exportFilename, exportRows, FORMATS, type ExportFormat } from '@/types/export'
import type { Project } from '@/types/project'
import type { Task } from '@/types/task'

const props = defineProps<{
  project: Project
  tasks: Task[] // all tasks; the project's own are looked up by id
}>()

const COPIED_MS = 2000

const formatId = ref<ExportFormat['id']>('markdown')
const includeCompleted = ref(false)
const exportedAt = ref(new Date().toISOString())

const format = computed(() => FORMATS.find((f) => f.id === formatId.value)!)
const output = computed(() =>
  format.value.render(exportRows(props.project, props.tasks, { includeCompleted: includeCompleted.value }), {
    exportedAt: exportedAt.value,
  }),
)
// The preview and the clipboard leave out the CSV's byte order mark: pasted into a spreadsheet
// or a message, the invisible mark would stick to the first cell. Downloads keep it, for Excel.
const shownText = computed(() => (output.value.startsWith(CSV_BOM) ? output.value.slice(CSV_BOM.length) : output.value))

const status = ref<{ kind: 'done' | 'error'; message: string } | null>(null)
let statusTimer: ReturnType<typeof setTimeout> | undefined
function showStatus(kind: 'done' | 'error', message: string) {
  clearTimeout(statusTimer)
  status.value = { kind, message }
  if (kind === 'done') statusTimer = setTimeout(() => (status.value = null), COPIED_MS)
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function copy() {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("this browser doesn't allow it")
    await navigator.clipboard.writeText(shownText.value)
    showStatus('done', 'Copied')
  } catch (e) {
    showStatus('error', `Couldn't copy to the clipboard (${messageOf(e)}). Use Download instead.`)
  }
}

// Saves the text through a temporary link to it, named for the project and today's local date
function download() {
  try {
    const url = URL.createObjectURL(new Blob([output.value], { type: format.value.mime }))
    const link = document.createElement('a')
    link.href = url
    link.download = exportFilename(props.project.name, format.value, new Date().toLocaleDateString('en-CA'))
    document.body.append(link)
    link.click()
    link.remove()
    // Some browsers start reading the file after the click returns, so it's freed a little later
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (e) {
    showStatus('error', `Couldn't download the file: ${messageOf(e)}`)
  }
}

// The dialog is modal where the browser supports it (which also traps focus and closes it on
// Escape), and otherwise just shown
const dialog = ref<HTMLDialogElement>()
const exportButton = ref<HTMLButtonElement>()
const isOpen = ref(false)

async function open() {
  exportedAt.value = new Date().toISOString()
  status.value = null
  isOpen.value = true
  await nextTick()
  if (typeof dialog.value?.showModal === 'function') dialog.value.showModal()
  else dialog.value?.setAttribute('open', '')
}

function close() {
  if (typeof dialog.value?.close === 'function' && dialog.value.open) dialog.value.close() // calls onClosed
  else {
    dialog.value?.removeAttribute('open')
    onClosed()
  }
}

// Focus goes back to the button that opened it
function onClosed() {
  isOpen.value = false
  clearTimeout(statusTimer)
  exportButton.value?.focus()
}

onUnmounted(() => clearTimeout(statusTimer))
</script>

<template>
  <button ref="exportButton" type="button" class="secondary outline export-button" @click="open">Export</button>

  <!-- A click on the backdrop around the panel closes it too -->
  <dialog
    ref="dialog"
    class="export-dialog"
    aria-labelledby="export-title"
    @close="onClosed"
    @keydown.esc.prevent="close"
    @click.self="close"
  >
    <article v-if="isOpen">
      <header class="heading-row">
        <h3 id="export-title">Export {{ project.name }}</h3>
        <button type="button" class="secondary outline compact" @click="close">Close</button>
      </header>

      <fieldset class="formats">
        <legend>Format</legend>
        <label v-for="f in FORMATS" :key="f.id" class="format">
          <input v-model="formatId" type="radio" name="export-format" :value="f.id" />
          <span>
            {{ f.label }}
            <small>{{ f.description }}</small>
          </span>
        </label>
      </fieldset>

      <label class="include-completed">
        <input v-model="includeCompleted" type="checkbox" role="switch" />
        Include completed tasks
      </label>

      <label for="export-preview" class="preview-label">Preview</label>
      <textarea id="export-preview" class="preview" :value="shownText" readonly rows="12" spellcheck="false" />

      <p v-if="status?.kind === 'done'" class="copied" role="status">{{ status.message }}</p>
      <p v-else-if="status?.kind === 'error'" class="error" role="alert">{{ status.message }}</p>

      <footer>
        <button type="button" @click="copy">Copy</button>
        <button type="button" class="secondary" @click="download">Download</button>
      </footer>
    </article>
  </dialog>
</template>

<style scoped>
.export-button {
  flex: none;
  width: auto;
  margin: 0;
}

.export-dialog header h3 {
  margin: 0;
  overflow-wrap: anywhere;
}

/* Each format with its description under its name */
.formats {
  margin-bottom: 1rem;
}

.formats legend,
.preview-label {
  margin-bottom: 0.5rem;
  font-size: 0.85rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--pico-muted-color);
}

.format {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.format input {
  flex: none;
}

.format small {
  display: block;
  color: var(--pico-muted-color);
}

.include-completed {
  margin-bottom: 1rem;
}

/* The export exactly as it will be copied or saved */
.preview {
  margin-bottom: 0.75rem;
  font-family: ui-monospace, Consolas, 'Courier New', monospace;
  font-size: 0.8rem;
  line-height: 1.45;
  white-space: pre;
  overflow: auto;
  resize: vertical;
}

.copied {
  margin-bottom: 0.75rem;
  color: var(--pam-cream);
}

.copied::before {
  content: '✓ ';
}

.export-dialog .error {
  margin-bottom: 0.75rem;
}

/* Phones: Copy and Download share the width of the panel */
@media (max-width: 575px) {
  .export-dialog footer {
    display: flex;
    gap: 0.5rem;
  }

  .export-dialog footer button {
    flex: 1;
    margin: 0 !important; /* beats Pico's gap between dialog footer buttons */
  }
}
</style>
