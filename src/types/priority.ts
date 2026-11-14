// Task prioritisation (docs/priority-algorithm.md, Stage 2): every open task gets a tier, a score
// and a reason, and the ones that can be worked on now are sorted into Overdue, Do nowww and Do
// next. Pure functions over plain data only: no Vue, no browser APIs, no clock and relative
// imports only, since worker/ imports this file too. `today` is always passed in, the result is
// plain JSON, and nothing here is stored.
import { isArchived, type Project } from './project'
import type { Sentence } from './sentence'
import { blockEdges, blockLoops } from './rules'
import {
  capacityBetween,
  daysBetween,
  latestStartFor,
  previousWorkingDay,
  workingDaysBetween,
  type UserSettings,
} from './settings'
import type { Priority, Task } from './task'

// A task with no estimate counts as this much work, and is flagged as unestimated
export const DEFAULT_EFFORT_MINUTES = 120

export const LEVEL_VALUES: Record<Priority, number> = { low: 0.1, medium: 0.4, high: 0.7, urgent: 1 }

export const CATEGORIES = ['overdue', 'do_now', 'do_next'] as const
export type Category = (typeof CATEGORIES)[number]
export const CATEGORY_LABELS: Record<Category, string> = { overdue: 'Overdue', do_now: 'Do nowww', do_next: 'Do next' }

export type Tier = 0 | 1 | 2
export type UrgencyTerm = 'r' | 'p' | 'R'
// Where the effective deadline comes from: the task's own due date, the delivery date of one of
// its projects (for a task with no due date), or a task it blocks
export type DeadlineSource = 'due' | 'project' | 'blocked'
export type HiddenBecause = 'blocked' | 'not_started'

export interface Factors {
  effortHours: number // E: the estimate (or the default) times the buffer
  availableHours: number | null // T; null without an effective deadline
  workingDays: number | null // d; null without an effective deadline
  r: number | null // E / T: 0 without a deadline, null when T is 0
  p: number // the lift for a deadline within the horizon
  R: number // the pace of the task's most pressed project
  importance: number
  urgencyTerm: UrgencyTerm | null // the largest of r², p and R²; null when all are 0
  own: number // wU x max(r², p, R²) + importance, with r² capped at 1
  base: number // the largest of own and the base of each task it blocks
  unlockedHours: number // E of every open task this one blocks, directly or not
  boost: number
}

export type ReasonCode =
  | 'overdue'
  | 'blocks_overdue'
  | 'no_time_left'
  | 'needs_all_time'
  | 'goes_critical'
  | 'blocks_critical'
  | 'pinned'
  | 'due_soon'
  | 'tight'
  | 'project_pace'
  | 'important'
  | 'unblocks'
  | 'needed_for'

// Why a task is where it is: a code with the values it depends on, for code to use, and the same
// as a finished English sentence, for people (and a voice front-end, which reads it out as it is)
export interface Reason {
  code: ReasonCode
  params: Record<string, string | number | null>
  text: string
}

export interface ScoredTask {
  taskId: string
  name: string
  category: Category
  tier: Tier
  score: number // base x boost, to 4 decimal places
  hidden: HiddenBecause | null // why it's left out of the list, if it is
  effectiveDeadline: string | null
  deadlineSource: DeadlineSource | null
  latestStart: string | null // the latest day it can start on and still meet its effective deadline
  factors: Factors
  flags: { unestimated: boolean; pinned: boolean; inLoop: boolean }
  reason: Reason
}

export interface Priorities {
  today: string
  // Every scored task, hidden ones included, in Suggested order: tier 0, tier 1, tasks pinned to
  // today, then the rest of tier 2
  tasks: ScoredTask[]
  // The ids of the tasks the list shows in each category, in order
  sections: Record<Category, string[]>
  // How many tasks are hidden: those with an open blocker, then those not started yet, and the same
  // as a sentence, e.g. "Hidden: 2 waiting on other tasks and 1 not started yet."; null with none
  hidden: { blocked: number; notStarted: number }
  hiddenSummary: Sentence | null
  loops: string[][] // the groups of tasks caught in blocking loops, whose edges are ignored
}

// Every value is rounded to this before it's compared or returned, so the order can't depend on
// floating-point noise
export const round4 = (value: number) => Math.round(value * 10_000) / 10_000

