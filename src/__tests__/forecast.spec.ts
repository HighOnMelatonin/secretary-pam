import { describe, it, expect } from 'vitest'
import { forecast, paceOf, type Forecast } from '../types/forecast'
import { prioritise } from '../types/priority'
import { createEmptyProject, type Project } from '../types/project'
import { DEFAULT_SETTINGS, type UserSettings } from '../types/settings'
import { ARCHIVE_TAG_ID } from '../types/tag'
import { createEmptyTask, type Task } from '../types/task'

// Monday. The default capacity is 8 hours Monday to Friday.
const MON = '2026-11-16'
const TUE = '2026-11-17'
const WED = '2026-11-18'
const THU = '2026-11-19'
const FRI = '2026-11-20'
const SAT = '2026-11-21'
const NEXT_MON = '2026-11-23'

const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id, name: `Task ${id}`, ...fields })
const project = (id: string, fields: Partial<Project> = {}): Project => ({ ...createEmptyProject(), id, name: `Project ${id}`, ...fields })
const hours = (h: number) => h * 60

const run = (tasks: Task[], projects: Project[] = [], settings: Partial<UserSettings> = {}, today = MON) =>
  forecast(tasks, projects, { ...DEFAULT_SETTINGS, ...settings }, today)
const finishOf = (result: Forecast, id: string) => result.tasks.find((t) => t.taskId === id)!.finish
const paceIn = (result: Forecast, id: string) => result.projects.find((p) => p.projectId === id)!

describe('the walk', () => {
  it("fills each day's hours in Suggested order, letting a task span days", () => {
    const result = run([task('a', { priority: 'urgent', effortMinutes: hours(10) }), task('b', { priority: 'low', effortMinutes: hours(4) })])
    expect(result.tasks.map((t) => [t.taskId, t.start, t.finish])).toEqual([
      ['a', MON, TUE],
      ['b', TUE, TUE],
    ])
    expect(result.todayPlan).toEqual([{ taskId: 'a', name: 'Task a', hours: 8, finishes: false }])
    expect(result.days.slice(0, 3).map((d) => d.plannedHours)).toEqual([8, 6, 0])
    expect(result.allDone).toBe(TUE)
  })

  it('skips days with no capacity', () => {
    expect(finishOf(run([task('a', { effortMinutes: hours(20) })]), 'a')).toBe(WED)
    expect(finishOf(run([task('a', { effortMinutes: hours(48) })]), 'a')).toBe(NEXT_MON)
  })

  it('counts the buffer', () => {
    expect(finishOf(run([task('a', { effortMinutes: hours(12) })], [], { buffer: 2 }), 'a')).toBe(WED)
  })

  it('waits for a start date, filling the time with other work', () => {
    const result = run([
      task('later', { priority: 'urgent', startDate: WED, effortMinutes: hours(4) }),
      task('now', { priority: 'low', effortMinutes: hours(12) }),
    ])
    expect(result.tasks.find((t) => t.taskId === 'later')).toMatchObject({ start: WED, finish: WED })
    expect(result.tasks.find((t) => t.taskId === 'now')).toMatchObject({ start: MON, finish: TUE })
  })

  it('waits for blockers, starting a task the day its blocker finishes, even if it ranks first', () => {
    // b is pinned, so it ranks before a, but a blocks it
    const result = run([
      task('a', { effortMinutes: hours(3), relations: [{ taskId: 'b', type: 'blocks' }] }),
      task('b', { pinnedDate: MON, effortMinutes: hours(3) }),
    ])
    expect(result.tasks.map((t) => t.taskId)).toEqual(['b', 'a'])
    // Today's plan is in the order the work happens
    expect(result.todayPlan).toEqual([
      { taskId: 'a', name: 'Task a', hours: 3, finishes: true },
      { taskId: 'b', name: 'Task b', hours: 3, finishes: true },
    ])
  })

  it('ignores the edges of blocking loops, so looped tasks still get done', () => {
    const result = run([
      task('a', { relations: [{ taskId: 'b', type: 'blocks' }] }),
      task('b', { relations: [{ taskId: 'a', type: 'blocks' }] }),
    ])
    expect([finishOf(result, 'a'), finishOf(result, 'b')]).toEqual([MON, MON])
  })

  it('leaves out the tasks prioritisation leaves out', () => {
    const archived = project('old', { tagIds: [ARCHIVE_TAG_ID], taskIds: ['archived'] })
    const result = run(
      [task('done', { completed: true }), task('archived'), task('google', { googleAccount: 'me@example.com' }), task('a')],
      [archived],
    )
    expect(result.tasks.map((t) => t.taskId)).toEqual(['a'])
    expect(result.totals.hours).toBe(2)
  })

  it('marks tasks projected to finish after their effective deadline', () => {
    const result = run([task('a', { dueDate: TUE, effortMinutes: hours(20) }), task('b', { dueDate: FRI })])
    expect(result.tasks.map((t) => [t.taskId, t.deadline, t.late])).toEqual([
      ['a', TUE, true],
      ['b', FRI, false],
    ])
  })

  it('uses the prioritisation it is given rather than working it out again', () => {
    const tasks = [task('a', { dueDate: WED }), task('b', { effortMinutes: 30 })]
    const settings = DEFAULT_SETTINGS
    expect(forecast(tasks, [], settings, MON, prioritise(tasks, [], settings, MON))).toEqual(forecast(tasks, [], settings, MON))
  })
})

