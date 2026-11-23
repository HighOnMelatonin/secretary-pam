<script setup lang="ts">
// The Today view of the Upcoming panel (see types/today.ts): the project tasks pinned to today with
// Do today, then today's errands, rolled-over ones included with how long ago they were planned.
// Each has its check mark and Edit button; an errand's checklist is shown under it, and ticking an
// item saves it straight away. Quick add at the top adds an errand for today from its name alone
// (Enter saves it); More opens the full errand form with the name typed so far. "Not in a project"
// narrows the list to errands and pinned tasks in no project; the panel keeps that choice, since its
// count of what's hidden depends on it.
import { ref } from 'vue'
import TaskRow from './taskRow.vue'
import { carriedLabel } from '@/types/errand'
import { MAX_NAME_LENGTH } from '@/types/limits'
import type { Task } from '@/types/task'
import type { TodayItem } from '@/types/today'

defineProps<{
  items: TodayItem[] // as the panel shows them: filtered, and cut short when it's collapsed
}>()

const noProjectOnly = defineModel<boolean>('noProjectOnly', { default: false })

const emit = defineEmits<{
  editTask: [task: Task]
  toggleTask: [task: Task]
  toggleItem: [task: Task, index: number] // ticks or unticks an errand's checklist item
  quickAdd: [name: string] // an errand for today, with nothing but its name
  more: [name: string] // opens the full errand form, starting from the name typed so far
}>()

const namesOf = (item: TodayItem) => item.projects.map((p) => p.name)

const name = ref('')
function quickAdd() {
  const typed = name.value.trim()
  if (!typed) return
  emit('quickAdd', typed)
  name.value = ''
}
</script>

<template>
  <div class="today">
    <form class="quick-add" role="group" @submit.prevent="quickAdd">
      <input
        v-model="name"
        :maxlength="MAX_NAME_LENGTH"
        placeholder="Add an errand for today…"
        aria-label="New errand for today"
        enterkeyhint="done"
      />
      <button type="button" class="secondary outline compact" @click="emit('more', name.trim())">More</button>
    </form>

    <label class="filter">
      <input v-model="noProjectOnly" type="checkbox" role="switch" />
      <small>Not in a project</small>
    </label>

    <ul v-if="items.length" class="plain-list">
      <TaskRow
        v-for="item in items"
        :key="item.task.id"
        :task="item.task"
        :project-names="item.task.kind === 'errand' ? undefined : namesOf(item)"
        @edit="emit('editTask', item.task)"
        @toggle-completed="emit('toggleTask', item.task)"
      >
        <small v-if="carriedLabel(item.carriedDays)" class="carried">{{ carriedLabel(item.carriedDays) }}</small>
        <ul v-if="item.task.checklist?.length" class="checklist">
          <li v-for="(entry, i) in item.task.checklist" :key="i">
            <label>
              <input type="checkbox" :checked="entry.done" @change="emit('toggleItem', item.task, i)" />
              <span :class="{ struck: entry.done }">{{ entry.text }}</span>
            </label>
          </li>
        </ul>
      </TaskRow>
    </ul>
    <p v-else class="empty">
      <small>{{ noProjectOnly ? 'No errands today.' : 'Nothing pinned to today and no errands.' }}</small>
    </p>
  </div>
</template>

<style scoped>
/* The name takes the room; More only what it needs */
.quick-add {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.quick-add input {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
}

.quick-add button {
  flex: none;
  width: auto;
  margin: 0;
}

.filter {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.75rem;
  cursor: pointer;
}

.filter input {
  margin: 0;
}

/* How long ago a rolled-over errand was planned: coral, as it's slipping */
.carried {
  display: block;
  color: var(--pam-coral);
}

.checklist {
  margin: 0.25rem 0 0;
  padding: 0;
  list-style: none;
}

.checklist li {
  list-style: none;
  margin: 0;
}

.checklist label {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.875rem;
  cursor: pointer;
}

.checklist input[type='checkbox'] {
  width: 1rem;
  height: 1rem;
  margin: 0;
  accent-color: var(--primary);
}

.empty {
  margin: 0;
}

.empty small {
  color: var(--pico-muted-color);
}
</style>