// Whether a task is left out of prioritisation altogether: completed, only in archived projects,
// or imported from Google Calendar and never given an estimate
export function isExcluded(task: Task, projects: Project[]): boolean {
  if (task.completed) return true
  if (task.googleAccount !== undefined && task.effortMinutes === undefined) return true
  const inProjects = projects.filter((p) => p.taskIds.includes(task.id))
  return inProjects.length > 0 && inProjects.every(isArchived)
}

interface Working {
  task: Task
  effort: number // E, hours
  projects: Project[] // its live projects
  deadline: string | null
  source: DeadlineSource | null
  deadlineProject: Project | null // for source 'project'
  deadlineFrom: string | null // the blocked task, for source 'blocked'
  latestStart: string | null
  available: number | null
  days: number | null
  r: number | null
  p: number
  R: number
  paceProject: Project | null
  importance: number
  importanceProject: Project | null
  own: number
  base: number
  baseFrom: string | null // the blocked task whose base it took, if any
  reach: Set<string>
  unlocked: number
  boost: number
  score: number
  tier: Tier
  tierFrom: string | null // the blocked task it took tier 0 or 1 from, if any
}

export function prioritise(tasks: Task[], projects: Project[], settings: UserSettings, today: string): Priorities {
  const capacity = settings.capacityMinutes
  const hours = (from: string, through: string) => capacityBetween(capacity, from, through) / 60
  const open = tasks.filter((t) => !isExcluded(t, projects))
  const openIds = new Set(open.map((t) => t.id))
  const live = projects.filter((p) => !isArchived(p))

  const liveProjectsOf = new Map<string, Project[]>()
  for (const project of live) {
    for (const id of project.taskIds) if (openIds.has(id)) liveProjectsOf.set(id, [...(liveProjectsOf.get(id) ?? []), project])
  }
  const effort = new Map(
    open.map((t) => [t.id, ((t.effortMinutes ?? DEFAULT_EFFORT_MINUTES) / 60) * settings.buffer]),
  )

  // Each live project's open work, and its pace: that work over the time left before delivery
  const projectWork = new Map(
    live.map((p) => [p.id, [...new Set(p.taskIds)].filter((id) => openIds.has(id)).reduce((sum, id) => sum + effort.get(id)!, 0)]),
  )
  const pace = new Map<string, number>()
  for (const project of live) {
    if (project.deliveryDate === null) continue
    const time = hours(today, project.deliveryDate)
    const work = projectWork.get(project.id)!
    pace.set(project.id, work === 0 ? 0 : time === 0 ? 1 : Math.min(1, work / time))
  }

  // Who blocks whom among the open tasks, without the edges inside loops
  const loops = blockLoops(open)
  const loopOf = new Map(loops.flatMap((group, i) => group.map((id) => [id, i] as const)))
  const sameLoop = (a: string, b: string) => loopOf.has(a) && loopOf.get(a) === loopOf.get(b)
  const blocks = new Map<string, string[]>()
  const blockedBy = new Map<string, string[]>(open.map((t) => [t.id, []]))
  for (const [from, targets] of blockEdges(open)) {
    const kept = targets.filter((to) => !sameLoop(from, to))
    blocks.set(from, kept)
    for (const to of kept) blockedBy.get(to)!.push(from)
  }

  const openById = new Map(open.map((t) => [t.id, t]))
  const working = new Map<string, Working>()
  for (const id of reverseDependencyOrder(open, blocks)) working.set(id, score(openById.get(id)!))

  function score(task: Task): Working {
    const E = effort.get(task.id)!
    const own = liveProjectsOf.get(task.id) ?? []
    const downstream = blocks.get(task.id)!.map((id) => working.get(id)!)

    // Effective deadline: its own due date (or its projects' earliest delivery), or the working day
    // before the latest start of a task it blocks, whichever is earliest; its own wins a tie
    let deadline = task.dueDate
    let source: DeadlineSource | null = deadline ? 'due' : null
    let deadlineProject: Project | null = null
    if (!deadline) {
      for (const project of own) {
        if (project.deliveryDate !== null && (deadline === null || project.deliveryDate < deadline)) {
          deadline = project.deliveryDate
          deadlineProject = project
          source = 'project'
        }
      }
    }
    let deadlineFrom: string | null = null
    for (const blocked of downstream) {
      if (blocked.latestStart === null) continue
      const before = previousWorkingDay(capacity, blocked.latestStart)
      if (deadline === null || before < deadline) {
        deadline = before
        source = 'blocked'
        deadlineProject = null
        deadlineFrom = blocked.task.id
      }
    }
    const latestStart = deadline === null ? null : latestStartFor(capacity, E * 60, deadline)

    // Urgency
    const from = task.startDate !== undefined && task.startDate > today ? task.startDate : today
    const available = deadline === null ? null : hours(from, deadline)
    const days = deadline === null ? null : workingDaysBetween(capacity, today, deadline)
    const r = available === null ? 0 : available === 0 ? null : E / available
    const p = days !== null && days < settings.horizonDays ? (1 - days / settings.horizonDays) ** 2 : 0
    let R = 0
    let paceProject: Project | null = null
    for (const project of own) {
      const value = pace.get(project.id)
      if (value !== undefined && (paceProject === null || value > R)) {
        R = value
        paceProject = project
      }
    }

    // Importance: the project's level, weighted by the task's level within it
    const taskValue = LEVEL_VALUES[task.priority]
    let importance = taskValue * (0.5 + 0.5 * taskValue)
    let importanceProject: Project | null = null
    for (const project of own) {
      const value = LEVEL_VALUES[project.priority] * (0.5 + 0.5 * taskValue)
      if (importanceProject === null || value > importance) {
        importance = value
        importanceProject = project
      }
    }

    // r of 1 or more already puts the task in tier 1, so r² is capped at 1 in its own score
    const rTerm = r === null ? 1 : Math.min(1, r)
    const ownScore = settings.wU * Math.max(rTerm ** 2, p, R ** 2) + importance
    let base = ownScore
    let baseFrom: string | null = null
    for (const blocked of downstream) {
      if (round4(blocked.base) > round4(base)) {
        base = blocked.base
        baseFrom = blocked.task.id
      }
    }

    // What finishing it unlocks, against the work left in its projects
    const reach = new Set<string>()
    for (const blocked of downstream) {
      reach.add(blocked.task.id)
      for (const id of blocked.reach) reach.add(id)
    }
    const unlocked = [...reach].reduce((sum, id) => sum + effort.get(id)!, 0)
    const remaining =
      own.length > 0
        ? [...new Set(own.flatMap((p) => p.taskIds))].filter((id) => openIds.has(id)).reduce((sum, id) => sum + effort.get(id)!, 0)
        : E + unlocked
    const boost = 1 + settings.k * Math.min(1, unlocked / remaining)

    // Tiers, taken from the tasks it blocks when theirs are higher
    let tier: Tier = 2
    let tierFrom: string | null = null
    if (task.dueDate !== null && task.dueDate < today) tier = 0
    else if (available === 0 || (r !== null && round4(r) >= 1)) tier = 1
    for (const blocked of downstream) {
      if (blocked.tier < tier) {
        tier = blocked.tier
        tierFrom = blocked.task.id
      }
    }

    return {
      task,
      effort: E,
      projects: own,
      deadline,
      source,
      deadlineProject,
      deadlineFrom,
      latestStart,
      available,
      days,
      r,
      p,
      R,
      paceProject,
      importance,
      importanceProject,
      own: ownScore,
      base,
      baseFrom,
      reach,
      unlocked,
      boost,
      score: base * boost,
      tier,
      tierFrom,
    }
  }

  const name = (id: string) => working.get(id)!.task.name
  const scored = open.map((task) => {
    const w = working.get(task.id)!
    const pinned = task.pinnedDate === today
    const category: Category = w.tier === 0 ? 'overdue' : w.tier === 1 || pinned ? 'do_now' : 'do_next'
    const hidden: HiddenBecause | null =
      blockedBy.get(task.id)!.length > 0 ? 'blocked' : task.startDate !== undefined && task.startDate > today ? 'not_started' : null
    const terms: [UrgencyTerm, number][] = [
      ['r', (w.r === null ? 1 : Math.min(1, w.r)) ** 2],
      ['p', w.p],
      ['R', w.R ** 2],
    ]
    const top = terms.reduce((best, term) => (round4(term[1]) > round4(best[1]) ? term : best))
    const factors: Factors = {
      effortHours: round4(w.effort),
      availableHours: w.available === null ? null : round4(w.available),
      workingDays: w.days,
      r: w.r === null ? null : round4(w.r),
      p: round4(w.p),
      R: round4(w.R),
      importance: round4(w.importance),
      urgencyTerm: round4(top[1]) > 0 ? top[0] : null,
      own: round4(w.own),
      base: round4(w.base),
      unlockedHours: round4(w.unlocked),
      boost: round4(w.boost),
    }
    const result: ScoredTask = {
      taskId: task.id,
      name: task.name,
      category,
      tier: w.tier,
      score: round4(w.score),
      hidden,
      effectiveDeadline: w.deadline,
      deadlineSource: w.source,
      latestStart: w.latestStart,
      factors,
      flags: { unestimated: task.effortMinutes === undefined, pinned, inLoop: loopOf.has(task.id) },
      reason: { code: 'important', params: {}, text: '' },
    }
    result.reason = reasonFor(result, w, settings, today, name, (id) => working.get(id)!)
    return result
  })

  scored.sort(bySuggestedOrder)
  const sections: Record<Category, string[]> = { overdue: [], do_now: [], do_next: [] }
  for (const task of scored) if (task.hidden === null) sections[task.category].push(task.taskId)

  const hidden = {
    blocked: scored.filter((t) => t.hidden === 'blocked').length,
    notStarted: scored.filter((t) => t.hidden === 'not_started').length,
  }
  return { today, tasks: scored, sections, hidden, hiddenSummary: hiddenSentence(hidden), loops }
}

