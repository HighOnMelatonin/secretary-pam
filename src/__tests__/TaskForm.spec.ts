import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TaskForm from '../components/task.vue'
import { createEmptyProject, type Project } from '../types/project'
import { createEmptyTask, type Task } from '../types/task'
import { button, listedIn, selectWithOption } from './helpers'

const task: Task = { ...createEmptyTask(), id: 't1', name: 'Write report' }
const otherTasks = [
  { id: 't1', name: 'Write report' },
  { id: 't2', name: 'Review slides' },
  { id: 't3', name: 'Book room' },
]
const project = (id: string, name: string, taskIds: string[] = []): Project => ({
  ...createEmptyProject(),
  id,
  name,
  taskIds,
})
const projects = [project('p1', 'Thesis', ['t1']), project('p2', 'Website')]

const saved = (wrapper: ReturnType<typeof mount>) =>
  wrapper.emitted<[Task, string[], Record<string, string>]>('save')?.slice(-1)[0]
const dateInput = (wrapper: ReturnType<typeof mount>) => wrapper.find<HTMLInputElement>('input[type="date"]')

describe('TaskForm for a new task', () => {
  it('only allows adding once the task has a name', async () => {
    const wrapper = mount(TaskForm)
    expect(button(wrapper, 'Add').attributes('disabled')).toBeDefined()
    await wrapper.find('input[placeholder="Task"]').setValue('Write report')
    expect(button(wrapper, 'Add').attributes('disabled')).toBeUndefined()
  })

  it('emits the filled-in task with a trimmed name, then clears the form', async () => {
    const wrapper = mount(TaskForm)
    await wrapper.find('input[placeholder="Task"]').setValue('  Write report ')
    await wrapper.find('input[type="date"]').setValue('2026-11-02')
    await wrapper.find('select').setValue('high')
    await wrapper.find('textarea').setValue('Chapter 3')
    await wrapper.find('input[type="checkbox"]').setValue(true)
    await wrapper.find('form').trigger('submit')

    expect(saved(wrapper)).toEqual([
      {
        id: expect.any(String),
        name: 'Write report',
        description: 'Chapter 3',
        dueDate: '2026-11-02',
        relations: [],
        priority: 'high',
        completed: true,
      },
      [],
      {},
    ])
    expect((wrapper.find('input[placeholder="Task"]').element as HTMLInputElement).value).toBe('')
  })
})

describe('TaskForm project assignment', () => {
  it('shows the projects the task is already in', () => {
    const wrapper = mount(TaskForm, { props: { task, projects } })
    expect(listedIn(wrapper, 'Projects')).toEqual(['Thesis'])
    expect(selectWithOption(wrapper, 'p2').exists()).toBe(true)
  })

  it('emits the chosen project ids on save', async () => {
    const wrapper = mount(TaskForm, { props: { task, projects } })

    await wrapper.find('li button').trigger('click') // remove Thesis
    await selectWithOption(wrapper, 'p2').setValue('p2')
    await button(wrapper, 'Assign').trigger('click')
    await wrapper.find('form').trigger('submit')

    expect(saved(wrapper)?.[1]).toEqual(['p2'])
  })

  it('assigns a project left picked in the dropdown when the task is added, without Assign', async () => {
    const wrapper = mount(TaskForm, { props: { projects } })
    const picker = selectWithOption(wrapper, 'p2')
    expect(picker.element.value).toBe('') // starts on "Add to project…", so untouched means unassigned
    expect(picker.find('option[value=""]').text()).toBe('Add to project…')

    await wrapper.find('input[placeholder="Task"]').setValue('Write report')
    await picker.setValue('p2')
    await wrapper.find('form').trigger('submit')

    expect(saved(wrapper)?.[1]).toEqual(['p2'])
  })

  it('uses projectIds over the projects when given, e.g. to restore an unsaved choice', () => {
    const wrapper = mount(TaskForm, { props: { task, projects, projectIds: ['p2'] } })
    expect(listedIn(wrapper, 'Projects')).toEqual(['Website'])
  })

  it('starts a new task in no projects', () => {
    const wrapper = mount(TaskForm, { props: { projects } })
    expect(listedIn(wrapper, 'Projects')).toEqual([])
    expect(wrapper.text()).toContain('Not in any project.')
  })
})

