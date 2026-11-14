import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import TelegramSettings from '../components/telegramSettings.vue'
import type { TelegramStatus } from '../types/telegram'
import { fakeApi } from './fakeApi'
import { button } from './helpers'

const ZONE = 'Asia/Singapore'
const linked: TelegramStatus = {
  linked: true,
  botUsername: 'PamBot',
  timeZone: ZONE,
  briefMinutes: 450,
  enabled: true,
  linkedAt: '2026-11-14T08:00:00.000Z',
}

async function mountSection(status: TelegramStatus | null, browserTimeZone = ZONE) {
  const api = fakeApi()
  api.telegram = status
  vi.stubGlobal('fetch', api.fetch)
  const wrapper = mount(TelegramSettings, { props: { browserTimeZone } })
  await flushPromises()
  return { api, wrapper }
}

const field = (wrapper: ReturnType<typeof mount>, label: string) =>
  wrapper.findAll('label').find((l) => l.text().startsWith(label))!.find<HTMLInputElement>('input')

afterEach(() => vi.unstubAllGlobals())

describe('Telegram settings', () => {
  it('is hidden when the bot is off on this deploy', async () => {
    const { api, wrapper } = await mountSection(null)
    expect(api.requests).toEqual(['GET /api/telegram'])
    expect(wrapper.find('article').exists()).toBe(false)
  })

  it('says why when the status cannot load, and tries again', async () => {
    const api = fakeApi()
    api.telegram = { linked: false, botUsername: 'PamBot' }
    api.failWith = 'D1 is down'
    vi.stubGlobal('fetch', api.fetch)
    const wrapper = mount(TelegramSettings, { props: { browserTimeZone: ZONE } })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain("Couldn't load the Telegram settings: D1 is down")

    api.failWith = null
    await button(wrapper, 'Try again').trigger('click')
    await flushPromises()
    expect(button(wrapper, 'Connect').exists()).toBe(true)
  })

  it('connects with a code and its t.me link, sending the browser’s time zone', async () => {
    const { api, wrapper } = await mountSection({ linked: false, botUsername: 'PamBot' })
    await button(wrapper, 'Connect').trigger('click')
    await flushPromises()

    expect(api.telegramCodes).toEqual([{ code: 'code1', timeZone: ZONE }])
    const link = wrapper.find('a[role="button"]')
    expect(link.text()).toBe('Open Telegram')
    expect(link.attributes('href')).toBe('https://t.me/PamBot?start=code1')
    expect(wrapper.find('.link-code').text()).toContain('Or send /start code1 to @PamBot. The code works once, for 10 minutes.')

    // Once the bot has seen the code, checking again shows the linked chat's settings
    api.telegram = linked
    await button(wrapper, "I've linked it").trigger('click')
    await flushPromises()
    expect(wrapper.find('.link-code').exists()).toBe(false)
    expect(button(wrapper, 'Disconnect').exists()).toBe(true)
  })

  it('shows the brief time, time zone and switch of a linked chat, saving only what changed', async () => {
    const { api, wrapper } = await mountSection(linked)
    expect(field(wrapper, 'Brief time').element.value).toBe('07:30')
    expect(field(wrapper, 'Time zone').element.value).toBe(ZONE)
    expect(field(wrapper, 'Morning brief').element.checked).toBe(true)
    expect(button(wrapper, 'Save').attributes('disabled')).toBeDefined()

    await field(wrapper, 'Brief time').setValue('08:15')
    await field(wrapper, 'Morning brief').setValue(false)
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(api.requests[api.requests.length - 1]).toBe('PUT /api/telegram')
    expect(api.telegram).toMatchObject({ timeZone: ZONE, briefMinutes: 495, enabled: false })
    expect(button(wrapper, 'Save').attributes('disabled')).toBeDefined()
  })

  it('refuses a time zone the browser does not know, and offers the browser’s own', async () => {
    const { wrapper } = await mountSection(linked, 'Europe/London')
    expect(wrapper.find('.hint').text()).toContain('This browser is in Europe/London.')

    await field(wrapper, 'Time zone').setValue('Nowhere/Town')
    expect(wrapper.find('[role="alert"]').text()).toBe('Choose a time zone such as Europe/London.')
    expect(button(wrapper, 'Save').attributes('disabled')).toBeDefined()

    await field(wrapper, 'Time zone').setValue('Asia/Singapore')
    await button(wrapper, 'Use it').trigger('click')
    expect(field(wrapper, 'Time zone').element.value).toBe('Europe/London')
    expect(button(wrapper, 'Save').attributes('disabled')).toBeUndefined()
  })

  it('disconnects, going back to Connect', async () => {
    const { api, wrapper } = await mountSection(linked)
    await button(wrapper, 'Disconnect').trigger('click')
    await flushPromises()
    expect(api.requests[api.requests.length - 1]).toBe('DELETE /api/telegram')
    expect(button(wrapper, 'Connect').exists()).toBe(true)
  })
})
