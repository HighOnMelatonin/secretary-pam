<script setup lang="ts">
// Lists the tags with a field to rename or delete each one, and a field to add a new one.
// Changes are saved straight away through the tag store, with any error shown at the top.
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useProjectList } from '@/stores/projectList'
import { useTagList } from '@/stores/tagList'
import { ARCHIVE_TAG_ID, createEmptyTag, type Tag } from '@/types/tag'

defineEmits<{
  close: []
}>()

const tagList = useTagList()
const { tags } = storeToRefs(tagList)
const { projects } = storeToRefs(useProjectList())

const error = ref<string | null>(null)
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

// Runs a save or delete, showing an error if it fails; returns whether it succeeded
async function attempt(action: () => Promise<void>, failure: string) {
  error.value = null
  try {
    await action()
    return true
  } catch (e) {
    error.value = `${failure}: ${messageOf(e)}`
    return false
  }
}

const projectCount = (tag: Tag) => projects.value.filter((p) => p.tagIds.includes(tag.id)).length
const projectsText = (count: number) => `${count} ${count === 1 ? 'project' : 'projects'}`

// Names typed into the list but not saved yet, by tag id
const drafts = ref<Record<string, string>>({})
const nameOf = (tag: Tag) => drafts.value[tag.id] ?? tag.name
const canRename = (tag: Tag) => nameOf(tag).trim() !== '' && nameOf(tag).trim() !== tag.name

async function rename(tag: Tag) {
  if (!canRename(tag)) return
  const name = nameOf(tag).trim()
  if (await attempt(() => tagList.saveTag({ ...tag, name }), `Couldn't rename "${tag.name}"`)) {
    delete drafts.value[tag.id]
  }
}

async function remove(tag: Tag) {
  const count = projectCount(tag)
  if (count > 0 && !confirm(`Delete "${tag.name}"? It will be removed from ${projectsText(count)}.`)) return
  if (await attempt(() => tagList.deleteTag(tag.id), `Couldn't delete "${tag.name}"`)) {
    delete drafts.value[tag.id]
  }
}

const newName = ref('')

async function add() {
  const name = newName.value.trim()
  if (!name) return
  if (await attempt(() => tagList.saveTag({ ...createEmptyTag(), name }), `Couldn't add "${name}"`)) {
    newName.value = ''
  }
}
</script>

<template>
  <article class="tag-manager">
    <header class="heading">
      <h2>Tags</h2>
      <button type="button" class="secondary" @click="$emit('close')">Done</button>
    </header>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <ul v-if="tags.length" class="tag-list">
      <li v-for="tag in tags" :key="tag.id">
        <form role="group" @submit.prevent="rename(tag)">
          <input
            :value="nameOf(tag)"
            :aria-label="`Name of ${tag.name}`"
            @input="drafts[tag.id] = ($event.target as HTMLInputElement).value"
          />
          <button type="submit" :disabled="!canRename(tag)">Rename</button>
          <button v-if="tag.id !== ARCHIVE_TAG_ID" type="button" class="secondary outline" @click="remove(tag)">
            Delete
          </button>
        </form>
        <small>
          Used by {{ projectsText(projectCount(tag)) }}<template v-if="tag.id === ARCHIVE_TAG_ID">.
            Built in: completed projects get it automatically, and removing it from a project brings the
            project back to the live list.</template>
        </small>
      </li>
    </ul>
    <p v-else><small>No tags yet.</small></p>

    <form role="group" @submit.prevent="add">
      <input v-model="newName" placeholder="New tag (e.g. Hobbies)" aria-label="New tag name" />
      <button type="submit" :disabled="!newName.trim()">Add tag</button>
    </form>
  </article>
</template>

<style scoped>
.heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.heading h2 {
  margin: 0;
}

.heading button {
  width: auto;
  margin: 0;
}

.tag-list {
  padding: 0;
  margin-block: 1.5rem;
}

.tag-list li {
  list-style: none;
  margin-bottom: 1rem;
}

.tag-list form {
  margin-bottom: 0.25rem;
}

.tag-list small {
  color: var(--pico-muted-color);
}

form button {
  white-space: nowrap;
}

/* The name field takes the space the buttons don't need. Phones put the name on its own
   line instead, with the buttons below (main.css). */
@media (min-width: 576px) {
  form input {
    flex: 1;
    min-width: 0;
  }

  form button {
    flex: none;
    width: auto;
    padding-inline: 0.9rem;
  }
}
</style>