function hiddenSentence({ blocked, notStarted }: Priorities['hidden']): Sentence | null {
  const parts = [blocked ? `${blocked} waiting on other tasks` : '', notStarted ? `${notStarted} not started yet` : ''].filter(Boolean)
  return parts.length ? { code: 'hidden', params: { blocked, notStarted }, text: `Hidden: ${parts.join(' and ')}.` } : null
}

// Tier 0, tier 1, pinned, then the rest. Tiers 0 and 1 go by importance, then earliest effective
// deadline; the rest by score, then least work. The task id settles any tie.
const groupOf = (t: ScoredTask) => (t.tier < 2 ? t.tier : t.flags.pinned ? 2 : 3)
const byId = (a: ScoredTask, b: ScoredTask) => (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0)
export function bySuggestedOrder(a: ScoredTask, b: ScoredTask): number {
  const group = groupOf(a) - groupOf(b)
  if (group !== 0) return group
  if (a.tier < 2) {
    const deadline = (t: ScoredTask) => t.effectiveDeadline ?? '9999-12-31'
    return (
      b.factors.importance - a.factors.importance || deadline(a).localeCompare(deadline(b)) || byId(a, b)
    )
  }
  return b.score - a.score || a.factors.effortHours - b.factors.effortHours || byId(a, b)
}