describe("TaskForm checks the due date against its projects' deadlines", () => {
  const dated = [
    { ...project('p1', 'Thesis', ['t1']), deliveryDate: '2026-11-30' },
    { ...project('p2', 'Website'), deliveryDate: '2026-11-30' },
  ]

  it('blocks assigning a project due before the task, but only once both dates are set', async () => {
    const wrapper = mount(TaskForm, { props: { projects: dated } })
    await selectWithOption(wrapper, 'p2').setValue('p2')
    expect(wrapper.find('.date-error').exists()).toBe(false)
    expect(button(wrapper, 'Assign').attributes('disabled')).toBeUndefined()

    await dateInput(wrapper).setValue('2026-12-05')
    expect(wrapper.find('.date-error').text()).toContain(
      "This task is due 2026-12-05, after Website's deadline (2026-11-30).",
    )
    expect(button(wrapper, 'Assign').attributes('disabled')).toBeDefined()

    await button(wrapper, 'Move task to 2026-11-30').trigger('click')
    expect(dateInput(wrapper).element.value).toBe('2026-11-30')
    expect(wrapper.find('.date-error').exists()).toBe(false)
    expect(button(wrapper, 'Assign').attributes('disabled')).toBeUndefined()
  })

  it("extends the project's deadline when the task is saved", async () => {
    const wrapper = mount(TaskForm, { props: { task: { ...task, dueDate: '2026-12-05' }, projects: [{ ...project('p2', 'Website'), deliveryDate: '2026-11-30' }] } })
    await selectWithOption(wrapper, 'p2').setValue('p2')
    await button(wrapper, 'Extend Website to 2026-12-05').trigger('click')
    expect(wrapper.find('.date-error').exists()).toBe(false)

    await button(wrapper, 'Assign').trigger('click')
    expect(listedIn(wrapper, 'Projects')).toEqual(['Website deadline extends to 2026-12-05'])
    await wrapper.find('form').trigger('submit')
    expect(saved(wrapper)?.slice(1)).toEqual([['p2'], { p2: '2026-12-05' }])
  })

  it('blocks saving while the due date is after a project the task is in', async () => {
    const wrapper = mount(TaskForm, { props: { task, projects: dated } })
    await dateInput(wrapper).setValue('2026-12-01')
    expect(wrapper.find('.date-error').text()).toContain("after Thesis's deadline (2026-11-30)")
    expect(button(wrapper, 'Save').attributes('disabled')).toBeDefined()
    await wrapper.find('form').trigger('submit')
    expect(saved(wrapper)).toBeUndefined()

    // Clearing the due date leaves nothing to check
    await dateInput(wrapper).setValue('')
    expect(wrapper.find('.date-error').exists()).toBe(false)
    expect(button(wrapper, 'Save').attributes('disabled')).toBeUndefined()
  })

  it('drops the clash, and any extension, when the project is removed', async () => {
    const wrapper = mount(TaskForm, { props: { task: { ...task, dueDate: '2026-12-01' }, projects: dated } })
    await button(wrapper, 'Extend Thesis to 2026-12-01').trigger('click')
    await wrapper.find('li button').trigger('click') // remove Thesis
    await wrapper.find('form').trigger('submit')
    expect(saved(wrapper)?.slice(1)).toEqual([[], {}])
  })
})

describe('TaskForm relations', () => {
  it('links other tasks with a relation type, but never the task itself', async () => {
    const wrapper = mount(TaskForm, { props: { task, availableTasks: otherTasks } })
    expect(selectWithOption(wrapper, 't2').find('option[value="t1"]').exists()).toBe(false)

    await selectWithOption(wrapper, 'blocks').setValue('blocks')
    await selectWithOption(wrapper, 't2').setValue('t2')
    await button(wrapper, 'Link').trigger('click')

    expect(listedIn(wrapper, 'Related tasks')).toEqual(['blocks: Review slides'])
    // A task can only be related once
    expect(selectWithOption(wrapper, 't3').find('option[value="t2"]').exists()).toBe(false)

    await wrapper.find('form').trigger('submit')
    expect(saved(wrapper)?.[0].relations).toEqual([{ taskId: 't2', type: 'blocks' }])
  })

  it('leaves completed tasks out of the related task menu, but keeps relations already made to them', () => {
    const tasks = [...otherTasks, { id: 't4', name: 'Print poster', completed: true }]
    const newTask = mount(TaskForm, { props: { availableTasks: tasks } })
    expect(selectWithOption(newTask, 't2').findAll('option').map((o) => o.text())).toEqual([
      'Select task',
      'Write report',
      'Review slides',
      'Book room',
    ])

    const linked = mount(TaskForm, {
      props: { task: { ...task, relations: [{ taskId: 't4', type: 'blocked_by' }] }, availableTasks: tasks },
    })
    expect(listedIn(linked, 'Related tasks')).toEqual(['blocked by: Print poster'])
    expect(selectWithOption(linked, 't2').find('option[value="t4"]').exists()).toBe(false)
  })

  it('names related tasks, falling back to the id for unknown ones', () => {
    const wrapper = mount(TaskForm, {
      props: {
        task: { ...task, relations: [{ taskId: 't2', type: 'blocked_by' }, { taskId: 'gone', type: 'related_to' }] },
        availableTasks: otherTasks,
      },
    })
    expect(listedIn(wrapper, 'Related tasks')).toEqual(['blocked by: Review slides', 'related to: gone'])
  })

  it('removes a relation', async () => {
    const wrapper = mount(TaskForm, {
      props: { task: { ...task, relations: [{ taskId: 't2', type: 'blocks' }] }, availableTasks: otherTasks },
    })
    const relations = wrapper.findAll('fieldset')[1]!
    await relations.find('li button').trigger('click')
    expect(listedIn(wrapper, 'Related tasks')).toEqual([])
  })
})

