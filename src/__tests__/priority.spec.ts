import { describe, it, expect } from 'vitest'
import { CATEGORY_LABELS, isExcluded, prioritise, type Priorities, type ScoredTask } from '../types/priority'
import { createEmptyProject, type Project } from '../types/project'
import { blockLoops } from '../types/rules'
import { DEFAULT_SETTINGS, latestStartFor, previousWorkingDay, workingDaysBetween, type UserSettings } from '../types/settings'
import { ARCHIVE_TAG_ID } from '../types/tag'
import { createEmptyTask, type Task } from '../types/task'

// Monday. The default capacity is 8 hours Monday to Friday, so Monday to Wednesday is 24 hours.
const TODAY = '2026-11-16'
const MON = TODAY
const TUE = '2026-11-17'
const WED = '2026-11-18'
const THU = '2026-11-19'
const FRI = '2026-11-20'

const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id, name: `Task ${id}`, ...fields })
const project = (id: string, fields: Partial<Project> = {}): Project => ({
  ...createEmptyProject(),
  id,
  name: `Project ${id}`,
  ...fields,
})
const hours = (h: number) => h * 60
const blocks = (...ids: string[]) => ids.map((taskId) => ({ taskId, type: 'blocks' as const }))

const run = (tasks: Task[], projects: Project[] = [], settings: Partial<UserSettings> = {}, today = TODAY) =>
  prioritise(tasks, projects, { ...DEFAULT_SETTINGS, ...settings }, today)
const scoredIn = (result: Priorities, id: string): ScoredTask => {
  const found = result.tasks.find((t) => t.taskId === id)
  if (!found) throw new Error(`${id} was not scored`)
  return found
}
const one = (t: Task, projects: Project[] = [], settings: Partial<UserSettings> = {}) => scoredIn(run([t], projects, settings), t.id)

describe('capacity helpers', () => {
  const capacity = DEFAULT_SETTINGS.capacityMinutes

  it('counts working days after a day, up to and including another', () => {
    expect(workingDaysBetween(capacity, MON, MON)).toBe(0)
    expect(workingDaysBetween(capacity, MON, WED)).toBe(2)
    expect(workingDaysBetween(capacity, FRI, '2026-11-23')).toBe(1) // over the weekend
    expect(workingDaysBetween(capacity, WED, MON)).toBe(0)
  })

  it('finds the working day before a day, over weekends', () => {
    expect(previousWorkingDay(capacity, WED)).toBe(TUE)
    expect(previousWorkingDay(capacity, MON)).toBe('2026-11-13')
  })

  it('finds the latest start that still fits the work in by the deadline', () => {
    expect(latestStartFor(capacity, hours(8), WED)).toBe(WED)
    expect(latestStartFor(capacity, hours(8.5), WED)).toBe(TUE)
    expect(latestStartFor(capacity, hours(16), '2026-11-23')).toBe(FRI) // Monday, then Friday
    // 200 hours is 25 working days: five whole weeks back from Friday ends on Monday 2026-10-19
    expect(latestStartFor(capacity, hours(200), FRI)).toBe('2026-10-19')
    expect(latestStartFor({ ...capacity, mon: 0, tue: 0, wed: 0, thu: 0, fri: 0 }, 60, FRI)).toBeNull()
  })
})

describe('which tasks are scored', () => {
  it('leaves out completed tasks, tasks only in archived projects, and unestimated Google imports', () => {
    const archived = project('old', { tagIds: [ARCHIVE_TAG_ID], taskIds: ['archived', 'both'] })
    const current = project('now', { taskIds: ['both'] })
    const tasks = [
      task('done', { completed: true }),
      task('archived'),
      task('both'),
      task('google', { googleAccount: 'me@example.com' }),
      task('estimated', { googleAccount: 'me@example.com', effortMinutes: 30 }),
      task('plain'),
    ]
    expect(tasks.filter((t) => isExcluded(t, [archived, current])).map((t) => t.id)).toEqual(['done', 'archived', 'google'])
    expect(run(tasks, [archived, current]).tasks.map((t) => t.taskId).sort()).toEqual(['both', 'estimated', 'plain'])
  })

  it('leaves excluded tasks out of every total', () => {
    // The completed task would otherwise add to the project's work and what a unblocks
    const p = project('p', { deliveryDate: FRI, taskIds: ['a', 'b', 'done'] })
    const tasks = [task('a', { relations: blocks('b', 'done') }), task('b'), task('done', { completed: true, effortMinutes: hours(30) })]
    const a = scoredIn(run(tasks, [p]), 'a')
    expect(a.factors.unlockedHours).toBe(2)
    expect(a.factors.R).toBe(0.1) // 4 hours of 40
  })
})

