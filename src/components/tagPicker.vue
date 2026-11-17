<script setup lang="ts">
// The tags fieldset of the project and task forms: a checkbox per tag, then a [+] button that
// opens a field to make a new tag on the spot. The new tag is saved straight away through
// createTag (so it's there even if the form is cancelled) and ticked. Without createTag there
// is no [+], and with no tags either the fieldset isn't shown.
import { nextTick, ref } from 'vue'
import { tagStyle, type Tag } from '@/types/tag'
import { MAX_NAME_LENGTH } from '@/types/limits'

const props = defineProps<{
  tags: Tag[] // the tags to choose from
  createTag?: (name: string) => Promise<Tag> // saves a new tag and returns it as stored
}>()

const selected = defineModel<string[]>({ required: true }) // ids of the ticked tags

const adding = ref(false)
const newName = ref('')
const saving = ref(false)
const error = ref<string | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)

async function startAdding() {
  adding.value = true
  error.value = null
  await nextTick()
  nameInput.value?.focus()
}

function stopAdding() {
  adding.value = false
  newName.value = ''
  error.value = null
}

async function add() {
  const name = newName.value.trim()
  if (!name || !props.createTag || saving.value) return
  // An existing tag with that name is ticked rather than made again
  const existing = props.tags.find((t) => t.name.localeCompare(name, undefined, { sensitivity: 'base' }) === 0)
  if (existing) {
    if (!selected.value.includes(existing.id)) selected.value = [...selected.value, existing.id]
    stopAdding()
    return
  }
  saving.value = true
  error.value = null
  try {
    const tag = await props.createTag(name)
    selected.value = [...selected.value, tag.id]
    stopAdding()
  } catch (e) {
    error.value = `Couldn't add "${name}": ${e instanceof Error ? e.message : String(e)}`
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <fieldset v-if="tags.length || createTag" class="tag-picker">
    <legend>Tags</legend>
    <label v-for="t in tags" :key="t.id">
      <input v-model="selected" type="checkbox" :value="t.id" />
      <span class="tag project-tag" :style="tagStyle(t)">{{ t.name }}</span>
    </label>
    <button
      v-if="createTag && !adding"
      type="button"
      class="secondary outline compact add-tag"
      aria-label="New tag"
      title="New tag"
      @click="startAdding"
    >
      +
    </button>

    <!-- Not a <form>, as it sits inside the project or task form: Enter adds the tag instead of
         submitting that form, and Escape closes the field -->
    <div v-if="adding" role="group" class="new-tag">
      <input
        ref="nameInput"
        v-model="newName"
        placeholder="New tag (e.g. Hobbies)"
        aria-label="New tag name"
        :maxlength="MAX_NAME_LENGTH"
        @keydown.enter.prevent="add"
        @keydown.esc.prevent="stopAdding"
      />
      <button type="button" :disabled="!newName.trim() || saving" :aria-busy="saving || undefined" @click="add">
        Add tag
      </button>
      <button type="button" class="secondary outline" @click="stopAdding">Cancel</button>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </fieldset>
</template>

<style scoped>
/* The tags sit side by side, wrapping onto more lines as needed, with [+] after the last */
.tag-picker {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1.5rem;
}

.tag-picker legend,
.new-tag,
.error {
  width: 100%;
}

.tag-picker label {
  display: inline-flex;
  align-items: center;
  margin: 0;
}

.add-tag {
  min-width: 2.25rem;
  line-height: 1;
}

.new-tag {
  margin: 0;
}

.new-tag button {
  white-space: nowrap;
}

.error {
  margin: 0;
}

@media (min-width: 576px) {
  .new-tag input {
    flex: 1;
    min-width: 0;
  }

  .new-tag button {
    flex: none;
    width: auto;
    padding-inline: 0.9rem;
  }
}
</style>
