<script setup lang="ts">
// Sort and filter controls for the dashboard's project list. The choices live in the
// projectView store, which also works out which projects show.
import { storeToRefs } from 'pinia'
import TagFilter from './tagFilter.vue'
import { SORTS, useProjectView } from '@/stores/projectView'
import { useTagList } from '@/stores/tagList'
import { PRIORITIES } from '@/types/task'

const view = useProjectView()
const { sort, activeTagIds, priorities, filterCount } = storeToRefs(view)
const { tags } = storeToRefs(useTagList())

// Most urgent first, the order people scan for
const urgencies = [...PRIORITIES].reverse()
</script>

<template>
  <div class="list-controls">
    <label class="sort">
      Sort by
      <select v-model="sort">
        <option v-for="(label, key) in SORTS" :key="key" :value="key">{{ label }}</option>
      </select>
    </label>

    <details class="filters">
      <summary>
        Filter<span v-if="filterCount"> ({{ filterCount }} on)</span>
      </summary>

      <fieldset>
        <legend>Tag</legend>
        <TagFilter :tags="tags" :selected="activeTagIds" @toggle="view.toggleTag" />
      </fieldset>

      <fieldset>
        <legend>Urgency</legend>
        <div class="chips">
          <button
            v-for="p in urgencies"
            :key="p"
            type="button"
            class="chip compact urgency-chip"
            :aria-pressed="priorities.includes(p)"
            @click="view.togglePriority(p)"
          >
            {{ p }}
          </button>
        </div>
      </fieldset>

      <button v-if="filterCount" type="button" class="secondary outline compact" @click="view.clearFilters()">
        Clear filters
      </button>
    </details>
  </div>
</template>

<style scoped>
.list-controls {
  margin-top: 1rem;
}

.sort {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
  white-space: nowrap;
}

.sort select {
  width: auto;
  margin: 0;
}

.filters {
  margin: 0;
}

.filters summary {
  color: var(--pico-muted-color);
}

.filters fieldset {
  margin-block: 0.75rem;
}

.filters legend {
  margin-bottom: 0.5rem;
  font-size: 0.85rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--pico-muted-color);
}

/* The chips are shared with the tag filter (main.css); on, each takes the accent of the badges it
   filters by */
.urgency-chip[aria-pressed='true'] {
  border-color: var(--pam-coral);
  background: var(--pam-coral);
  color: var(--pam-green);
}

/* Phones: the sort menu takes the full width under its label */
@media (max-width: 575px) {
  .sort {
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .sort select {
    width: 100%;
  }
}
</style>
