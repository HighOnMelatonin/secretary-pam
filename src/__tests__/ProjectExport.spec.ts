// The Export dialog on a project's page, as the app shows it: the dashboard at /projects/p over a fake API
import { afterEach, describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import Dashboard from '../components/dashboard.vue'
import { useProjectList } from '../stores/projectList'
import { useTaskList } from '../stores/taskList'
import { CSV_BOM } from '../types/export'
import { createEmptyProject, type Project } from '../types/project'
import { createEmptyTask, type Task } from '../types/task'
import { fakeApi } from './fakeApi'
import { button, routerAt } from './helpers'

const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id, name: id, ...fields })
const tasks = [
  task('t1', { name: 'Write report', dueDate: '2026-11-02', relations: [{ taskId: 't2', type: 'blocks' }] }),
  task('t2', { name: 'Review slides', completed: true }),
]
const projects: Project[] = [{ ...createEmptyProject(), id: 'p', name: 'Final Thesis', deliveryDate: '2026-12-01', taskIds: ['t1', 't2'] }]

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
const preview = (wrapper: Wrapper) => (wrapper.find('#export-preview').element as HTMLTextAreaElement).value
async function openExport(wrapper: Wrapper) {
  await button(wrapper, 'Export').trigger('click')
  await flushPromises()
}

// Stands in for the browser's clipboard
function stubClipboard(writeText: (text: string) => Promise<void>) {
  const spy = vi.fn(writeText)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: spy }, configurable: true })
  return spy
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'clipboard')
  document.body.innerHTML = ''
})

describe('ProjectExport', () => {
  it('opens from the Export button beside Edit, with Markdown and without completed tasks to start', async () => {
    const { wrapper } = await mountProjectPage()
    expect(wrapper.findAll('.page-header button').map((b) => b.text())).toEqual(['Edit', 'Export'])
    expect(wrapper.find('.export-dialog article').exists()).toBe(false)

    await openExport(wrapper)
    expect(wrapper.find('.export-dialog').attributes('open')).toBeDefined()
    expect(wrapper.find('#export-title').text()).toBe('Export Final Thesis')
    expect(wrapper.findAll('.format').map((f) => f.text())).toEqual([
      'Markdown Most readable; good for notes apps, GitHub, chat apps that render Markdown.',
      'Plain text Readable anywhere, no formatting symbols.',
      'CSV Open in Excel, Google Sheets or Numbers.',
      'JSON Structured data for other tools; the format a future Pam import would use.',
    ])
    expect(preview(wrapper)).toBe(
      '# Final Thesis\n\nDelivery date: 2026-12-01\n\n- [ ] Write report · Due 2026-11-02 · Priority: medium\n',
    )
  })

  it('updates the preview as the format and the completed toggle change', async () => {
    const { wrapper } = await mountProjectPage()
    await openExport(wrapper)

    await wrapper.find('input[role="switch"]').setValue(true)
    expect(preview(wrapper)).toContain('- [x] Review slides')

    await wrapper.find('input[value="text"]').setValue(true)
    expect(preview(wrapper)).toContain('[done] Review slides')

    await wrapper.find('input[value="csv"]').setValue(true)
    // (a textarea reports line breaks as \n; what's copied or saved keeps CSV's \r\n)
    expect(preview(wrapper).split('\n')[0]).toBe('project,project_delivery_date,task,due_date,priority,completed,description')
    expect(preview(wrapper).startsWith(CSV_BOM)).toBe(false) // the mark is only for downloads

    await wrapper.find('input[value="json"]').setValue(true)
    expect(JSON.parse(preview(wrapper)).tasks.map((t: Task) => t.name)).toEqual(['Write report', 'Review slides'])

    await wrapper.find('input[role="switch"]').setValue(false)
    expect(JSON.parse(preview(wrapper)).tasks.map((t: Task) => t.name)).toEqual(['Write report'])
  })

  it('copies the preview to the clipboard and says so', async () => {
    const writeText = stubClipboard(async () => {})
    const { wrapper } = await mountProjectPage()
    await openExport(wrapper)
    await wrapper.find('input[value="csv"]').setValue(true)

    await button(wrapper, 'Copy').trigger('click')
    await flushPromises()
    const copied = writeText.mock.calls[0]![0]
    expect(copied.split('\r\n')).toEqual([
      'project,project_delivery_date,task,due_date,priority,completed,description',
      'Final Thesis,2026-12-01,Write report,2026-11-02,medium,false,',
      '',
    ])
    expect(copied.replace(/\r\n/g, '\n')).toBe(preview(wrapper))
    expect(wrapper.find('[role="status"]').text()).toBe('Copied')
  })

  it('suggests Download when the clipboard refuses, or there is none', async () => {
    stubClipboard(async () => {
      throw new Error('Write permission denied')
    })
    const { wrapper } = await mountProjectPage()
    await openExport(wrapper)
    await button(wrapper, 'Copy').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toBe(
      "Couldn't copy to the clipboard (Write permission denied). Use Download instead.",
    )

    Reflect.deleteProperty(navigator, 'clipboard')
    await button(wrapper, 'Copy').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain("this browser doesn't allow it")
  })

  it('downloads a file named for the project and today, with its MIME type, then frees it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
    vi.setSystemTime(new Date(2026, 10, 2, 9))
    const blobs: Blob[] = []
    const createObjectURL = vi.fn((blob: Blob) => (blobs.push(blob), 'blob:export'))
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this)
    })

    const { wrapper } = await mountProjectPage()
    await openExport(wrapper)
    await wrapper.find('input[value="csv"]').setValue(true)
    await button(wrapper, 'Download').trigger('click')

    expect(clicked.map((a) => [a.download, a.getAttribute('href')])).toEqual([['final-thesis-tasks-2026-11-02.csv', 'blob:export']])
    expect(blobs[0]!.type).toBe('text/csv;charset=utf-8')
    // Starts with the UTF-8 byte order mark, for Excel (Blob.text() would drop it, so check the bytes)
    expect([...new Uint8Array(await blobs[0]!.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(document.querySelector('a[download]')).toBeNull() // the link was only temporary
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:export')
    vi.useRealTimers()
  })

  it('closes on Escape, Close or the backdrop, giving focus back to Export', async () => {
    const { wrapper } = await mountProjectPage()
    await openExport(wrapper)
    await wrapper.find('.export-dialog').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.export-dialog article').exists()).toBe(false)
    expect(wrapper.find('.export-dialog').attributes('open')).toBeUndefined()
    expect(document.activeElement?.textContent).toBe('Export')

    await openExport(wrapper)
    await button(wrapper, 'Close').trigger('click')
    expect(wrapper.find('.export-dialog article').exists()).toBe(false)

    await openExport(wrapper)
    await wrapper.find('.export-dialog').trigger('click')
    expect(wrapper.find('.export-dialog article').exists()).toBe(false)
  })

  it("doesn't change the stores or write to the API", async () => {
    stubClipboard(async () => {})
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }))
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const { api, wrapper } = await mountProjectPage()
    const snapshot = () =>
      JSON.parse(JSON.stringify({ tasks: useTaskList().tasks, projects: useProjectList().projects, data: api.data }))
    const before = snapshot()

    await openExport(wrapper)
    for (const id of ['markdown', 'text', 'csv', 'json']) {
      await wrapper.find(`input[value="${id}"]`).setValue(true)
      await wrapper.find('input[role="switch"]').setValue(true)
      await button(wrapper, 'Copy').trigger('click')
      await button(wrapper, 'Download').trigger('click')
    }
    await flushPromises()

    expect(api.requests).toEqual([])
    expect(snapshot()).toEqual(before)
  })
})
