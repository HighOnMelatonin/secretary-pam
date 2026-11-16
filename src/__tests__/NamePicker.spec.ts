import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import NamePicker from '../components/namePicker.vue'

const options = [
  { id: 'p1', name: 'Thesis' },
  { id: 'p2', name: 'Website' },
  { id: 'p3', name: 'Web shop' },
  { id: 'p4', name: 'New web page' },
]

function mountPicker(modelValue = '') {
  const wrapper = mount(NamePicker, {
    props: {
      options,
      label: 'Project',
      modelValue,
      'onUpdate:modelValue': (id: string) => wrapper.setProps({ modelValue: id }),
    },
  })
  return wrapper
}

const input = (wrapper: ReturnType<typeof mountPicker>) => wrapper.find<HTMLInputElement>('input')
const suggested = (wrapper: ReturnType<typeof mountPicker>) => wrapper.findAll('[role="option"]').map((o) => o.text())
const listOpen = (wrapper: ReturnType<typeof mountPicker>) => input(wrapper).attributes('aria-expanded') === 'true'
const picked = (wrapper: ReturnType<typeof mountPicker>) => wrapper.props('modelValue')

describe('NamePicker', () => {
  it('suggests the names containing what is typed, those starting with it first', async () => {
    const wrapper = mountPicker()
    expect(suggested(wrapper)).toEqual(['Thesis', 'Website', 'Web shop', 'New web page'])

    await input(wrapper).setValue('WEB')
    expect(listOpen(wrapper)).toBe(true)
    expect(suggested(wrapper)).toEqual(['Website', 'Web shop', 'New web page'])
    expect(picked(wrapper)).toBe('') // nothing named just "web"
  })

  it('picks a name typed in full, in any case, and drops the pick once the text changes', async () => {
    const wrapper = mountPicker()
    await input(wrapper).setValue('thesis')
    expect(picked(wrapper)).toBe('p1')
    await input(wrapper).setValue('thesi')
    expect(picked(wrapper)).toBe('')
  })

  it('picks a clicked suggestion, filling in its name and closing the list', async () => {
    const wrapper = mountPicker()
    await input(wrapper).setValue('shop')
    await wrapper.find('[role="option"]').trigger('click')
    expect(picked(wrapper)).toBe('p3')
    expect(input(wrapper).element.value).toBe('Web shop')
    expect(listOpen(wrapper)).toBe(false)
  })

  it('moves through the suggestions with the arrow keys and picks one with Enter', async () => {
    const wrapper = mountPicker()
    await input(wrapper).setValue('web')
    // The first suggestion is highlighted while typing, so Enter takes the best match
    expect(wrapper.find('[aria-selected="true"]').text()).toBe('Website')
    await input(wrapper).trigger('keydown', { key: 'ArrowDown' })
    await input(wrapper).trigger('keydown', { key: 'ArrowDown' })
    expect(input(wrapper).attributes('aria-activedescendant')).toBe(wrapper.find('[aria-selected="true"]').attributes('id'))
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    expect(picked(wrapper)).toBe('p4')
    expect(wrapper.emitted('confirm')).toBeUndefined()

    // Enter again, with the list closed, confirms the pick
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })

  it('closes the list on Escape', async () => {
    const wrapper = mountPicker()
    await input(wrapper).setValue('web')
    await input(wrapper).trigger('keydown', { key: 'Escape' })
    expect(listOpen(wrapper)).toBe(false)
  })

  it('follows the pick when the form changes it, such as clearing it once added', async () => {
    const wrapper = mountPicker('p2')
    expect(input(wrapper).element.value).toBe('Website')
    await wrapper.setProps({ modelValue: '' })
    expect(input(wrapper).element.value).toBe('')
  })
})
