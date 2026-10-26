<script setup lang="ts">
// The dashboard's actions (Tags, Add task, Add project), shown one of two ways:
// - with a mouse: a bar hidden on the left edge of the screen. Only a thin strip shows until
//   it is hovered or tabbed into; it then slides out over the page without moving anything.
// - on touch screens and narrow windows: a round + button in the bottom-right corner, within
//   thumb reach, that opens a menu. A strip on the left edge would be hard to tap and clash
//   with the phone's swipe-back gesture.
// CSS decides which one shows.
import { onMounted, onUnmounted, ref } from 'vue'

defineProps<{
  formOpen?: boolean // hides the + button, which would cover the form's Save button
}>()

const emit = defineEmits<{
  tags: []
  addTask: []
  addProject: []
}>()

// The bar opens on hover and keyboard focus in CSS, and from its strip when clicked
const barOpen = ref(false)
const menuOpen = ref(false)
const bar = ref<HTMLElement>()
const menu = ref<HTMLElement>()

// Closes both, letting go of keyboard focus too so the bar doesn't stay open over the form
function close() {
  barOpen.value = false
  menuOpen.value = false
  const focused = document.activeElement
  if (focused instanceof HTMLElement && (bar.value?.contains(focused) || menu.value?.contains(focused))) {
    focused.blur()
  }
}

const tags = () => (close(), emit('tags'))
const addTask = () => (close(), emit('addTask'))
const addProject = () => (close(), emit('addProject'))

// A tap anywhere else closes them
function onPointerDown(event: PointerEvent) {
  const target = event.target as Node
  if (barOpen.value && !bar.value?.contains(target)) barOpen.value = false
  if (menuOpen.value && !menu.value?.contains(target)) menuOpen.value = false
}

onMounted(() => document.addEventListener('pointerdown', onPointerDown))
onUnmounted(() => document.removeEventListener('pointerdown', onPointerDown))
</script>

<template>
  <nav ref="bar" class="taskbar" :class="{ open: barOpen }" aria-label="Actions" @mouseleave="barOpen = false">
    <div class="panel">
      <button type="button" class="secondary" @click="tags">Tags</button>
      <button type="button" class="secondary" @click="addTask">Add task</button>
      <button type="button" @click="addProject">Add project</button>
    </div>
    <button type="button" class="strip" :aria-expanded="barOpen" aria-label="Show actions" @click="barOpen = !barOpen">
      <span aria-hidden="true">›</span>
    </button>
  </nav>

  <nav v-if="!formOpen" ref="menu" class="fab-menu" aria-label="Actions menu">
    <div v-if="menuOpen" id="fab-actions" class="fab-actions">
      <button type="button" class="secondary" @click="tags">Tags</button>
      <button type="button" class="secondary" @click="addTask">Add task</button>
      <button type="button" @click="addProject">Add project</button>
    </div>
    <button
      type="button"
      class="fab"
      :aria-expanded="menuOpen"
      aria-controls="fab-actions"
      aria-label="Actions"
      @click="menuOpen = !menuOpen"
    >
      <span aria-hidden="true">+</span>
    </button>
  </nav>
</template>

<style scoped>
/* The bar on the left */

.taskbar {
  --strip-width: 1.5rem;
  position: fixed;
  inset-block: 0;
  left: 0;
  z-index: 10;
  display: flex;
  width: 15rem;
  box-shadow: 0.5rem 0 1.5rem rgba(0, 0, 0, 0.25);
  /* Off screen except the strip */
  transform: translateX(calc(-100% + var(--strip-width)));
  transition: transform 0.2s ease;
}

/* :focus-visible rather than :focus-within, so a mouse click doesn't leave it stuck open */
.taskbar.open,
.taskbar:has(:focus-visible) {
  transform: none;
}

/* Touch screens keep :hover after a tap, so only real pointers open it on hover */
@media (hover: hover) {
  .taskbar:hover {
    transform: none;
  }
}

.panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 2rem 1rem;
  background: var(--pam-green-raised);
}

.panel button {
  width: 100%;
  margin: 0;
}

.strip {
  width: var(--strip-width);
  margin: 0;
  padding: 0;
  border: none;
  border-right: 1px solid var(--pam-green-line);
  border-radius: 0;
  background: var(--pam-green-raised);
  color: var(--pico-muted-color);
}

.strip span {
  display: inline-block;
  font-size: 1.25rem;
  transition: transform 0.2s ease;
}

.taskbar.open .strip span,
.taskbar:has(:focus-visible) .strip span {
  transform: rotate(180deg);
}

@media (hover: hover) {
  .taskbar:hover .strip span {
    transform: rotate(180deg);
  }
}

/* The + button, for touch screens and narrow windows */

.fab-menu {
  display: none;
}

@media (hover: none), (max-width: 575px) {
  .taskbar {
    display: none;
  }

  .fab-menu {
    position: fixed;
    right: 1rem;
    bottom: calc(1rem + env(safe-area-inset-bottom));
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.75rem;
  }
}

.fab {
  width: 3.5rem;
  height: 3.5rem;
  margin: 0;
  padding: 0;
  border-radius: 50%;
  font-size: 2rem;
  line-height: 1;
  box-shadow: 0 0.5rem 1.5rem rgba(0, 0, 0, 0.35);
}

.fab span {
  display: inline-block;
  transition: transform 0.2s ease;
}

/* Turns the + into a × while the menu is open */
.fab[aria-expanded='true'] span {
  transform: rotate(45deg);
}

.fab-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 12rem;
  padding: 0.75rem;
  border: 1px solid var(--pam-green-line);
  border-radius: var(--pico-border-radius);
  background: var(--pam-green-raised);
  box-shadow: 0 0.5rem 1.5rem rgba(0, 0, 0, 0.35);
}

.fab-actions button {
  width: 100%;
  margin: 0;
}
</style>
