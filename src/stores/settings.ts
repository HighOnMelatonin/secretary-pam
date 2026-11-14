import { ref } from 'vue'
import { acceptHMRUpdate, defineStore } from 'pinia'
import * as api from '@/api'
import { DEFAULT_SETTINGS, type UserSettings } from '@/types/settings'

// The signed-in account's capacity and prioritisation weights (src/types/settings.ts). Until they
// load, and if they can't, the defaults stand in, as they do for an account that never saved any.
// `loaded` and `error` say which, so the settings page never saves the stand-ins over real ones.
export const useSettings = defineStore('settings', () => {
  const settings = ref<UserSettings>(structuredClone(DEFAULT_SETTINGS))
  const loaded = ref(false)
  const error = ref<string | null>(null)

  async function load() {
    error.value = null
    try {
      settings.value = await api.settings.get()
      loaded.value = true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      throw e
    }
  }

  // Stores the settings, keeping what the Worker answers with
  async function save(value: UserSettings) {
    settings.value = await api.settings.save(value)
  }

  return { settings, loaded, error, load, save }
})

// Lets Vite hot-swap this store when the file changes, instead of keeping the old one
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSettings, import.meta.hot))
}