describe('project pace', () => {
  const capacity = DEFAULT_SETTINGS.capacityMinutes

  it('is behind after delivery, tight with 0 or 1 working days left, and on pace with more', () => {
    expect(paceOf(capacity, NEXT_MON, FRI)).toBe('behind')
    expect(paceOf(capacity, FRI, FRI)).toBe('tight')
    expect(paceOf(capacity, THU, FRI)).toBe('tight')
    expect(paceOf(capacity, WED, FRI)).toBe('on_pace')
    // Delivered on a Saturday: finishing Friday leaves no working days, finishing Thursday one
    expect(paceOf(capacity, FRI, SAT)).toBe('tight')
    expect(paceOf(capacity, THU, SAT)).toBe('tight')
    expect(paceOf(capacity, WED, SAT)).toBe('on_pace')
  })

  it.each<[number, string, number, string, string]>([
    [24, WED, 2, 'on_pace', `"Project p" is on pace: it should finish ${WED}, 2 working days before delivery.`],
    [32, THU, 1, 'tight', `"Project p" is tight: it should finish ${THU}, 1 working day before delivery.`],
    [40, FRI, 0, 'tight', `"Project p" is tight: it should finish ${FRI}, on its delivery date.`],
    [48, NEXT_MON, -1, 'behind', `"Project p" is behind: it should finish ${NEXT_MON}, 1 working day after delivery.`],
  ])("gives a project with %s hours left by Friday its last task's finish and pace", (work, finish, left, pace, text) => {
    const p = project('p', { deliveryDate: FRI, taskIds: ['a', 'b'] })
    const result = run([task('a', { effortMinutes: hours(work - 4) }), task('b', { effortMinutes: hours(4) })], [p])
    expect(paceIn(result, 'p')).toEqual({
      projectId: 'p',
      name: 'Project p',
      deliveryDate: FRI,
      openHours: work,
      finish,
      workingDaysLeft: left,
      pace,
      paceReason: {
        code: 'pace',
        params: { projectId: 'p', project: 'Project p', pace, finish, deliveryDate: FRI, workingDaysLeft: left },
        text,
      },
    })
  })

  it('counts the work of other projects competing for the same time', () => {
    // On its own, p finishes Wednesday; the urgent project's work comes first and pushes it to Friday
    const p = project('p', { deliveryDate: FRI, taskIds: ['a'] })
    const urgent = project('u', { priority: 'urgent', taskIds: ['u1'] })
    const result = run([task('a', { effortMinutes: hours(24) }), task('u1', { effortMinutes: hours(16) })], [p, urgent])
    expect(paceIn(result, 'p')).toMatchObject({ finish: FRI, pace: 'tight' })
    expect(paceIn(run([task('a', { effortMinutes: hours(24) })], [p]), 'p').pace).toBe('on_pace')
  })

  it('has no pace without a delivery date or open work, and leaves out archived projects', () => {
    const result = run(
      [task('a'), task('done', { completed: true })],
      [
        project('undated', { taskIds: ['a'] }),
        project('empty', { deliveryDate: FRI, taskIds: ['done'] }),
        project('old', { deliveryDate: FRI, taskIds: ['a'], tagIds: [ARCHIVE_TAG_ID] }),
      ],
    )
    expect(result.projects.map((p) => [p.projectId, p.finish, p.pace])).toEqual([
      ['undated', MON, null],
      ['empty', null, null],
    ])
  })
})

