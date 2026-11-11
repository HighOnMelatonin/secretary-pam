// The Import dialog on a project's page, as the app shows it: the dashboard at /projects/p over a fake API
import { afterEach, describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import Dashboard from '../components/dashboard.vue'
import { useProjectList } from '../stores/projectList'
import { useTaskList } from '../stores/taskList'
import { exportRows, toJson } from '../types/export'
import { createEmptyProject, type Project } from '../types/project'
import { createEmptyTask, type Task } from '../types/task'
import { fakeApi } from './fakeApi'
import { button, routerAt } from './helpers'

const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id, name: id, ...fields })
const tasks = [
  task('t1', { name: 'Write report', dueDate: '2026-11-02', relations: [{ taskId: 't2', type: 'blocks' }] }),
  task('t2', { name: 'Review slides' }),
  task('t3', { name: 'Book room' }),
]
const projects: Project[] = [
  { ...createEmptyProject(), id: 'p', name: 'Final Thesis', deliveryDate: '2026-12-01', taskIds: ['t1', 't2', 't3'] },
]

// An export of the project as someone changed it: t1 is done and due later, "review slides" (no
// id, so matched by name) is urgent, t3 is as it is, and there's a new task
const exported = (overrides: Record<string, unknown>[] = []) =>
  JSON.stringify({
    format: 'pam-project-export',
    version: 1,
    exportedAt: '2026-11-02T09:00:00.000Z',
    project: { name: 'Final Thesis', deliveryDate: '2026-12-01' },
    tasks: [
      { id: 't1', name: 'Write report', dueDate: '2026-11-20', priority: 'medium', completed: true, description: '' },
      { name: 'review slides', priority: 'urgent' },
      { id: 't3', name: 'Book room', dueDate: null, priority: 'medium', completed: false, description: '' },
      { id: 'n1', name: 'Print copies', dueDate: '2026-11-30', priority: 'low', completed: false, description: 'Two' },
      ...overrides,
    ],
  })

async function mountProjectPage() {
  const api = fakeApi({ tasks, projects })
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(Dashboard, { global: { plugins: [pinia, await routerAt('/projects/p')] }, attachTo: document.body })
  await flushPromises()
  api.requests.length = 0
  return { api, wrapper }
}

type Wrapper = Awaited<ReturnType<typeof mountProjectPage>>['wrapper']

async function pasteAndReview(wrapper: Wrapper, text: string) {
  await button(wrapper, 'Import').trigger('click')
  await flushPromises()
  await wrapper.find('#import-text').setValue(text)
  await button(wrapper, 'Review import').trigger('click')
}