// The tasks with every task they block (outside loops) before them, so each is scored after the
// tasks its deadline, tier and base come from. Depth first, without recursion, in list order.
function reverseDependencyOrder(tasks: Task[], blocks: Map<string, string[]>): string[] {
  const order: string[] = []
  const done = new Set<string>()
  for (const { id: root } of tasks) {
    if (done.has(root)) continue
    const work: { id: string; child: number }[] = [{ id: root, child: 0 }]
    done.add(root)
    while (work.length) {
      const frame = work[work.length - 1]!
      const children = blocks.get(frame.id)!
      if (frame.child < children.length) {
        const child = children[frame.child++]!
        if (!done.has(child)) {
          done.add(child)
          work.push({ id: child, child: 0 })
        }
        continue
      }
      work.pop()
      order.push(frame.id)
    }
  }
  return order
}

// Reasons

// How much urgency, unblocking or a task it's needed for must add to a tier 2 task's score to be
// its reason rather than its importance
export const REASON_THRESHOLD = 0.1

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
// e.g. "6 h", "1.5 h"
export const formatHours = (hours: number) => `${Math.round(hours * 10) / 10} h`
const percent = (value: number) => Math.round(value * 100)
const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

// "before it's due", or before its project delivers when the deadline is the project's
const beforeDeadline = (w: Working) =>
  w.source === 'project' ? `before "${w.deadlineProject!.name}" delivers` : "before it's due"

