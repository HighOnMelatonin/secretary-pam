<script setup lang="ts">
// The sign-in page (/login) and the sign-up page (/signup). Every other page needs a signed-in
// account (see router/index.ts), and sends the user here first, then on to the page they asked for.
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { redirectTarget, useSession } from '@/stores/session'
import { MAX_EMAIL_LENGTH, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/types/limits'

const props = defineProps<{
  mode: 'login' | 'signup'
}>()

const session = useSession()
const route = useRoute()
const router = useRouter()

const email = ref('')
const password = ref('')
const confirmation = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

const isSignUp = computed(() => props.mode === 'signup')

// Switching between the two pages keeps the email but starts the passwords again
watch(
  () => props.mode,
  () => {
    password.value = ''
    confirmation.value = ''
    error.value = null
  },
)

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function submit() {
  if (isSignUp.value && password.value !== confirmation.value) {
    error.value = "The passwords don't match"
    return
  }
  busy.value = true
  error.value = null
  try {
    if (isSignUp.value) await session.signUp(email.value, password.value)
    else await session.logIn(email.value, password.value)
    await router.replace(redirectTarget(route.query.redirect))
  } catch (e) {
    error.value = messageOf(e)
    password.value = ''
    confirmation.value = ''
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <article class="login">
    <h2>{{ isSignUp ? 'Create an account' : 'Sign in' }}</h2>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <form @submit.prevent="submit">
      <label>
        Email
        <input v-model="email" type="email" autocomplete="username" required :maxlength="MAX_EMAIL_LENGTH" />
      </label>

      <label>
        Password
        <input
          v-model="password"
          type="password"
          :autocomplete="isSignUp ? 'new-password' : 'current-password'"
          required
          :minlength="isSignUp ? MIN_PASSWORD_LENGTH : undefined"
          :maxlength="MAX_PASSWORD_LENGTH"
          :aria-describedby="isSignUp ? 'password-hint' : undefined"
        />
        <small v-if="isSignUp" id="password-hint">At least {{ MIN_PASSWORD_LENGTH }} characters.</small>
      </label>

      <label v-if="isSignUp">
        Confirm password
        <input v-model="confirmation" type="password" autocomplete="new-password" required :maxlength="MAX_PASSWORD_LENGTH" />
      </label>

      <button type="submit" :disabled="busy" :aria-busy="busy">{{ isSignUp ? 'Create account' : 'Sign in' }}</button>
    </form>

    <p class="switch">
      <small v-if="isSignUp">
        Already have an account? <RouterLink :to="{ name: 'login', query: route.query }">Sign in</RouterLink>
      </small>
      <small v-else>
        No account yet? <RouterLink :to="{ name: 'signup', query: route.query }">Create one</RouterLink>
      </small>
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
