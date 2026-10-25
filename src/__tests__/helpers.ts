// Shared helpers for component tests
import type { DOMWrapper, VueWrapper } from '@vue/test-utils'

// The button whose text is exactly `text`; fails the test if there is none
export function button(wrapper: VueWrapper, text: string): DOMWrapper<HTMLButtonElement> {
  const found = wrapper.findAll('button').find((b) => b.text() === text)
  if (!found) throw new Error(`No button "${text}" in:\n${wrapper.html()}`)
  return found
}

// The <select> that has an option with this value, for forms with several selects
export function selectWithOption(wrapper: VueWrapper, value: string): DOMWrapper<HTMLSelectElement> {
  const found = wrapper.findAll('select').find((s) => s.find(`option[value="${value}"]`).exists())
  if (!found) throw new Error(`No select with option "${value}"`)
  return found as DOMWrapper<HTMLSelectElement>
}

// The text of each list item inside the fieldset with this legend
export function listedIn(wrapper: VueWrapper, legend: string): string[] {
  const fieldset = wrapper.findAll('fieldset').find((f) => f.find('legend').text().startsWith(legend))
  if (!fieldset) throw new Error(`No fieldset "${legend}"`)
  return fieldset.findAll('li').map((li) => li.text().replace(/\s*Remove$/, ''))
}
