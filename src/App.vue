<script setup lang="ts">
import { ref } from 'vue'
import { useSession } from '@/stores/session'

const session = useSession()
const signOutError = ref<string | null>(null)

async function signOut() {
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
      <div v-if="session.account" class="account">
        <small>{{ session.account.email }}</small>
        <button type="button" class="secondary outline" @click="signOut">Sign out</button>
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

/* The views: the project list and the calendar, the open one underlined in cream */
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

.account {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

/* A long email is cut short rather than pushing the button off a narrow screen */
.account small {
  overflow: hidden;
  color: var(--pico-muted-color);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account button {
  flex: none;
  width: auto;
  margin: 0;
  padding: 0.25rem 0.75rem;
}
</style>