function reasonFor(
  t: ScoredTask,
  w: Working,
  settings: UserSettings,
  today: string,
  name: (id: string) => string,
  get: (id: string) => Working,
): Reason {
  const reason = (code: ReasonCode, params: Reason['params'], text: string): Reason => ({ code, params, text })
  const project: Reason['params'] = w.deadlineProject ? { projectId: w.deadlineProject.id, project: w.deadlineProject.name } : {}

  // A blocked task that will run out of slack: how many days until it does
  const critical = (blockedId: string) => {
    const latest = get(blockedId).latestStart
    const days = latest === null ? 0 : Math.max(0, daysBetween(today, latest))
    const params = { taskId: blockedId, task: name(blockedId), days }
    return days === 0
      ? reason('goes_critical', params, `"${name(blockedId)}" is already critical, and waits on this`)
      : reason('goes_critical', params, `"${name(blockedId)}" goes critical in ${plural(days, 'day')} unless this is done`)
  }

  if (t.tier === 0) {
    if (w.tierFrom === null) {
      const days = daysBetween(w.task.dueDate!, today)
      return reason(
        'overdue',
        { dueDate: w.task.dueDate, days },
        days === 1 ? 'Was due yesterday' : `Was due ${days} days ago`,
      )
    }
    return reason('blocks_overdue', { taskId: w.tierFrom, task: name(w.tierFrom) }, `Holds up "${name(w.tierFrom)}", which is overdue`)
  }

  if (t.tier === 1) {
    if (w.tierFrom !== null) {
      return reason(
        'blocks_critical',
        { taskId: w.tierFrom, task: name(w.tierFrom) },
        `Holds up "${name(w.tierFrom)}", which has no slack left`,
      )
    }
    if (w.source === 'blocked') return critical(w.deadlineFrom!)
    if (w.available === 0) return reason('no_time_left', { ...project }, `No working time left ${beforeDeadline(w)}`)
    return reason('needs_all_time', { percent: percent(w.r!), ...project }, `Needs all the working time left ${beforeDeadline(w)}`)
  }

  if (t.flags.pinned) return reason('pinned', {}, 'Pinned to today')

  // Tier 2: whichever of urgency, a task it's needed for, and what it unblocks adds the most to the
  // score (ties in that order), as long as it adds at least REASON_THRESHOLD. Every task has some
  // importance, so it's only the reason when nothing else stands out.
  const urgency = settings.wU * Math.max((w.r === null ? 1 : Math.min(1, w.r)) ** 2, w.p, w.R ** 2)
  const parts: [string, number][] = [
    ['urgency', urgency],
    ['needed_for', w.baseFrom === null ? 0 : w.base - w.own],
    ['unblocks', w.base * (w.boost - 1)],
  ]
  const top = parts.reduce((best, part) => (round4(part[1]) > round4(best[1]) ? part : best))
  const largest = round4(top[1]) >= REASON_THRESHOLD ? top[0] : 'important'

  if (largest === 'urgency' && t.factors.urgencyTerm !== null) {
    if (t.factors.urgencyTerm === 'R') {
      const p = w.paceProject!
      const params = { projectId: p.id, project: p.name, percent: percent(w.R) }
      return round4(w.R) >= 1
        ? reason('project_pace', params, `"${p.name}" is behind pace`)
        : reason('project_pace', params, `"${p.name}" needs ${percent(w.R)}% of its working time left`)
    }
    if (w.source === 'blocked') return critical(w.deadlineFrom!)
    if (t.factors.urgencyTerm === 'p') {
      const days = daysBetween(today, w.deadline!)
      const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`
      const text = w.source === 'project' ? `"${w.deadlineProject!.name}" delivers ${when}` : `Due ${when}`
      return reason('due_soon', { days, ...project }, text)
    }
    return reason('tight', { percent: percent(w.r!), ...project }, `Needs ${percent(w.r!)}% of the working time left ${beforeDeadline(w)}`)
  }
  if (largest === 'needed_for') return reason('needed_for', { taskId: w.baseFrom, task: name(w.baseFrom!) }, `Needed for "${name(w.baseFrom!)}"`)
  if (largest === 'unblocks') {
    return reason('unblocks', { hours: round4(w.unlocked) }, `Unblocks ${formatHours(w.unlocked)} of work`)
  }
  const level = capitalised(w.task.priority)
  const p = w.importanceProject
  return p
    ? reason(
        'important',
        { priority: w.task.priority, projectId: p.id, project: p.name, projectPriority: p.priority },
        `${level} priority in "${p.name}", a${p.priority === 'urgent' ? 'n' : ''} ${p.priority}-priority project`,
      )
    : reason('important', { priority: w.task.priority }, `${level} priority`)
}