describe('TaskForm for an existing task', () => {
  it('does not change the original until saved', async () => {
    const original = structuredClone(task)
    const wrapper = mount(TaskForm, { props: { task, projects } })
    expect(button(wrapper, 'Save').exists()).toBe(true)

    await wrapper.find('input[placeholder="Task"]').setValue('Renamed')
    await wrapper.find('input[type="checkbox"]').setValue(true)
    expect(task).toEqual(original)

    await wrapper.find('form').trigger('submit')
    expect(saved(wrapper)?.[0]).toMatchObject({ id: 't1', name: 'Renamed', completed: true })
  })

  it('discards edits, including project changes, and emits cancel', async () => {
    const wrapper = mount(TaskForm, { props: { task, projects } })
    await wrapper.find('input[placeholder="Task"]').setValue('Renamed')
    await wrapper.find('li button').trigger('click') // remove Thesis
    await button(wrapper, 'Cancel').trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect((wrapper.find('input[placeholder="Task"]').element as HTMLInputElement).value).toBe('Write report')
    expect(listedIn(wrapper, 'Projects')).toEqual(['Thesis'])
  })
})

describe('TaskForm scheduling', () => {
  // 2026-11-16 is a Monday; the default capacity is 8 hours Monday to Friday
  const today = '2026-11-16'
  const estimateInput = (wrapper: ReturnType<typeof mount>) => wrapper.find<HTMLInputElement>('input[inputmode="decimal"]')
  const startInput = (wrapper: ReturnType<typeof mount>) => wrapper.findAll<HTMLInputElement>('input[type="date"]')[1]!
  const alerts = (wrapper: ReturnType<typeof mount>) => wrapper.findAll('[role="alert"]').map((a) => a.text())
  const warning = (wrapper: ReturnType<typeof mount>) => wrapper.find('.capacity-warning')

  it('saves the estimate in minutes and the start date', async () => {
    const wrapper = mount(TaskForm, { props: { task, today } })
    await estimateInput(wrapper).setValue('1.5')
    await startInput(wrapper).setValue('2026-11-18')
    await wrapper.find('form').trigger('submit')
    expect(saved(wrapper)![0]).toEqual({ ...task, effortMinutes: 90, startDate: '2026-11-18' })
  })

  it('shows a saved estimate in hours, and leaves both fields out once cleared', async () => {
    const scheduled = { ...task, effortMinutes: 20, startDate: '2026-11-18', pinnedDate: '2026-11-16' }
    const wrapper = mount(TaskForm, { props: { task: scheduled, today } })
    expect(estimateInput(wrapper).element.value).toBe('0.33')
    expect(startInput(wrapper).element.value).toBe('2026-11-18')

    await wrapper.find('form').trigger('submit')
    expect(saved(wrapper)![0]).toEqual(scheduled)

    await estimateInput(wrapper).setValue('')
    await startInput(wrapper).setValue('')
    await wrapper.find('form').trigger('submit')
    // The pinned date isn't in the form, and is kept
    expect(saved(wrapper)![0]).toEqual({ ...task, pinnedDate: '2026-11-16' })
  })

  it('takes a decimal comma, as some phone keyboards only have that', async () => {
    const wrapper = mount(TaskForm, { props: { task, today } })
    await estimateInput(wrapper).setValue('0,5')
    await wrapper.find('form').trigger('submit')
    expect(saved(wrapper)![0]).toEqual({ ...task, effortMinutes: 30 })
  })

  it.each(['abc', '0', '-1', '1000.1', '1,5,0'])('blocks saving an estimate of %s hours', async (value) => {
    const wrapper = mount(TaskForm, { props: { task, today } })
    await estimateInput(wrapper).setValue(value)
    expect(alerts(wrapper)).toEqual(['Enter the estimate in hours: more than 0 and at most 1000.'])
    expect(button(wrapper, 'Save').attributes('disabled')).toBeDefined()
  })

  it('blocks saving while the start date is after the due date', async () => {
    const wrapper = mount(TaskForm, { props: { task: { ...task, dueDate: '2026-11-20' }, today } })
    await startInput(wrapper).setValue('2026-11-21')
    expect(alerts(wrapper)).toEqual(['The start date is after the due date. Move one of them.'])
    expect(button(wrapper, 'Save').attributes('disabled')).toBeDefined()

    await startInput(wrapper).setValue('2026-11-20')
    expect(alerts(wrapper)).toEqual([])
    expect(button(wrapper, 'Save').attributes('disabled')).toBeUndefined()
  })

  it('warns, without blocking, when the estimate is more than the working time before the due date', async () => {
    // Monday to Wednesday is 24 hours
    const wrapper = mount(TaskForm, { props: { task: { ...task, dueDate: '2026-11-18' }, today } })
    await estimateInput(wrapper).setValue('24')
    expect(warning(wrapper).exists()).toBe(false)

    await estimateInput(wrapper).setValue('25')
    expect(warning(wrapper).text()).toBe(
      'Only 24 h of working time from today to the due date, less than this estimate. You can still save it.',
    )
    expect(button(wrapper, 'Save').attributes('disabled')).toBeUndefined()

    // From the start date when it's later than today
    await startInput(wrapper).setValue('2026-11-18')
    expect(warning(wrapper).text()).toContain('Only 8 h of working time from 2026-11-18 to the due date')
  })

  it('uses the capacity it is given, and says when there is no time left at all', async () => {
    const capacity = { mon: 120, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 }
    const wrapper = mount(TaskForm, { props: { task: { ...task, dueDate: '2026-11-18' }, today, capacity } })
    await estimateInput(wrapper).setValue('3')
    expect(warning(wrapper).text()).toContain('Only 2 h of working time from today')

    await wrapper.setProps({ task: { ...task, dueDate: '2026-11-13', effortMinutes: 60 } })
    expect(warning(wrapper).text()).toBe(
      "There's no working time left from today to the due date, so this estimate won't fit. You can still save it.",
    )
  })

  it('gives no warning without a due date or an estimate', async () => {
    const wrapper = mount(TaskForm, { props: { task: { ...task, effortMinutes: 6000 }, today } })
    expect(warning(wrapper).exists()).toBe(false)
    await wrapper.setProps({ task: { ...task, dueDate: '2026-11-16' } })
    expect(warning(wrapper).exists()).toBe(false)
  })
})