describe('the next two weeks', () => {
  it('gives each of 14 days its capacity, planned hours and the work due', () => {
    const result = run([task('a', { dueDate: TUE, effortMinutes: hours(10) })])
    expect(result.days).toHaveLength(14)
    expect(result.days.slice(0, 7).map((d) => [d.date, d.capacityHours, d.plannedHours, d.dueHours])).toEqual([
      [MON, 8, 8, 0],
      [TUE, 8, 2, 10],
      [WED, 8, 0, 0],
      [THU, 8, 0, 0],
      [FRI, 8, 0, 0],
      [SAT, 0, 0, 0],
      ['2026-11-22', 0, 0, 0],
    ])
  })

  it('marks a day overbooked when more is due by its end than there is time for from today', () => {
    // 20 hours due Tuesday, with 16 hours to then; by Wednesday there are 24
    const result = run([task('a', { dueDate: TUE, effortMinutes: hours(20) })])
    expect(result.days.slice(0, 3).map((d) => d.overbooked)).toEqual([false, true, false])
  })

  it('counts overdue work as due today', () => {
    const result = run([task('a', { dueDate: '2026-11-13', effortMinutes: hours(9) })])
    expect(result.days[0]).toMatchObject({ dueHours: 9, overbooked: true })
    expect(result.days[1]!.overbooked).toBe(false)
  })
})

describe('totals and the brief', () => {
  it('adds up the work, the part from the 2-hour default and the part with no deadline', () => {
    const result = run([task('a'), task('b', { effortMinutes: hours(6) }), task('c', { dueDate: FRI, effortMinutes: 90 })])
    expect(result.totals).toEqual({ hours: 9.5, unestimatedHours: 2, noDeadlineHours: 8 })
  })

  it('sums up the day, the projects and the guesses in sentences, with their codes and values', () => {
    const p = project('p', { name: 'Thesis', deliveryDate: TUE, taskIds: ['a'] })
    const result = run([task('a', { dueDate: TUE }), task('b', { effortMinutes: hours(6) })], [p])
    expect(result.brief.parts).toEqual([
      { code: 'today_plan', params: { tasks: 2, hours: 8, capacityHours: 8 }, text: 'Today: 2 tasks, 8 h of 8 h.' },
      { code: 'projects_tight', params: { projects: ['Thesis'] }, text: '"Thesis" is tight.' },
      {
        code: 'assumptions',
        params: { hours: 8, unestimatedHours: 2, noDeadlineHours: 6 },
        text: 'Of 8 h of open work, 2 h come from the 2-hour default for tasks with no estimate, and 6 h have no deadline.',
      },
      { code: 'all_done', params: { date: MON }, text: `All of it is done by ${MON}.` },
    ])
    expect(result.brief.text).toBe(result.brief.parts.map((p) => p.text).join(' '))
  })

  it('names behind projects, overbooked days and late tasks', () => {
    const projects = [
      project('a', { name: 'Thesis', deliveryDate: MON, taskIds: ['x'] }),
      project('b', { name: 'Website', deliveryDate: MON, taskIds: ['y'] }),
    ]
    // 20 hours due today: x finishes Tuesday and y Wednesday
    const result = run([task('x', { dueDate: MON, effortMinutes: hours(10) }), task('y', { dueDate: MON, effortMinutes: hours(10) })], projects)
    expect(result.brief.parts.map((p) => p.text)).toEqual([
      'Today: 1 task, 8 h of 8 h.',
      '"Thesis" and "Website" are behind.',
      '2 of the next 14 days are overbooked.',
      '2 tasks are projected to finish after their deadline.',
      'Of 20 h of open work, none come from the 2-hour default for tasks with no estimate, and all of it has a deadline.',
      `All of it is done by ${WED}.`,
    ])
  })

  it('says when none of the work has a deadline', () => {
    expect(run([task('a')]).brief.parts.find((p) => p.code === 'assumptions')!.text).toBe(
      'Of 2 h of open work, 2 h come from the 2-hour default for tasks with no estimate, and none of it has a deadline.',
    )
  })

  it('says when today is a day off, or free, or there is no work at all', () => {
    expect(run([task('a')], [], {}, SAT).brief.parts[0]!.text).toBe('Today is a day off.')
    expect(run([task('a', { startDate: TUE })]).brief.parts[0]!.text).toBe('Nothing is planned for today.')
    expect(run([]).brief.text).toBe('Nothing is planned for today. There is no open work.')
  })
})

describe('determinism', () => {
  const projects = [project('p', { deliveryDate: FRI, priority: 'high', taskIds: ['a', 'b'] })]
  const tasks = [
    task('a', { effortMinutes: 150, relations: [{ taskId: 'b', type: 'blocks' }] }),
    task('b', { dueDate: THU, effortMinutes: hours(6) }),
    task('c', { dueDate: WED, priority: 'urgent' }),
    task('d', { startDate: TUE, effortMinutes: 45 }),
    task('e', { pinnedDate: MON }),
  ]

  it('gives the same result whatever order the tasks come in, as plain JSON', () => {
    const result = run(tasks, projects)
    expect(run([...tasks].reverse(), projects)).toEqual(result)
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })
})
