// Syncing Google Calendar, shared by the button in the taskbar and the one under Unassigned
// (googleSync.vue), so both show the same progress and the panel shows what a sync from the
// taskbar did. Imported events land as tasks (see worker/google.ts).
import { ref } from 'vue'
import { acceptHMRUpdate, defineStore } from 'pinia'
import * as api from '@/api'
import type { GoogleAccount, SyncResult } from '@/types/google'
import { browser } from './session'
import { useProjectList } from './projectList'
import { useTaskList } from './taskList'

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

export const useGoogleSync = defineStore('googleSync', () => {
  const projectList = useProjectList()
  const taskList = useTaskList()

  const syncing = ref(false)
  const results = ref<SyncResult[]>([])
  const error = ref<string | null>(null)
  const accounts = ref<GoogleAccount[] | null>(null) // null until the account list is first opened

  // Google sends the browser back to /?google=connected, which googleSync.vue syncs from
  const connect = () => browser.load(api.google.connectPath)

  // With no account connected, goes to Google to connect one instead. A sync can add, change
  // and delete tasks, and so change projects too, so both are loaded again after it.
  async function sync() {
    if (syncing.value) return
    syncing.value = true
    error.value = null
    try {
      const reply = await api.google.sync()
      if (reply.length === 0) return connect()
      results.value = reply
      if (accounts.value) accounts.value = await api.google.accounts() // for the new sync times
    } catch (e) {
      error.value = `Couldn't sync Google Calendar: ${messageOf(e)}`
      return
    } finally {
      syncing.value = false
    }
    try {
      await Promise.all([taskList.load(), projectList.load()])
    } catch (e) {
      error.value = `Couldn't load the imported tasks: ${messageOf(e)}`
    }
  }

  async function loadAccounts() {
    if (accounts.value) return
    try {
      accounts.value = await api.google.accounts()
    } catch (e) {
      error.value = `Couldn't load your Google accounts: ${messageOf(e)}`
    }
  }

  // Its tasks stay, with their badge
  async function disconnect(email: string) {
    error.value = null
    try {
      await api.google.disconnect(email)
      accounts.value = accounts.value?.filter((a) => a.email !== email) ?? null
      results.value = results.value.filter((r) => r.email !== email)
    } catch (e) {
      error.value = `Couldn't disconnect ${email}: ${messageOf(e)}`
    }
  }

  return { syncing, results, error, accounts, connect, sync, loadAccounts, disconnect }
})

// Lets Vite hot-swap this store when the file changes, instead of keeping the old one
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useGoogleSync, import.meta.hot))
}
