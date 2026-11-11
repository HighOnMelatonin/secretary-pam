<script setup lang="ts">
// The "forgot your password" page (/forgot-password): asks for a reset link by email. The answer
// is the same whether or not the email has an account (see worker/auth.ts), so this page never
// says which.
import { ref } from 'vue'
import * as api from '@/api'
import { MAX_EMAIL_LENGTH } from '@/types/limits'

const email = ref('')
const sentTo = ref<string | null>(null)
const error = ref<string | null>(null)
const busy = ref(false)

async function submit() {
  busy.value = true
  error.value = null
  try {
    await api.auth.requestReset(email.value)
    sentTo.value = email.value.trim()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <article class="login">
    <h2>Reset your password</h2>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <template v-if="sentTo">
      <p class="notice" role="status">
        If there's an account for {{ sentTo }}, we've emailed it a link to choose a new password. The link works once, for
        30 minutes.
      </p>
      <p><small>Nothing arrived? Check your spam folder, or <a href="#" @click.prevent="sentTo = null">try again</a>.</small></p>
    </template>

    <form v-else @submit.prevent="submit">
      <label>
        Email
        <input
          v-model="email"
          type="email"
          autocomplete="username"
          required
          :maxlength="MAX_EMAIL_LENGTH"
          aria-describedby="forgot-hint"
        />
        <small id="forgot-hint">We'll email you a link to choose a new password.</small>
      </label>
      <button type="submit" :disabled="busy" :aria-busy="busy">Email me a link</button>
    </form>

    <p class="switch">
      <small>Remembered it? <RouterLink :to="{ name: 'login' }">Sign in</RouterLink></small>
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