const dialogButton = (wrapper: Wrapper, text: string) => {
  const found = wrapper.findAll('.import-dialog button').find((b) => b.text() === text)
  if (!found) throw new Error(`No button "${text}" in the dialog`)
  return found
}
const duplicates = (wrapper: Wrapper) => wrapper.findAll('.duplicate')
const rows = (wrapper: Wrapper, i: number) =>
  duplicates(wrapper)[i]!.findAll('tbody tr').map((tr) => tr.findAll('th, td').map((c) => c.text()))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('ProjectImport', () => {
  it('lists the new tasks and asks which version to keep of each changed duplicate', async () => {
    const { wrapper } = await mountProjectPage()
    await pasteAndReview(wrapper, exported())

    expect(wrapper.find('#import-title').text()).toBe('Import into Final Thesis')
    expect(wrapper.find('.source').text()).toBe('From an export of “Final Thesis”')
    expect(wrapper.findAll('.summary li').map((li) => li.text())).toEqual([
      '1 new task to add',
      '2 duplicates to choose between',
      '1 already in the project as they are, left alone',
    ])
    expect(wrapper.find('.added').text()).toBe('Print copies · Due 2026-11-30 · low')

    expect(duplicates(wrapper).map((d) => d.find('legend').text())).toEqual(['Write report', 'Review slides same name'])
    expect(rows(wrapper, 0)).toEqual([
      ['Due date', '2026-11-02', '2026-11-20'],
      ['Status', 'Not done', 'Done'],
    ])
    expect(rows(wrapper, 1)).toEqual([
      ['Name', 'Review slides', 'review slides'],
      ['Priority', 'medium', 'urgent'],
    ])

    // Nothing is chosen for you
    expect(dialogButton(wrapper, 'Import').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.undecided').text()).toBe('Choose a version for 2 more duplicates.')
  })

  it('saves the new tasks and the chosen versions in one request, keeping relations', async () => {
    const { api, wrapper } = await mountProjectPage()
    await pasteAndReview(wrapper, exported())

    await duplicates(wrapper)[0]!.find('input[value="imported"]').setValue(true)
    expect(wrapper.find('.undecided').text()).toBe('Choose a version for 1 more duplicate.')
    await duplicates(wrapper)[1]!.find('input[value="current"]').setValue(true)
    await dialogButton(wrapper, 'Import').trigger('click')
    await flushPromises()

    expect(api.requests).toEqual(['POST /api/projects/p/import'])
    expect(wrapper.find('.done').text()).toBe('Added 1 new task and updated 1 task.')
    const t1 = { ...tasks[0]!, dueDate: '2026-11-20', completed: true }
    const n1 = task('n1', { name: 'Print copies', dueDate: '2026-11-30', priority: 'low', description: 'Two' })
    expect(api.data.tasks).toEqual([t1, tasks[1], tasks[2], n1])
    expect(api.data.projects[0]!.taskIds).toEqual(['t1', 't2', 't3', 'n1'])
    // and the page shows it
    expect(useTaskList().tasks).toEqual(api.data.tasks)
    expect(useProjectList().projects).toEqual(api.data.projects)
    expect(wrapper.find('.progress small').text()).toBe('1 of 4 tasks completed')

    await dialogButton(wrapper, 'Done').trigger('click')
    expect(wrapper.find('.import-dialog article').exists()).toBe(false)
    expect(document.activeElement?.textContent).toBe('Import')
  })

  it('chooses every duplicate at once', async () => {
    const { api, wrapper } = await mountProjectPage()
    await pasteAndReview(wrapper, exported())
    await dialogButton(wrapper, 'Use all imported').trigger('click')
    expect(duplicates(wrapper).map((d) => (d.find('input[value="imported"]').element as HTMLInputElement).checked)).toEqual([true, true])

    await dialogButton(wrapper, 'Keep all current').trigger('click')
    await dialogButton(wrapper, 'Import').trigger('click')
    await flushPromises()
    expect(wrapper.find('.done').text()).toBe('Added 1 new task.')
    expect(api.data.tasks.slice(0, 3)).toEqual(tasks)
  })

  it('saves nothing when every duplicate keeps its current version and nothing is new', async () => {
    const { api, wrapper } = await mountProjectPage()
    await pasteAndReview(wrapper, JSON.stringify({ format: 'pam-project-export', version: 1, tasks: [{ id: 't1', name: 'Renamed' }] }))
    await dialogButton(wrapper, 'Keep all current').trigger('click')
    await dialogButton(wrapper, 'Import').trigger('click')
    await flushPromises()
    expect(wrapper.find('.done').text()).toBe('Nothing changed: you kept the current version of every duplicate.')
    expect(api.requests).toEqual([])
  })

  it('says there is nothing to import when every task is already there as it is', async () => {
    const { api, wrapper } = await mountProjectPage()
    const same = toJson(exportRows(projects[0]!, tasks, { includeCompleted: true }), { exportedAt: '2026-11-02T09:00:00.000Z' })
    await pasteAndReview(wrapper, same)
    expect(wrapper.find('.summary').text()).toBe('Every task in this export is already in the project as it is. Nothing to import.')
    expect(dialogButton(wrapper, 'Import').attributes('disabled')).toBeDefined()
    expect(api.requests).toEqual([])
  })

  it("says what's wrong with a file it can't read, and stays on the first step", async () => {
    const { api, wrapper } = await mountProjectPage()
    await pasteAndReview(wrapper, JSON.stringify({ format: 'pam-project-export', version: 1, tasks: [{ name: 'A', priority: 'asap' }] }))
    expect(wrapper.find('[role="alert"]').text()).toBe('Task 1: "A" has a priority that isn\'t one of low, medium, high, urgent.')
    expect(wrapper.find('#import-text').exists()).toBe(true)
    expect(api.requests).toEqual([])
  })

  it('reviews a chosen file straight away', async () => {
    const { wrapper } = await mountProjectPage()
    await button(wrapper, 'Import').trigger('click')
    await flushPromises()
    const input = wrapper.find('#import-file')
    Object.defineProperty(input.element, 'files', { value: [new File([exported()], 'thesis.json', { type: 'application/json' })] })
    await input.trigger('change')
    await flushPromises()
    expect(wrapper.findAll('.summary li').map((li) => li.text())[0]).toBe('1 new task to add')

    // Back keeps the text, to fix it by hand
    await dialogButton(wrapper, 'Back').trigger('click')
    expect((wrapper.find('#import-text').element as HTMLTextAreaElement).value).toBe(exported())
  })

  it('shows a refused import in the dialog, with the choices kept to change, and saves none of it', async () => {
    const { api, wrapper } = await mountProjectPage()
    // A new task due after the project's delivery date
    await pasteAndReview(wrapper, exported([{ name: 'Too late', dueDate: '2026-12-20' }]))
    await dialogButton(wrapper, 'Use all imported').trigger('click')
    await dialogButton(wrapper, 'Import').trigger('click')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').text()).toBe(
      `Couldn't import: "Too late" is due 2026-12-20, after "Final Thesis"'s delivery date (2026-12-01)`,
    )
    expect(duplicates(wrapper)).toHaveLength(2)
    expect(api.data.tasks).toEqual(tasks)
    expect(api.data.projects).toEqual(projects)
  })
})