describe('factors', () => {
  it('scores a task with a deadline', () => {
    const scored = one(task('a', { dueDate: WED, effortMinutes: hours(8) }))
    expect(scored).toMatchObject({
      tier: 2,
      category: 'do_next',
      effectiveDeadline: WED,
      deadlineSource: 'due',
      latestStart: WED,
      score: 0.3911,
      hidden: null,
      flags: { unestimated: false, pinned: false, inLoop: false },
    })
    expect(scored.factors).toEqual({
      effortHours: 8,
      availableHours: 24,
      workingDays: 2,
      r: 0.3333,
      p: 0,
      R: 0,
      importance: 0.28, // medium in no project: 0.4 x (0.5 + 0.5 x 0.4)
      urgencyTerm: 'r',
      own: 0.3911, // 0.3333² + 0.28
      base: 0.3911,
      unlockedHours: 0,
      boost: 1,
    })
    expect(scored.reason).toEqual({ code: 'tight', params: { percent: 33 }, text: "Needs 33% of the working time left before it's due" })
  })

  it('counts an unestimated task as 2 hours, times the buffer', () => {
    expect(one(task('a')).factors.effortHours).toBe(2)
    expect(one(task('a')).flags.unestimated).toBe(true)
    expect(one(task('a'), [], { buffer: 1.5 }).factors.effortHours).toBe(3)
    expect(one(task('a', { effortMinutes: 90 }), [], { buffer: 2 }).factors.effortHours).toBe(3)
  })

  it('has no urgency without an effective deadline', () => {
    const scored = one(task('a', { priority: 'high' }))
    expect(scored).toMatchObject({ effectiveDeadline: null, deadlineSource: null, latestStart: null })
    expect(scored.factors).toMatchObject({ availableHours: null, workingDays: null, r: 0, p: 0, R: 0, urgencyTerm: null })
    expect(scored.score).toBe(0.595) // 0.7 x 0.85
    expect(scored.reason).toEqual({ code: 'important', params: { priority: 'high' }, text: 'High priority' })
  })

  it('takes the earliest delivery date of its live projects when it has no due date', () => {
    const projects = [
      project('late', { deliveryDate: '2026-12-01', taskIds: ['a'] }),
      project('soon', { deliveryDate: FRI, taskIds: ['a'], priority: 'high' }),
      project('archived', { deliveryDate: TUE, taskIds: ['a'], tagIds: [ARCHIVE_TAG_ID] }),
    ]
    const scored = one(task('a'), projects)
    expect(scored).toMatchObject({ effectiveDeadline: FRI, deadlineSource: 'project' })
    expect(scored.factors.availableHours).toBe(40)
    expect(scored.reason.text).toBe('Medium priority in "Project soon", a high-priority project')
  })

  it('counts time from the start date when it is later than today, skipping days with no capacity', () => {
    const scored = one(task('a', { startDate: WED, dueDate: '2026-11-23' }))
    expect(scored.factors.availableHours).toBe(32) // Wednesday to Friday, and Monday
    expect(scored.factors.workingDays).toBe(5)
    expect(one(task('a', { startDate: '2026-11-10', dueDate: WED })).factors.availableHours).toBe(24)
  })

  it('lifts a task due within the horizon', () => {
    expect(one(task('a', { dueDate: MON })).factors).toMatchObject({ workingDays: 0, p: 1, urgencyTerm: 'p' })
    expect(one(task('a', { dueDate: TUE })).factors).toMatchObject({ workingDays: 1, p: 0.25, urgencyTerm: 'p' })
    expect(one(task('a', { dueDate: WED })).factors.p).toBe(0)
    // A longer horizon reaches further
    expect(one(task('a', { dueDate: WED }), [], { horizonDays: 3 }).factors.p).toBe(0.1111)
  })

  it('weighs importance by the project and the task within it, taking the best project', () => {
    const level = (projectPriority: Task['priority'] | null, taskPriority: Task['priority']) => {
      const projects = projectPriority ? [project('p', { priority: projectPriority, taskIds: ['a'] })] : []
      return one(task('a', { priority: taskPriority }), projects).factors.importance
    }
    expect(level('urgent', 'low')).toBe(0.55)
    expect(level('low', 'urgent')).toBe(0.1)
    expect(level(null, 'urgent')).toBe(1)
    expect(level(null, 'low')).toBe(0.055)
    const two = [project('p', { priority: 'low', taskIds: ['a'] }), project('q', { priority: 'high', taskIds: ['a'] })]
    expect(one(task('a'), two).factors.importance).toBe(0.49)
  })

  it("measures each project's pace, capped at 1, and takes the most pressed", () => {
    // 40 hours of work in the 40 hours to Friday
    const behind = project('p', { deliveryDate: FRI, taskIds: ['x', 'y'] })
    const tasks = [task('x', { effortMinutes: hours(30) }), task('y', { effortMinutes: hours(10), dueDate: FRI })]
    const x = scoredIn(run(tasks, [behind]), 'x')
    expect(x.factors).toMatchObject({ R: 1, r: 0.75, urgencyTerm: 'R' })
    expect(x.reason).toEqual({
      code: 'project_pace',
      params: { projectId: 'p', project: 'Project p', percent: 100 },
      text: '"Project p" is behind pace',
    })

    const overloaded = [task('x', { effortMinutes: hours(70) }), task('y', { effortMinutes: hours(10), dueDate: FRI })]
    expect(scoredIn(run(overloaded, [behind]), 'y').factors.R).toBe(1)

    const half = [task('x', { effortMinutes: hours(10) }), task('y', { effortMinutes: hours(10), dueDate: FRI })]
    expect(scoredIn(run(half, [behind]), 'y').reason.text).toBe('"Project p" needs 50% of its working time left')
  })

  it('boosts a task by the work it unblocks, against the work left in its projects', () => {
    const p = project('p', { taskIds: ['a', 'b', 'c'] })
    const tasks = [task('a', { relations: blocks('b') }), task('b', { effortMinutes: hours(4) }), task('c', { effortMinutes: hours(6) })]
    expect(scoredIn(run(tasks, [p]), 'a').factors).toMatchObject({ unlockedHours: 4, boost: 1.3333 })
    expect(scoredIn(run(tasks, [p], { k: 2 }), 'a').factors.boost).toBe(1.6667)
  })

  it('counts each task it unblocks once, however many ways it is reached, and caps the boost', () => {
    const tasks = [
      task('a', { relations: blocks('b', 'c') }),
      task('b', { relations: blocks('c'), effortMinutes: hours(3) }),
      task('c', { effortMinutes: hours(5) }),
    ]
    // No project: divided by its own work and what it unlocks
    expect(scoredIn(run(tasks), 'a').factors).toMatchObject({ unlockedHours: 8, boost: 1.8 })
    // In a project with only itself, the unlocked work is more than the project's, so the ratio is 1
    expect(scoredIn(run(tasks, [project('p', { taskIds: ['a'] })]), 'a').factors.boost).toBe(2)
  })
})

