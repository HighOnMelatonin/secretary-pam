<script setup lang="ts">
// A text field that picks one of a list of named things, suggesting the names that contain what's
// typed. v-model is the picked id, or '' while nothing is picked. Typing a name in full picks it
// too, so a name typed but not chosen from the list isn't lost. Arrow keys move through the
// suggestions, Enter picks one (or, with one picked and the list closed, emits confirm so the
// form can add it), and Escape or clicking away closes the list.
import { computed, ref, useId, watch } from 'vue'

type Option = { id: string; name: string }

const props = defineProps<{
  options: Option[]
  placeholder?: string
  label: string // read out for the field, as it has no visible label
}>()

const picked = defineModel<string>({ required: true })
const emit = defineEmits<{ confirm: [] }>()

const listId = useId()
const optionId = (i: number) => `${listId}-${i}`

const nameOf = (id: string) => props.options.find((o) => o.id === id)?.name ?? ''
const typed = ref(nameOf(picked.value))
const isOpen = ref(false)
const active = ref(-1) // the highlighted suggestion, by index

const suggestions = computed(() => {
  const needle = typed.value.trim().toLowerCase()
  const matches = props.options.filter((o) => o.name.toLowerCase().includes(needle))
  // Names starting with what's typed come first
  return needle ? matches.sort((a, b) => Number(!a.name.toLowerCase().startsWith(needle)) - Number(!b.name.toLowerCase().startsWith(needle))) : matches
})
const showList = computed(() => isOpen.value && suggestions.value.length > 0)

// The id the field last set, to tell a pick made here from one the form makes, such as clearing
// it once the pick is added
let emitted = picked.value
function setPicked(id: string) {
  emitted = id
  picked.value = id
}
watch(picked, (id) => {
  if (id !== emitted) {
    emitted = id
    typed.value = nameOf(id)
  }
})

function onInput() {
  isOpen.value = true
  active.value = typed.value.trim() ? 0 : -1
  const exact = props.options.find((o) => o.name.toLowerCase() === typed.value.trim().toLowerCase())
  setPicked(exact?.id ?? '')
}

function choose(option: Option) {
  typed.value = option.name
  setPicked(option.id)
  isOpen.value = false
  active.value = -1
}

function move(step: number) {
  if (!showList.value) {
    isOpen.value = true
    active.value = step > 0 ? 0 : suggestions.value.length - 1
    return
  }
  const count = suggestions.value.length
  active.value = (active.value + step + count) % count
}

// Enter never submits the form from here, as that would save the task mid-pick
function onEnter() {
  const option = showList.value ? suggestions.value[active.value] : undefined
  if (option) choose(option)
  else if (picked.value) {
    isOpen.value = false
    emit('confirm')
  }
}

function close() {
  isOpen.value = false
  active.value = -1
}
</script>

<template>
  <div class="name-picker" @focusout="close">
    <input
      v-model="typed"
      type="text"
      role="combobox"
      autocomplete="off"
      :placeholder="placeholder"
      :aria-label="label"
      aria-autocomplete="list"
      :aria-expanded="showList"
      :aria-controls="listId"
      :aria-activedescendant="showList && active >= 0 ? optionId(active) : undefined"
      @input="onInput"
      @focus="isOpen = true"
      @click="isOpen = true"
      @keydown.down.prevent="move(1)"
      @keydown.up.prevent="move(-1)"
      @keydown.enter.prevent="onEnter"
      @keydown.esc="close"
    />
    <!-- Pressing a suggestion keeps focus in the field, so its focusout doesn't close the list
         before the press lands -->
    <ul v-show="showList" :id="listId" role="listbox" class="suggestions plain-list" @mousedown.prevent>
      <li
        v-for="(option, i) in suggestions"
        :id="optionId(i)"
        :key="option.id"
        role="option"
        :aria-selected="i === active"
        :class="{ active: i === active }"
        @click="choose(option)"
      >
        {{ option.name }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.name-picker {
  position: relative;
}

.name-picker input {
  margin-bottom: 0;
}

.suggestions {
  position: absolute;
  top: calc(100% + 0.25rem);
  right: 0;
  left: 0;
  z-index: 20;
  max-height: 16rem;
  overflow-y: auto;
  padding: 0.25rem;
  border: 1px solid var(--pam-green-line);
  border-radius: var(--pico-border-radius);
  background: var(--pam-green-raised);
  box-shadow: 0 0.5rem 1.5rem rgba(0, 0, 0, 0.35);
}

.suggestions li {
  margin: 0;
  padding: 0.4rem 0.5rem;
  border-radius: calc(var(--pico-border-radius) / 2);
  cursor: pointer;
  overflow-wrap: anywhere;
}

.suggestions li:hover,
.suggestions li.active {
  background: var(--pam-green-line);
}
</style>
