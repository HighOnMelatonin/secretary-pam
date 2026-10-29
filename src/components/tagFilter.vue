<script setup lang="ts">
// The chips of a tag filter: one per tag, in the tag's colour, and one for untagged things. Each
// toggles on and off; which are on is up to the parent. Used by the dashboard's list controls
// and the calendar.
import { computed } from 'vue'
import { ARCHIVE_TAG_ID, NO_TAG, tagStyle, type Tag } from '@/types/tag'

const props = defineProps<{
  tags: Tag[]
  selected: string[] // tag ids, or NO_TAG
}>()

defineEmits<{
  toggle: [id: string]
}>()

// Live projects never have the Archive tag, so it isn't offered
const shownTags = computed(() => props.tags.filter((t) => t.id !== ARCHIVE_TAG_ID))
</script>

<template>
  <div class="chips">
    <button
      v-for="tag in shownTags"
      :key="tag.id"
      type="button"
      class="chip compact tag-chip"
      :style="tagStyle(tag)"
      :aria-pressed="selected.includes(tag.id)"
      @click="$emit('toggle', tag.id)"
    >
      {{ tag.name }}
    </button>
    <button
      type="button"
      class="chip compact tag-chip"
      :aria-pressed="selected.includes(NO_TAG)"
      @click="$emit('toggle', NO_TAG)"
    >
      No tag
    </button>
  </div>
</template>
