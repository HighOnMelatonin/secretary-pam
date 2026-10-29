import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TaskSearch from '../components/taskSearch.vue'
import { useProjectList } from '../stores/projectList'
import { useTaskList } from '../stores/taskList'
import { createEmptyProject } from '../types/project'
import { createEmptyTask, type Task } from '../types/task'
import { routerAt } from './helpers'

const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id, name: id, ...fields })

// Mounts the lookup with tasks already in the stores, as the dashboard leaves them
async function mountSearch() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useTaskList().tasks = [
    task('Write report', { dueDate: '2026-11-02' }),
    task('Rewrite report', { completed: true }),
    task('Book room'),
  ]
  useProjectList().projects = [
    { ...createEmptyProject(), id: 'p', name: 'Thesis', taskIds: ['Write report'] },
    { ...createEmptyProject(), id: 'q', name: 'Website', taskIds: ['Write report'] },
  ]
  const router = await routerAt()
  const wrapper = mount(TaskSearch, { global: { plugins: [pinia, router] }, attachTo: document.body })
  return { wrapper, router }
}

type Wrapper = Awaited<ReturnType<typeof mountSearch>>['wrapper']
async function type(wrapper: Wrapper, text: string) {
  await wrapper.find('input').setValue(text)
  vi.advanceTimersByTime(200)
  await flushPromises()
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('TaskSearch', () => {
  it('shows matches once typing pauses, with their projects or "Unassigned" and due date', async () => {
    const { wrapper } = await mountSearch()
    await wrapper.find('input').setValue('REPORT')
    vi.advanceTimersByTime(150)
    await flushPromises()
    expect(wrapper.find('.results').exists()).toBe(false) // still typing

    vi.advanceTimersByTime(50)
    await flushPromises()
    const results = wrapper.findAll('.result')
    expect(results.map((r) => [r.find('.result-name span').text(), r.find('small').text()])).toEqual([
      ['Write report', 'Thesis · Website · Due 2026-11-02'],
      ['Rewrite report', 'Unassigned · No due date'],
    ])
    // The completed one is struck through and marked done
    expect(results.map((r) => [r.find('.struck').exists(), r.find('.tag').exists() && r.find('.tag').text()])).toEqual([
      [false, false],
      [true, '✓ done'],
    ])
  })

  it('opens a result on its task page, then clears the lookup', async () => {
    const { wrapper, router } = await mountSearch()
    await type(wrapper, 'book')
    const result = wrapper.find('.result')
    expect(result.attributes('href')).toBe('/tasks/Book%20room')

    await result.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('task')
    expect(router.currentRoute.value.params.id).toBe('Book room')
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('')
    expect(wrapper.find('.results').exists()).toBe(false)
  })

  it('says when nothing matches, and closes on Escape', async () => {
    const { wrapper } = await mountSearch()
    await type(wrapper, 'thesis')
    expect(wrapper.find('.results').text()).toContain('No tasks match "thesis".')
    expect(wrapper.find('.results [aria-live]').text()).toBe('0 tasks found')

    await wrapper.find('input').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.results').exists()).toBe(false)
  })
})