describe('blockers', () => {
  it('takes the working day before a blocked task\'s latest start as its deadline, and its base', () => {
    // b needs 16 hours by Friday, so must start by Thursday; a must be done by Wednesday
    const tasks = [task('a', { relations: blocks('b') }), task('b', { dueDate: FRI, effortMinutes: hours(16) })]
    const result = run(tasks)
    const a = scoredIn(result, 'a')
    expect(scoredIn(result, 'b').latestStart).toBe(THU)
    expect(a).toMatchObject({ effectiveDeadline: WED, deadlineSource: 'blocked', score: 0.8311 })
    expect(a.factors).toMatchObject({ own: 0.2869, base: 0.44, unlockedHours: 16, boost: 1.8889 })
    expect(a.reason).toEqual({ code: 'unblocks', params: { hours: 16 }, text: 'Unblocks 16 h of work' })
  })

  it('reads the deadline across a weekend', () => {
    const tasks = [task('a', { relations: blocks('b') }), task('b', { dueDate: '2026-11-23', effortMinutes: hours(16) })]
    expect(scoredIn(run(tasks), 'a').effectiveDeadline).toBe(THU) // b starts Friday at the latest
  })

  it('keeps its own due date when that is earlier, or the same', () => {
    const tasks = [task('a', { dueDate: TUE, relations: blocks('b') }), task('b', { dueDate: FRI, effortMinutes: hours(16) })]
    expect(scoredIn(run(tasks), 'a')).toMatchObject({ effectiveDeadline: TUE, deadlineSource: 'due' })
    const same = [task('a', { dueDate: WED, relations: blocks('b') }), task('b', { dueDate: FRI, effortMinutes: hours(16) })]
    expect(scoredIn(run(same), 'a').deadlineSource).toBe('due')
  })

  it('says how soon the blocked task goes critical when that deadline is what makes it urgent', () => {
    // b needs 24 hours by Friday, so starts Wednesday at the latest; a must be done Tuesday
    const tasks = [task('a', { effortMinutes: hours(8), relations: blocks('b') }), task('b', { dueDate: FRI, effortMinutes: hours(24) })]
    expect(scoredIn(run(tasks, [], { k: 0 }), 'a').reason).toEqual({
      code: 'goes_critical',
      params: { taskId: 'b', task: 'Task b', days: 2 },
      text: '"Task b" goes critical in 2 days unless this is done',
    })
  })

  it('puts a blocker in tier 1 when the time before the blocked task must start has gone', () => {
    // b needs all of Monday to Wednesday, so a should have been done by Friday
    const tasks = [task('a', { relations: blocks('b') }), task('b', { dueDate: WED, effortMinutes: hours(24) })]
    const result = run(tasks)
    expect(scoredIn(result, 'b')).toMatchObject({ tier: 1, hidden: 'blocked' })
    expect(scoredIn(result, 'a')).toMatchObject({ tier: 1, category: 'do_now', effectiveDeadline: '2026-11-13' })
    expect(scoredIn(result, 'a').factors).toMatchObject({ availableHours: 0, r: null })
    expect(scoredIn(result, 'a').reason.text).toBe('"Task b" is already critical, and waits on this')
  })

  it('takes tier 1 from a blocked task with no slack, saying so', () => {
    // b can only start Thursday, and needs both days to Friday; a has until Wednesday
    const tasks = [task('a', { relations: blocks('b') }), task('b', { startDate: THU, dueDate: FRI, effortMinutes: hours(16) })]
    const a = scoredIn(run(tasks), 'a')
    expect(a).toMatchObject({ tier: 1, effectiveDeadline: WED })
    expect(a.reason).toEqual({
      code: 'blocks_critical',
      params: { taskId: 'b', task: 'Task b' },
      text: 'Holds up "Task b", which has no slack left',
    })
  })

  it('takes tier 0 from an overdue task it blocks, through a chain', () => {
    const tasks = [task('a', { relations: blocks('b') }), task('b', { relations: blocks('c') }), task('c', { dueDate: '2026-11-13' })]
    const result = run(tasks)
    expect(result.tasks.map((t) => [t.taskId, t.tier])).toEqual([
      ['a', 0],
      ['b', 0],
      ['c', 0],
    ])
    expect(scoredIn(result, 'a').reason.text).toBe('Holds up "Task b", which is overdue')
    expect(result.sections.overdue).toEqual(['a'])
    expect(result.hidden).toEqual({ blocked: 2, notStarted: 0 })
  })
})

