<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import TaskSearch from '@/components/taskSearch.vue'
import { useSession } from '@/stores/session'
import { useTheme } from '@/stores/theme'

const session = useSession()
const theme = useTheme()
const signOutError = ref<string | null>(null)

// The account menu in the top-right corner: who is signed in, Settings, Theme and Sign out.
// Escape, clicking away, or going to another page closes it; switching the theme leaves it open.
const menuOpen = ref(false)
const menu = ref<HTMLElement>()
const menuButton = ref<HTMLButtonElement>()

function closeMenu({ refocus = false } = {}) {
  menuOpen.value = false
  if (refocus) nextTick(() => menuButton.value?.focus())
}

function onMenuFocusOut(event: FocusEvent) {
  if (!menu.value?.contains(event.relatedTarget as Node | null)) closeMenu()
}

// Clicks that don't move focus (on the page background, or in Safari, which doesn't focus a
// clicked button) still close the menu when they land outside it
function onDocumentClick(event: MouseEvent) {
  if (!menu.value?.contains(event.target as Node)) closeMenu()
}
watch(menuOpen, (open) => {
  if (open) document.addEventListener('click', onDocumentClick)
  else document.removeEventListener('click', onDocumentClick)
})

const route = useRoute()
watch(() => route.fullPath, () => closeMenu())

async function signOut() {
  closeMenu()
  signOutError.value = null
  try {
    await session.logOut()
  } catch (e) {
    signOutError.value = `Couldn't sign out: ${e instanceof Error ? e.message : String(e)}`
  }
}
</script>

<template>
  <main class="container">
    <header class="app-header">
      <h1>Hi, its Pam</h1>
      <nav v-if="session.account" class="app-nav" aria-label="Views">
        <RouterLink :to="{ name: 'dashboard' }">Projects</RouterLink>
        <RouterLink :to="{ name: 'calendar' }">Calendar</RouterLink>
      </nav>
      <TaskSearch v-if="session.account" />
      <div v-if="session.account" ref="menu" class="menu" @focusout="onMenuFocusOut" @keydown.esc="closeMenu({ refocus: true })">
        <button
          ref="menuButton"
          type="button"
          class="menu-button secondary outline"
          aria-label="Account menu"
          aria-controls="account-menu"
          :aria-expanded="menuOpen"
          @click="menuOpen = !menuOpen"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <div v-if="menuOpen" id="account-menu" class="account">
          <small class="email" :title="session.account.email">{{ session.account.email }}</small>
          <RouterLink :to="{ name: 'settings' }" class="menu-item">
            <svg class="menu-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
            </svg>
            Settings
          </RouterLink>
          <button
            type="button"
            class="menu-item"
            :aria-label="`Theme: ${theme.theme} (switch to ${theme.theme === 'dark' ? 'light' : 'dark'})`"
            @click="theme.toggle()"
          >
            <!-- The icon shows the theme in use: a moon when dark, a sun when light -->
            <svg v-if="theme.theme === 'dark'" class="menu-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
            </svg>
            <svg v-else class="menu-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
            Theme
          </button>
          <button type="button" class="menu-item" @click="signOut">
            <!-- An ajar door: the frame on the floor, and the door swung part-open on its left
                 hinge, its far edge drawn shorter for perspective, with a handle -->
            <svg class="menu-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M6 21V3h12v18" />
              <path d="M3 21h18" />
              <path d="M6 3l7 2.5v13L6 21" />
              <path d="M11 12h0.01" />
            </svg>
            Sign out
          </button>
        </div>
      </div>
    </header>
    <p v-if="signOutError" class="error" role="alert">{{ signOutError }}</p>
    <!-- Every route but the sign-in pages shows the dashboard (see router/index.ts) -->
    <RouterView />
  </main>
</template>

<style scoped>
.app-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1rem;
}

/* The views: the project list and the calendar, the open one underlined */
.app-nav {
  display: flex;
  gap: 1.25rem;
}

.app-nav a {
  color: var(--pico-muted-color);
  text-decoration: none;
}

.app-nav a:hover,
.app-nav a[aria-current='page'] {
  color: var(--pam-cream);
}

.app-nav a[aria-current='page'] {
  text-decoration: underline;
  text-underline-offset: 0.35em;
}

/* The hamburger button, with the account menu opening below it, over the page */
.menu {
  position: relative;
  flex: none;
}

.menu-button {
  display: grid;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  margin: 0;
  padding: 0;
}

.menu-icon {
  flex: none;
}

.menu-button svg,
.menu-icon {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.account {
  position: absolute;
  top: calc(100% + 0.25rem);
  right: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  width: max-content;
  min-width: 12rem;
  max-width: min(18rem, calc(100vw - 2rem));
  padding: 0.5rem;
  border: 1px solid var(--pam-green-line);
  border-radius: var(--pico-border-radius);
  background: var(--pam-green-raised);
  box-shadow: 0 0.5rem 1.5rem rgba(0, 0, 0, 0.35);
}

/* A long email is cut short rather than widening the menu past the screen */
.email {
  overflow: hidden;
  padding: 0.4rem 0.5rem 0.5rem;
  margin-bottom: 0.25rem;
  border-bottom: 1px solid var(--pam-green-line);
  color: var(--pico-muted-color);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Settings, Theme and Sign out look alike, link or button */
.menu-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  margin: 0;
  padding: 0.4rem 0.5rem;
  border: none;
  border-radius: calc(var(--pico-border-radius) / 2);
  background: transparent;
  color: var(--pam-cream);
  font-size: 1rem;
  text-align: left;
  text-decoration: none;
}

.menu-item:hover,
.menu-item:focus-visible,
.menu-item[aria-current='page'] {
  background: var(--pam-green-line);
}

/* Narrow screens: the menu stays in the top-right corner beside the title, with the views and
   the task lookup wrapping onto the lines below */
@media (max-width: 767px) {
  .app-header h1 {
    flex: 1 1 auto;
  }

  .menu {
    order: 1;
  }

  .app-nav {
    order: 2;
  }

  .app-header :deep(.task-search) {
    order: 3;
  }
}
</style>
