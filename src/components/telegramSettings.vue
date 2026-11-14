<script setup lang="ts">
// The Telegram section of the settings page (docs/telegram-bot.md). Hidden when the bot isn't set
// up on this deploy (GET /api/telegram answers 404). Unlinked, Connect asks for a one-time code
// and shows it with the t.me link that sends it to the bot. Linked, it shows the morning brief's
// time, the time zone and an on/off switch, saved on their own with Save, and Disconnect. These
// save straight away, apart from the rest of the settings page and its Apply.
import { computed, onMounted, ref } from 'vue'
import * as api from '@/api'
import {
  formatMinutes,
  isTimeZone,
  LINK_CODE_MINUTES,
  parseMinutes,
  type TelegramLinkCode,
  type TelegramStatus,
} from '@/types/telegram'

const props = defineProps<{
  browserTimeZone?: string // this browser's time zone when omitted
}>()

const browserZone = computed(() => props.browserTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)

// undefined while loading, null when the bot is off
const status = ref<TelegramStatus | null | undefined>(undefined)
const loadError = ref<string | null>(null)
const error = ref<string | null>(null)
const busy = ref(false)
const linkCode = ref<TelegramLinkCode | null>(null)

// What's typed in the linked form
const time = ref('')
const timeZone = ref('')
const enabled = ref(true)

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

function show(next: TelegramStatus | null) {
  status.value = next
  if (next?.linked) {
    linkCode.value = null
    time.value = formatMinutes(next.briefMinutes)
    timeZone.value = next.timeZone
    enabled.value = next.enabled
  }
}

async function load() {
  loadError.value = null
  try {
    show(await api.telegram.status())
  } catch (e) {
    loadError.value = `Couldn't load the Telegram settings: ${message(e)}`
  }
}
onMounted(load)

// Runs one request at a time, showing its error
async function run(what: string, work: () => Promise<void>) {
  busy.value = true
  error.value = null
  try {
    await work()
  } catch (e) {
    error.value = `Couldn't ${what}: ${message(e)}`
  } finally {
    busy.value = false
  }
}

const connect = () => run('get a link code', async () => void (linkCode.value = await api.telegram.linkCode(browserZone.value)))
// After following the link, the chat is linked once the bot has seen the code
const checkAgain = () => run('check the link', async () => show(await api.telegram.status()))

const briefMinutes = computed(() => parseMinutes(time.value))
const zoneInvalid = computed(() => !isTimeZone(timeZone.value.trim()))
const changed = computed(
  () =>
    status.value?.linked === true &&
    (briefMinutes.value !== status.value.briefMinutes || timeZone.value.trim() !== status.value.timeZone || enabled.value !== status.value.enabled),
)

const save = () =>
  run('save the Telegram settings', async () => {
    if (briefMinutes.value === null || zoneInvalid.value) return
    show(await api.telegram.save({ timeZone: timeZone.value.trim(), briefMinutes: briefMinutes.value, enabled: enabled.value }))
  })

const disconnect = () =>
  run('disconnect Telegram', async () => {
    await api.telegram.disconnect()
    show(status.value ? { linked: false, botUsername: status.value.botUsername } : null)
  })

// The zones the browser knows, as suggestions for the field (newer than the TypeScript lib here)
const supportedValuesOf = (Intl as { supportedValuesOf?: (key: 'timeZone') => string[] }).supportedValuesOf
const zones = supportedValuesOf ? supportedValuesOf('timeZone') : []
</script>

<template>
  <article v-if="status || loadError" class="telegram" aria-labelledby="telegram-heading">
    <h3 id="telegram-heading">Telegram</h3>

    <div v-if="loadError" class="error" role="alert">
      <p>{{ loadError }}</p>
      <button type="button" class="secondary compact" @click="load">Try again</button>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <template v-if="status && !status.linked">
      <p>
        <small>Get a morning brief and your next two tasks in Telegram, tick them off there, and add tasks on the go.</small>
      </p>
      <div v-if="linkCode" class="link-code">
        <p>
          <a :href="linkCode.url" target="_blank" rel="noopener noreferrer" role="button">Open Telegram</a>
        </p>
        <p>
          <small>
            Or send <code>/start {{ linkCode.code }}</code> to @{{ status.botUsername }}. The code works once, for
            {{ LINK_CODE_MINUTES }} minutes.
          </small>
        </p>
        <button type="button" class="secondary compact" :disabled="busy" @click="checkAgain">I've linked it</button>
      </div>
      <button v-else type="button" :disabled="busy" @click="connect">Connect</button>
    </template>

    <form v-else-if="status?.linked" @submit.prevent="save">
      <label>
        <input v-model="enabled" type="checkbox" role="switch" />
        Morning brief
      </label>
      <div class="grid">
        <label>
          Brief time
          <input v-model="time" type="time" required :aria-invalid="briefMinutes === null || undefined" />
        </label>
        <label>
          Time zone
          <input v-model="timeZone" type="text" list="telegram-zones" autocomplete="off" :aria-invalid="zoneInvalid || undefined" />
          <datalist id="telegram-zones">
            <option v-for="zone in zones" :key="zone" :value="zone" />
          </datalist>
        </label>
      </div>
      <p v-if="zoneInvalid" class="error" role="alert">Choose a time zone such as {{ browserZone }}.</p>
      <p v-else-if="timeZone.trim() !== browserZone" class="hint">
        <small>This browser is in {{ browserZone }}.</small>
        <button type="button" class="secondary small" @click="timeZone = browserZone">Use it</button>
      </p>
      <p class="hint"><small>The brief comes on days with hours for tasks.</small></p>
      <div class="buttons">
        <button type="submit" :disabled="!changed || briefMinutes === null || zoneInvalid || busy">Save</button>
        <button type="button" class="secondary outline" :disabled="busy" @click="disconnect">Disconnect</button>
      </div>
    </form>
  </article>
</template>

<style scoped>
.telegram small {
  color: var(--pico-muted-color);
}

.hint {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.5rem;
}

/* A code can't break mid-word on its own, and is too long for a phone's width */
.link-code code {
  word-break: break-all;
}

.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.buttons button {
  width: auto;
  margin: 0;
}
</style>