describe('TaskForm blocking loops', () => {
  // t2 blocks t3, stored on t3 as blocked by
  const others = [
    { id: 't1', name: 'Write report', relations: [] },
    { id: 't2', name: 'Review slides', relations: [] },
    { id: 't3', name: 'Book room', relations: [{ taskId: 't2', type: 'blocked_by' as const }] },
  ]

  it('blocks saving relations that would make a loop, naming the tasks in it', async () => {
    const editing = { ...task, relations: [{ taskId: 't2', type: 'blocks' as const }] }
    const wrapper = mount(TaskForm, { props: { task: editing, availableTasks: others } })
    await selectWithOption(wrapper, 'blocked_by').setValue('blocked_by')
    await selectWithOption(wrapper, 't3').setValue('t3')

    // Picked but not linked yet still counts, since saving links it
    const message =
      'This would make a loop of blocking tasks: "Book room" blocks "Write report", which blocks "Review slides", ' +
      'which blocks "Book room". Remove one of these relations.'
    expect(wrapper.find('[role="alert"]').text()).toBe(message)
    expect(button(wrapper, 'Save').attributes('disabled')).toBeDefined()

    await button(wrapper, 'Link').trigger('click')
    expect(wrapper.find('[role="alert"]').text()).toBe(message)

    await wrapper.findAll('li').find((li) => li.text().startsWith('blocks'))!.find('button').trigger('click')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(button(wrapper, 'Save').attributes('disabled')).toBeUndefined()
  })

  it('lets a task already in a loop be saved as long as no new loop is made', async () => {
    const looped = [
      { id: 't1', name: 'Write report', relations: [{ taskId: 't2', type: 'blocks' as const }] },
      { id: 't2', name: 'Review slides', relations: [{ taskId: 't1', type: 'blocks' as const }] },
    ]
    const wrapper = mount(TaskForm, { props: { task: { ...task, relations: looped[0]!.relations }, availableTasks: looped } })
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    await wrapper.find('form').trigger('submit')
    expect(saved(wrapper)).toBeDefined()
  })
})