describe('tiers and reasons', () => {
  it('puts tasks due before today in tier 0', () => {
    const result = run([task('a', { dueDate: '2026-11-13' }), task('b', { dueDate: '2026-11-15' })])
    expect(scoredIn(result, 'a').reason).toEqual({
      code: 'overdue',
      params: { dueDate: '2026-11-13', days: 3 },
      text: 'Was due 3 days ago',
    })
    expect(scoredIn(result, 'b').reason.text).toBe('Was due yesterday')
    expect(result.sections.overdue).toEqual(['a', 'b'])
  })

  it('puts a task that needs all the time left in tier 1', () => {
    const scored = one(task('a', { dueDate: TUE, effortMinutes: hours(16) }))
    expect(scored).toMatchObject({ tier: 1, category: 'do_now' })
    expect(scored.reason).toEqual({
      code: 'needs_all_time',
      params: { percent: 100 },
      text: "Needs all the working time left before it's due",
    })
    expect(one(task('a', { dueDate: TUE, effortMinutes: hours(15.99) })).tier).toBe(2)
  })

  it('puts a task with no time left before its project delivers in tier 1', () => {
    const p = project('p', { deliveryDate: '2026-11-13', taskIds: ['a'] })
    const scored = one(task('a'), [p])
    expect(scored.tier).toBe(1)
    expect(scored.reason).toEqual({
      code: 'no_time_left',
      params: { projectId: 'p', project: 'Project p' },
      text: 'No working time left before "Project p" delivers',
    })
  })

  it('says when a task is due soon', () => {
    expect(one(task('a', { dueDate: MON })).reason).toEqual({ code: 'due_soon', params: { days: 0 }, text: 'Due today' })
    expect(one(task('a', { dueDate: TUE })).reason.text).toBe('Due tomorrow')
    expect(one(task('a', { dueDate: WED }), [], { horizonDays: 3 }).reason.text).toBe('Due in 2 days')
    const p = project('p', { deliveryDate: TUE, taskIds: ['a'] })
    expect(one(task('a'), [p]).reason.text).toBe('"Project p" delivers tomorrow')
  })

  it('names the project in an importance reason', () => {
    const p = project('p', { priority: 'urgent', taskIds: ['a'] })
    expect(one(task('a', { priority: 'low' }), [p]).reason).toEqual({
      code: 'important',
      params: { priority: 'low', projectId: 'p', project: 'Project p', projectPriority: 'urgent' },
      text: 'Low priority in "Project p", an urgent-priority project',
    })
  })

  it('names a task it is needed for when that is what lifts it', () => {
    // b is urgent; a blocks it but unblocks little next to the rest of the project
    const p = project('p', { taskIds: ['a', 'b', 'c'] })
    const tasks = [task('a', { relations: blocks('b') }), task('b', { priority: 'urgent' }), task('c', { effortMinutes: hours(100) })]
    expect(scoredIn(run(tasks, [p]), 'a').reason).toEqual({ code: 'needed_for', params: { taskId: 'b', task: 'Task b' }, text: 'Needed for "Task b"' })
  })
})

