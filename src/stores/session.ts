import { ref } from 'vue'
import { acceptHMRUpdate, defineStore } from 'pinia'
import * as api from '@/api'

// Loads a new page, here or elsewhere in the app. Signing out does this rather than changing
// route, so every store starts again empty and nothing of the last account's data stays in memory.
// An object so tests can replace it.
export const browser = {
  load: (path: string) => window.location.assign(path),
}

// Where to go after signing in: `redirect` if it is a path in this app, otherwise the dashboard.
// Anything else, such as "//example.com", could send the user to another site.
export function redirectTarget(redirect: unknown) {
  return typeof redirect === 'string' && /^\/(?![/\\])/.test(redirect) ? redirect : '/'
}

export const useSession = defineStore('session', () => {
  // The signed-in account, or null when signed out
  const account = ref<api.Account | null>(null)
  let checked: Promise<void> | undefined

  // Asks the API who is signed in, the first time it is called
  function check() {
    checked ??= api.auth.me().then(
      (me) => void (account.value = me),
      () => void (account.value = null),
    )
    return checked
  }

  async function logIn(email: string, password: string) {
    account.value = await api.auth.logIn(email, password)
  }

  async function signUp(email: string, password: string) {
    account.value = await api.auth.signUp(email, password)
  }

  async function logOut() {
    await api.auth.logOut()
    account.value = null
    browser.load('/login')
  }

  return { account, check, logIn, signUp, logOut }
})

// Lets Vite hot-swap this store when the file changes, instead of keeping the old one
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSession, import.meta.hot))
}
