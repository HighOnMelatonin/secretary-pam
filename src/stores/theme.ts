// The colour scheme: dark (cream on forest green, the default) or light (forest green on beige).
// It is set as data-theme on <html>, which main.css themes by, and kept in this browser's
// localStorage so it survives a reload. Blocked storage still switches, just unremembered.
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type Theme = 'dark' | 'light'

export const THEME_KEY = 'pam-theme'

function stored(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export const useTheme = defineStore('theme', () => {
  const theme = ref<Theme>(stored())

  watch(
    theme,
    (value) => {
      document.documentElement.dataset.theme = value
      try {
        localStorage.setItem(THEME_KEY, value)
      } catch {
        // Storage is blocked: the theme still applies until the page is closed
      }
    },
    { immediate: true },
  )

  function toggle() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
  }

  return { theme, toggle }
})
