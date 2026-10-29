<script setup lang="ts">
// The task lookup in the header: finds tasks by name as you type, shortly after you stop, from
// the tasks the dashboard has loaded, including ones in no project and completed ones. Each
// result links to the task's page. Escape, clicking away or opening a result closes the list.
import { computed, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useProjectList } from '@/stores/projectList'
import { useTaskList } from '@/stores/taskList'
import { findTasks, type Task } from '@/types/task'

const DEBOUNCE_MS = 200

const { tasks } = storeToRefs(useTaskList())
const { projects } = storeToRefs(useProjectList())

const typed = ref('')
const query = ref('') // what was typed, once typing pauses
let timer: ReturnType<typeof setTimeout> | undefined
watch(typed, (value) => {
  clearTimeout(timer)
  timer = setTimeout(() => (query.value = value), DEBOUNCE_MS)
})
onUnmounted(() => clearTimeout(timer))

const results = computed(() => findTasks(tasks.value, query.value))
const isOpen = ref(false)
const showResults = computed(() => isOpen.value && query.value.trim() !== '')

const projectNames = (task: Task) =>
  projects.value.filter((p) => p.taskIds.includes(task.id)).map((p) => p.name).join(' · ') || 'Unassigned'

function close() {
  isOpen.value = false
}

// Opening a result starts the next lookup afresh
function reset() {
  clearTimeout(timer)
  typed.value = ''
  query.value = ''
  close()
}

// Closes once focus moves somewhere outside the search and its results
const root = ref<HTMLElement>()
function onFocusOut(event: FocusEvent) {
  if (!root.value?.contains(event.relatedTarget as Node | null)) close()
}
</script>

<template>
  <div ref="root" class="task-search" @focusout="onFocusOut" @keydown.esc="close">
    <input
      v-model="typed"
      type="search"
      placeholder="Find a task…"
      aria-label="Find a task by name"
      aria-controls="task-search-results"
      :aria-expanded="showResults"
      autocomplete="off"
      @input="isOpen = true"
      @focus="isOpen = true"
    />
    <!-- Pressing a result keeps focus in the field: Safari doesn't focus a tapped link, so the
         field's focusout would close the list before the tap landed -->
    <div v-if="showResults" id="task-search-results" class="results" @mousedown.prevent>
      <p class="sr-only" aria-live="polite">
        {{ results.length }} {{ results.length === 1 ? 'task' : 'tasks' }} found
      </p>
      <ul v-if="results.length" class="plain-list">
        <li v-for="task in results" :key="task.id">
          <RouterLink :to="{ name: 'task', params: { id: task.id } }" class="result" @click="reset">
            <span class="result-name">
              <span :class="{ struck: task.completed }">{{ task.name }}</span>
              <span v-if="task.completed" class="tag">✓ done</span>
            </span>
            <small>{{ projectNames(task) }} · {{ task.dueDate ? `Due ${task.dueDate}` : 'No due date' }}</small>
          </RouterLink>
        </li>
      </ul>
      <p v-else class="none"><small>No tasks match "{{ query.trim() }}".</small></p>
    </div>
  </div>
</template>

<style scoped>
/* The results open over the page below the field */
.task-search {
  position: relative;
  flex: 1 1 14rem;
  max-width: 22rem;
}

.task-search input {
  margin: 0;
}

.results {
  position: absolute;
  top: calc(100% + 0.25rem);
  right: 0;
  left: 0;
  z-index: 20;
  max-height: 60vh;
  overflow-y: auto;
  padding: 0.5rem;
  border: 1px solid var(--pam-green-line);
  border-radius: var(--pico-border-radius);
  background: var(--pam-green-raised);
  box-shadow: 0 0.5rem 1.5rem rgba(0, 0, 0, 0.35);
}

.results li {
  margin: 0;
}

.result {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.4rem 0.5rem;
  border-radius: calc(var(--pico-border-radius) / 2);
  color: var(--pam-cream);
  text-decoration: none;
}

.result:hover,
.result:focus-visible {
  background: var(--pam-green-line);
}

.result-name {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem 0.5rem;
  overflow-wrap: anywhere;
}

.result small,
.none small {
  color: var(--pico-muted-color);
}

.none {
  margin: 0;
  padding: 0.4rem 0.5rem;
}

/* Phones: the field takes a row of its own in the header, and the results its full width */
@media (max-width: 575px) {
  .task-search {
    flex-basis: 100%;
    max-width: none;
  }
}
</style>
