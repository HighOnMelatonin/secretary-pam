import { afterEach, describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TagManager from '../components/tags.vue'
import { useProjectList } from '../stores/projectList'
import { useTagList } from '../stores/tagList'
import { createEmptyProject } from '../types/project'
import { ARCHIVE_TAG_ID, type Tag } from '../types/tag'
import { fakeApi } from './fakeApi'
import { button } from './helpers'

const tags: Tag[] = [
  { id: 'school', name: 'School (SUTD)' },
  { id: 'work', name: 'Work' },
]

// Mounts the tag list with the tags (and projects) already loaded into the stores
async function mountTags(options: { projectTagIds?: string[][] } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const api = fakeApi({ tags })
  await useTagList().load()
  useProjectList().projects = (options.projectTagIds ?? []).map((tagIds) => ({ ...createEmptyProject(), tagIds }))
  api.requests.length = 0
  const wrapper = mount(TagManager, { global: { plugins: [pinia] } })
  return { api, wrapper }
}

const nameInput = (wrapper: ReturnType<typeof mount>, name: string) => wrapper.find(`input[aria-label="Name of ${name}"]`)
const rowOf = (wrapper: ReturnType<typeof mount>, name: string) =>
  wrapper.findAll('li').find((li) => li.find(`input[aria-label="Name of ${name}"]`).exists())!

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TagManager', () => {
  it('lists each tag with how many projects use it', async () => {
    const { wrapper } = await mountTags({ projectTagIds: [['work'], ['school', 'work'], []] })
    expect(rowOf(wrapper, 'School (SUTD)').text()).toContain('Used by 1 project')
    expect(rowOf(wrapper, 'Work').text()).toContain('Used by 2 projects')
  })

  it('adds a tag and clears the field', async () => {
    const { api, wrapper } = await mountTags()
    expect(button(wrapper, 'Add tag').attributes('disabled')).toBeDefined()

    await wrapper.find('input[aria-label="New tag name"]').setValue('  Personal ')
    const forms = wrapper.findAll('form')
    await forms[forms.length - 1]!.trigger('submit') // the new tag form, after one per tag
    await flushPromises()

    expect(api.data.tags.map((t) => t.name)).toEqual(['School (SUTD)', 'Work', 'Personal'])
    expect(nameInput(wrapper, 'Personal').exists()).toBe(true)
    expect((wrapper.find('input[aria-label="New tag name"]').element as HTMLInputElement).value).toBe('')
  })

  it('renames a tag once its name has changed', async () => {
    const { api, wrapper } = await mountTags()
    const rename = () => rowOf(wrapper, 'Work').findAll('button').find((b) => b.text() === 'Rename')!
    expect(rename().attributes('disabled')).toBeDefined()

    await nameInput(wrapper, 'Work').setValue('Internship')
    expect(rename().attributes('disabled')).toBeUndefined()
    await rowOf(wrapper, 'Work').find('form').trigger('submit')
    await flushPromises()

    expect(api.requests).toEqual(['PUT /api/tags/work'])
    expect(api.data.tags[1]).toEqual({ id: 'work', name: 'Internship' })
    expect((nameInput(wrapper, 'Internship').element as HTMLInputElement).value).toBe('Internship')
  })

  it('keeps the typed name and shows the error when a rename fails', async () => {
    const { api, wrapper } = await mountTags()
    api.failWith = 'There is already a tag with that name'
    await nameInput(wrapper, 'Work').setValue('school (sutd)')
    await rowOf(wrapper, 'Work').find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').text()).toBe('Couldn\'t rename "Work": There is already a tag with that name')
    expect((nameInput(wrapper, 'Work').element as HTMLInputElement).value).toBe('school (sutd)')
  })

  it('deletes an unused tag without asking', async () => {
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    const { api, wrapper } = await mountTags()

    await rowOf(wrapper, 'Work').findAll('button').find((b) => b.text() === 'Delete')!.trigger('click')
    await flushPromises()

    expect(confirm).not.toHaveBeenCalled()
    expect(api.requests).toEqual(['DELETE /api/tags/work'])
    expect(nameInput(wrapper, 'Work').exists()).toBe(false)
  })

  it('asks before deleting a tag that projects use, and keeps it if cancelled', async () => {
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    const { api, wrapper } = await mountTags({ projectTagIds: [['work']] })

    await rowOf(wrapper, 'Work').findAll('button').find((b) => b.text() === 'Delete')!.trigger('click')
    await flushPromises()

    expect(confirm).toHaveBeenCalledWith('Delete "Work"? It will be removed from 1 project.')
    expect(api.requests).toEqual([])
    expect(nameInput(wrapper, 'Work').exists()).toBe(true)
  })

  it('offers no Delete for the built-in Archive tag', async () => {
    const { wrapper } = await mountTags()
    useTagList().tags = [...tags, { id: ARCHIVE_TAG_ID, name: 'Archive' }]
    await flushPromises()

    expect(rowOf(wrapper, 'Archive').findAll('button').map((b) => b.text())).toEqual(['Rename'])
    expect(rowOf(wrapper, 'Archive').text()).toContain('Built in')
  })

  it('emits close from Done', async () => {
    const { wrapper } = await mountTags()
    await button(wrapper, 'Done').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
