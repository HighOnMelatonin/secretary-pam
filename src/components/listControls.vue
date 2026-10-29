<script setup lang="ts">
// Sort and filter controls for the dashboard's project list. The choices live in the
// projectView store, which also works out which projects show.
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { NO_TAG, SORTS, useProjectView } from '@/stores/projectView'
import { useTagList } from '@/stores/tagList'
import { ARCHIVE_TAG_ID, tagStyle } from '@/types/tag'
import { PRIORITIES } from '@/types/task'

const view = useProjectView()
const { sort, activeTagIds, priorities, filterCount } = storeToRefs(view)
const { tags } = storeToRefs(useTagList())
// Live projects never have the Archive tag, so it isn't offered as a filter
const filterTags = computed(() => tags.value.filter((t) => t.id !== ARCHIVE_TAG_ID))

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
        <div class="chips">
          <button
            v-for="tag in filterTags"
            :key="tag.id"
            type="button"
            class="chip tag-chip"
            :style="tagStyle(tag)"
            :aria-pressed="activeTagIds.includes(tag.id)"
            @click="view.toggleTag(tag.id)"
          >
            {{ tag.name }}
          </button>
          <button
            type="button"
            class="chip tag-chip"
            :aria-pressed="activeTagIds.includes(NO_TAG)"
            @click="view.toggleTag(NO_TAG)"
          >
            No tag
          </button>
        </div>
      </fieldset>

      <fieldset>
        <legend>Urgency</legend>
        <div class="chips">
          <button
            v-for="p in urgencies"
            :key="p"
            type="button"
            class="chip urgency-chip"
            :aria-pressed="priorities.includes(p)"
            @click="view.togglePriority(p)"
          >
            {{ p }}
          </button>
        </div>
      </fieldset>

      <button v-if="filterCount" type="button" class="secondary outline clear" @click="view.clearFilters()">
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

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

/* A toggle shaped like the tags on the tiles; filled when on */
.chip {
  width: auto;
  margin: 0;
  padding: 0.3rem 0.9rem;
  border: 1px solid var(--pam-cream-muted);
  border-radius: 999px;
  background: transparent;
  color: var(--pam-cream);
  font-size: 0.9rem;
}

/* When on, each chip takes the accent of the badges it filters by (see main.css), plus a
   tick so the state doesn't rest on colour alone */
.chip[aria-pressed='true']::before {
  content: '✓ ';
  content: '✓ ' / ''; /* the empty alt text keeps screen readers from reading it; aria-pressed says it */
}

/* Filled with the tag's colour (from tagStyle()), or indigo for No tag. A tag's colour can be as
   dark as the page, so the cream border marks the chip's edge */
.tag-chip[aria-pressed='true'] {
  border-color: var(--pam-cream);
  background: var(--pam-tag-fill, var(--pam-indigo));
  color: var(--pam-tag-text, var(--pam-cream));
}

.urgency-chip[aria-pressed='true'] {
  border-color: var(--pam-coral);
  background: var(--pam-coral);
  color: var(--pam-green);
}

.clear {
  width: auto;
  margin: 0;
  padding: 0.3rem 0.9rem;
  font-size: 0.9rem;
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
