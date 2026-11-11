<script setup lang="ts">
// The page reset emails link to (/reset-password?token=…), for choosing a new password. Following
// OWASP's Forgot Password Cheat Sheet:
// - The token is taken out of the address bar as soon as the page opens, so it doesn't stay in
//   the browser's history or go out with later requests, and the page sends no Referer (also set
//   for this path in public/_headers).
// - The new password is typed twice, and follows the same rules as signing up.
// - Resetting signs every device out, this one included, and doesn't sign in: the page reloads at
//   the sign-in page, so nothing of a signed-in account stays in memory.
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as api from '@/api'
import { browser } from '@/stores/session'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/types/limits'

const route = useRoute()
const router = useRouter()

// Kept only in memory once it is out of the address bar
const token = typeof route.query.token === 'string' ? route.query.token : ''

const password = ref('')
const confirmation = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

onMounted(() => {
  const meta = document.createElement('meta')
  meta.name = 'referrer'
  meta.content = 'no-referrer'
  document.head.append(meta)
  if (route.query.token !== undefined) void router.replace({ query: {} })
})

async function submit() {
  if (password.value !== confirmation.value) {
    error.value = "The passwords don't match"
    return
  }
  busy.value = true
  error.value = null
  try {
    await api.auth.resetPassword(token, password.value)
    browser.load('/login?reset=done')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    password.value = ''
    confirmation.value = ''
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <article class="login">
    <h2>Choose a new password</h2>

    <p v-if="!token" class="error" role="alert">
      This link is incomplete. Open the link from the email again, or ask for a new one.
    </p>

    <template v-else>
      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <form @submit.prevent="submit">
        <label>
          New password
          <input
            v-model="password"
            type="password"
            autocomplete="new-password"
            required
            :minlength="MIN_PASSWORD_LENGTH"
            :maxlength="MAX_PASSWORD_LENGTH"
            aria-describedby="password-hint"
          />
          <small id="password-hint">At least {{ MIN_PASSWORD_LENGTH }} characters. Every device will be signed out.</small>
        </label>

        <label>
          Confirm new password
          <input v-model="confirmation" type="password" autocomplete="new-password" required :maxlength="MAX_PASSWORD_LENGTH" />
        </label>

        <button type="submit" :disabled="busy" :aria-busy="busy">Set new password</button>
      </form>
    </template>

    <p v-if="!token || error" class="switch">
      <small>Link expired or used already? <RouterLink :to="{ name: 'forgot-password' }">Email me a new link</RouterLink></small>
    </p>
  </article>
</template>

<style scoped>
.login {
  max-width: 28rem;
  margin-inline: auto;
}

h2 {
  margin-bottom: 1.5rem;
}

.switch {
  margin: 0;
  text-align: center;
}
</style>