describe('order and categories', () => {
  it('orders tiers 0 and 1 by importance, then earliest deadline, then id', () => {
    const tasks = [
      task('z', { dueDate: TUE, effortMinutes: hours(16) }),
      task('y', { dueDate: MON, effortMinutes: hours(8) }),
      task('x', { dueDate: TUE, effortMinutes: hours(16), priority: 'high' }),
      task('w', { dueDate: MON, effortMinutes: hours(8) }),
    ]
    expect(run(tasks).sections.do_now).toEqual(['x', 'w', 'y', 'z'])
  })

  it('orders tier 2 by score, then least work, then id', () => {
    const tasks = [
      task('d', { effortMinutes: hours(3) }),
      task('c', { effortMinutes: hours(1) }),
      task('b', { effortMinutes: hours(1) }),
      task('a', { priority: 'high', effortMinutes: hours(9) }),
    ]
    expect(run(tasks).sections.do_next).toEqual(['a', 'b', 'c', 'd'])
  })

  it('puts tasks pinned to today at the end of Do nowww, and ignores old pins', () => {
    const tasks = [
      task('pinned', { pinnedDate: TODAY }),
      task('old-pin', { pinnedDate: '2026-11-13', priority: 'high' }),
      task('critical', { dueDate: TUE, effortMinutes: hours(16) }),
      task('overdue', { dueDate: '2026-11-13', pinnedDate: TODAY }),
    ]
    const result = run(tasks)
    expect(result.sections).toEqual({ overdue: ['overdue'], do_now: ['critical', 'pinned'], do_next: ['old-pin'] })
    expect(scoredIn(result, 'pinned')).toMatchObject({
      flags: { pinned: true },
      reason: { code: 'pinned', params: {}, text: 'Pinned to today' },
    })
    expect(scoredIn(result, 'old-pin').flags.pinned).toBe(false)
    expect(result.tasks.map((t) => t.taskId)).toEqual(['overdue', 'critical', 'pinned', 'old-pin'])
  })

  it('hides tasks with an open blocker and tasks not started yet, counting each once', () => {
    const tasks = [
      task('blocker', { relations: blocks('blocked', 'both') }),
      task('blocked'),
      task('later', { startDate: TUE }),
      task('both', { startDate: TUE }),
      task('started', { startDate: TODAY }),
      // A completed blocker doesn't hold anything up
      task('done', { completed: true, relations: blocks('free') }),
      task('free'),
    ]
    const result = run(tasks)
    expect(result.hidden).toEqual({ blocked: 2, notStarted: 1 })
    expect(result.hiddenSummary).toEqual({
      code: 'hidden',
      params: { blocked: 2, notStarted: 1 },
      text: 'Hidden: 2 waiting on other tasks and 1 not started yet.',
    })
    expect(run([task('a', { startDate: TUE })]).hiddenSummary!.text).toBe('Hidden: 1 not started yet.')
    expect(run([task('a')]).hiddenSummary).toBeNull()
    expect(Object.values(result.sections).flat().sort()).toEqual(['blocker', 'free', 'started'])
    expect(scoredIn(result, 'both').hidden).toBe('blocked')
    expect(scoredIn(result, 'later').hidden).toBe('not_started')
    // Hidden tasks are still scored and placed in the full order
    expect(result.tasks).toHaveLength(6)
  })

  it('labels the categories', () => {
    expect(CATEGORY_LABELS).toEqual({ overdue: 'Overdue', do_now: 'Do nowww', do_next: 'Do next' })
  })
})

