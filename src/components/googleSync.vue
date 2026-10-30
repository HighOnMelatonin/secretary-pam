<script setup lang="ts">
// The Sync Google Calendar button, under the Unassigned heading, where imported events land as
// tasks (see worker/google.ts); the taskbar has one too, and both share stores/googleSync.ts.
// With no Google account connected it sends the browser to Google to connect one; Google sends
// it back to /?google=connected, which syncs straight away. Below the button, what the last sync
// did for each account, and a list of the connected accounts (loaded when opened) with
// Disconnect and Connect another account.
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { useGoogleSync } from '@/stores/googleSync'
import { syncSummary, type GoogleAccount, type SyncResult } from '@/types/google'

const route = useRoute()
const router = useRouter()

const googleSync = useGoogleSync()
const { syncing, results, error, accounts } = storeToRefs(googleSync)
const { sync, connect, disconnect } = googleSync

// The rest of an account's line after its email, e.g. "3 added, 1 updated; 1 calendar couldn't be read"
function details(result: SyncResult) {
  if (result.error) return result.error
  const notes = [syncSummary(result)]
  if (result.keptDates) {
    notes.push(`${result.keptDates} kept ${result.keptDates === 1 ? 'its' : 'their'} due date, as the event moved past a project's delivery date`)
  }
  if (result.failedCalendars) {
    notes.push(`${result.failedCalendars} ${result.failedCalendars === 1 ? "calendar couldn't" : "calendars couldn't"} be read`)
  }
  return notes.join('; ')
}

function loadAccounts(event: Event) {
  if ((event.target as HTMLDetailsElement).open) googleSync.loadAccounts()
}

const syncedLabel = (account: GoogleAccount) =>
  account.syncedAt ? `synced ${new Date(account.syncedAt).toLocaleString()}` : 'not synced yet'

// Back from Google: sync, or say why it wasn't connected. The query is dropped first, so reloading
// the page doesn't do it again.
onMounted(() => {
  const { google, message, ...query } = route.query
  if (!google) return
  router.replace({ query })
  if (google === 'connected') sync()
  else error.value = typeof message === 'string' ? message : "Google Calendar wasn't connected."
})
</script>

<template>
  <div class="google-sync">
    <div class="actions">
      <button type="button" class="secondary outline compact" :aria-busy="syncing" :disabled="syncing" @click="sync">
        {{ syncing ? 'Syncing…' : 'Sync Google Calendar' }}
      </button>
      <details @toggle="loadAccounts">
        <summary>Google accounts</summary>
        <p v-if="!accounts" aria-busy="true"><small>Loading…</small></p>
        <ul v-else class="plain-list accounts">
          <li v-for="account in accounts" :key="account.email">
            <span>
              {{ account.email }} <small>{{ syncedLabel(account) }}</small>
            </span>
            <button type="button" class="secondary outline small" @click="disconnect(account.email)">Disconnect</button>
          </li>
          <li v-if="accounts.length === 0"><small>No account connected yet.</small></li>
        </ul>
        <button type="button" class="secondary outline small" @click="connect">
          {{ accounts?.length ? 'Connect another account' : 'Connect an account' }}
        </button>
      </details>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <ul v-if="results.length" class="plain-list results" role="status">
      <li v-for="result in results" :key="result.email">
        <strong>{{ result.email }}</strong>: <span :class="{ failed: result.error }">{{ details(result) }}</span>
        <button v-if="result.reconnect" type="button" class="secondary outline small" @click="connect">Connect again</button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.google-sync {
  margin-bottom: 1rem;
}

.actions {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.5rem 1.5rem;
}

.actions details {
  margin: 0;
}

.actions summary {
  color: var(--pico-muted-color);
  font-size: 0.9rem;
}

.accounts {
  margin: 0.75rem 0;
}

.accounts li,
.results li {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.25rem 0.75rem;
  margin-bottom: 0.5rem;
}

.accounts small,
.results {
  color: var(--pico-muted-color);
}

.results {
  margin: 0.75rem 0 0;
  font-size: 0.9rem;
}

.results strong {
  color: var(--pico-color);
}

/* Coral reads on the page background (see README's contrast table) */
.failed {
  color: var(--pam-coral);
}
</style>