describe('blocking loops', () => {
  it('ignores the edges inside a loop and flags its tasks', () => {
    const tasks = [
      task('a', { relations: blocks('b') }),
      task('b', { relations: blocks('a') }),
      task('c', { relations: blocks('a') }),
    ]
    const result = run(tasks)
    expect(result.loops).toEqual([['a', 'b']])
    expect(result.tasks.filter((t) => t.flags.inLoop).map((t) => t.taskId).sort()).toEqual(['a', 'b'])
    // Neither loop task holds the other up, but c still blocks a
    expect(scoredIn(result, 'a').hidden).toBe('blocked')
    expect(scoredIn(result, 'b').hidden).toBeNull()
    expect(scoredIn(result, 'b').factors.unlockedHours).toBe(0)
    expect(scoredIn(result, 'c').factors.unlockedHours).toBe(2)
  })

  it('finds every loop, even one made of blocked by relations', () => {
    const tasks = [
      task('a', { relations: [{ taskId: 'b', type: 'blocked_by' }] }),
      task('b', { relations: [{ taskId: 'a', type: 'blocked_by' }] }),
      task('c', { relations: blocks('d') }),
      task('d', { relations: blocks('e') }),
      task('e', { relations: blocks('c') }),
      task('f'),
    ]
    expect(blockLoops(tasks)).toEqual([
      ['a', 'b'],
      ['c', 'd', 'e'],
    ])
  })
})

describe('determinism', () => {
  const projects = [
    project('p', { deliveryDate: FRI, priority: 'high', taskIds: ['a', 'b', 'c'] }),
    project('q', { deliveryDate: '2026-12-04', taskIds: ['c', 'd', 'e'] }),
  ]
  const tasks = [
    task('a', { relations: blocks('b'), effortMinutes: 150 }),
    task('b', { dueDate: THU, effortMinutes: hours(6) }),
    task('c', { dueDate: WED, priority: 'urgent' }),
    task('d', { startDate: TUE, effortMinutes: 45 }),
    task('e', { relations: blocks('d'), pinnedDate: TODAY }),
    task('f', { dueDate: '2026-11-13' }),
    task('g', { priority: 'low' }),
  ]

  it('gives the same result whatever order the tasks and projects come in', () => {
    const expected = run(tasks, projects)
    const shuffled = run([...tasks].reverse(), [...projects].reverse())
    // The loops list is in input order, and there are none here
    expect(shuffled).toEqual(expected)
    expect(run([tasks[3]!, tasks[0]!, tasks[6]!, tasks[1]!, tasks[5]!, tasks[2]!, tasks[4]!], projects)).toEqual(expected)
  })

  it('returns plain JSON', () => {
    const result = run(tasks, projects)
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })

  it('depends on the today it is given', () => {
    expect(scoredIn(run(tasks, projects, {}, '2026-11-19'), 'c').tier).toBe(0)
    expect(run(tasks, projects).today).toBe(TODAY)
  })
})
