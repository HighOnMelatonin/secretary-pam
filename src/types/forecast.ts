// The workload forecast (docs/priority-algorithm.md, Stage 4): the open tasks played forward day
// by day from today, each day's capacity filled in Suggested order, to say when each task and
// project should finish, how loaded the next two weeks are, what today holds, and a short brief.
// Pure functions over plain data only: no Vue, no browser APIs, no clock and relative imports
// only, since worker/ imports this file too. `today` is always passed in, the result is plain
// JSON, and nothing here is stored.
import { prioritise, round4, type Priorities } from './priority'
import { isArchived, type Project } from './project'
import { blockEdges } from './rules'
import { joinSentences, type Sentence } from './sentence'
import { capacityBetween, capacityOn, workingDaysBetween, type UserSettings } from './settings'
import type { Task } from './task'
import { addDays } from './upcoming'

// How many days `days` covers, and how many the brief counts overbooked days over
export const FORECAST_DAYS = 14
// The longest the walk goes on before giving up on tasks it can't finish, in days
export const MAX_FORECAST_DAYS = 5 * 366

export const PACES = ['on_pace', 'tight', 'behind'] as const
export type Pace = (typeof PACES)[number]
export const PACE_LABELS: Record<Pace, string> = { on_pace: 'On pace', tight: 'Tight', behind: 'Behind' }
// Working days left between a project's projected finish and its delivery date, at most, for it to
// count as tight; one more is on pace
export const TIGHT_WORKING_DAYS = 1

export interface TaskForecast {
  taskId: string
  name: string
  start: string | null // the first day the plan works on it; null if it never gets to it
  finish: string | null // the day it's projected to be done; null if it never gets done
  effortHours: number
  deadline: string | null // its effective deadline, from the prioritisation
  late: boolean // projected to finish after its effective deadline
}

export interface ProjectForecast {
  projectId: string
  name: string
  deliveryDate: string | null
  openHours: number // the work left in it
  finish: string | null // when its last open task is projected to be done; null with none
  // Working days after the finish, up to and including the delivery date; negative when it
  // finishes that many working days late. Null without both dates.
  workingDaysLeft: number | null
  pace: Pace | null // null without a delivery date or open work
  // e.g. '"Thesis" is tight: it should finish 2026-11-19, 1 working day before delivery.'
  paceReason: Sentence | null
}

export interface DayLoad {
  date: string
  capacityHours: number
  plannedHours: number // what the plan works on that day, never more than its capacity
  dueHours: number // the work whose effective deadline is that day (today's includes overdue work)
  // More work is due by the end of the day than there are working hours from today through it
  overbooked: boolean
}

export interface PlanItem {
  taskId: string
  name: string
  hours: number
  finishes: boolean // the plan finishes it today
}

export interface Forecast {
  today: string
  tasks: TaskForecast[] // in Suggested order, hidden tasks included
  projects: ProjectForecast[] // the live projects, in the order given
  days: DayLoad[] // FORECAST_DAYS days from today
  todayPlan: PlanItem[]
  totals: {
    hours: number // all the open work
    unestimatedHours: number // the part that comes from the 2-hour default
    noDeadlineHours: number // the part with no effective deadline
  }
  allDone: string | null // when the last open task is projected to be done
  brief: { parts: Sentence[]; text: string }
}

const EPSILON = 1e-9

// A project's pace from its projected finish and delivery date
export function paceOf(capacity: UserSettings['capacityMinutes'], finish: string, deliveryDate: string): Pace {
  if (finish > deliveryDate) return 'behind'
  return workingDaysBetween(capacity, finish, deliveryDate) <= TIGHT_WORKING_DAYS ? 'tight' : 'on_pace'
}

export function forecast(
  tasks: Task[],
  projects: Project[],
  settings: UserSettings,
  today: string,
  priorities: Priorities = prioritise(tasks, projects, settings, today),
): Forecast {
  const capacity = settings.capacityMinutes
  const scored = priorities.tasks
  const ids = new Set(scored.map((t) => t.taskId))
  const byId = new Map(tasks.map((t) => [t.id, t]))

  // Who must finish before whom: the same edges the prioritisation used, without those inside loops
  const loopOf = new Map(priorities.loops.flatMap((group, i) => group.map((id) => [id, i] as const)))
  const blockers = new Map<string, string[]>([...ids].map((id) => [id, []]))
  for (const [from, targets] of blockEdges(tasks.filter((t) => ids.has(t.id)))) {
    for (const to of targets) {
      if (!(loopOf.has(from) && loopOf.get(from) === loopOf.get(to))) blockers.get(to)!.push(from)
    }
  }

  // The walk: each day, as many passes in Suggested order as it takes to use the day's hours up or
  // run out of tasks that can be worked on, so a task can start the day its blocker finishes
  const left = new Map(scored.map((t) => [t.taskId, t.factors.effortHours]))
  const start = new Map<string, string>()
  const finish = new Map<string, string>()
  const planned = new Map<string, number>() // hours worked, by date
  const todayHours = new Map<string, number>() // hours worked today, by task, in the order started
  let open = scored.filter((t) => left.get(t.taskId)! > EPSILON).length
  for (let i = 0; open > 0 && i < MAX_FORECAST_DAYS; i++) {
    const day = addDays(today, i)
    let room = capacityOn(capacity, day) / 60
    for (let progress = true; progress && room > EPSILON; ) {
      progress = false
      for (const t of scored) {
        if (room <= EPSILON) break
        const remaining = left.get(t.taskId)!
        if (remaining <= EPSILON) continue
        const startDate = byId.get(t.taskId)!.startDate
        if (startDate !== undefined && startDate > day) continue
        if (blockers.get(t.taskId)!.some((b) => !finish.has(b))) continue
        const hours = Math.min(remaining, room)
        room -= hours
        left.set(t.taskId, remaining - hours)
        planned.set(day, (planned.get(day) ?? 0) + hours)
        if (!start.has(t.taskId)) start.set(t.taskId, day)
        if (i === 0) todayHours.set(t.taskId, (todayHours.get(t.taskId) ?? 0) + hours)
        if (remaining - hours <= EPSILON) {
          finish.set(t.taskId, day)
          open--
        }
        progress = true
      }
    }
  }

  const taskForecasts: TaskForecast[] = scored.map((t) => {
    const done = finish.get(t.taskId) ?? null
    return {
      taskId: t.taskId,
      name: t.name,
      start: start.get(t.taskId) ?? null,
      finish: done,
      effortHours: t.factors.effortHours,
      deadline: t.effectiveDeadline,
      late: t.effectiveDeadline !== null && (done === null || done > t.effectiveDeadline),
    }
  })

  const projectForecasts: ProjectForecast[] = projects
    .filter((p) => !isArchived(p))
    .map((p) => {
      const own = taskForecasts.filter((t) => p.taskIds.includes(t.taskId))
      const openHours = own.reduce((sum, t) => sum + t.effortHours, 0)
      const finishes = own.map((t) => t.finish)
      const done = own.length === 0 || finishes.includes(null) ? null : finishes.reduce((a, b) => (b! > a! ? b : a))!
      const both = done !== null && p.deliveryDate !== null
      const workingDaysLeft = !both
        ? null
        : done! > p.deliveryDate!
          ? -workingDaysBetween(capacity, p.deliveryDate!, done!)
          : workingDaysBetween(capacity, done!, p.deliveryDate!)
      const pace = both ? paceOf(capacity, done!, p.deliveryDate!) : null
      return {
        projectId: p.id,
        name: p.name,
        deliveryDate: p.deliveryDate,
        openHours: round4(openHours),
        finish: done,
        workingDaysLeft,
        pace,
        paceReason: pace ? paceSentence(p, pace, done!, workingDaysLeft!) : null,
      }
    })

  // The next FORECAST_DAYS days: what's planned, what's due, and whether more is due by the end
  // of each than there's time for from today
  const dueOn = (date: string, first: boolean) =>
    scored
      .filter((t) => t.effectiveDeadline !== null && (t.effectiveDeadline === date || (first && t.effectiveDeadline < date)))
      .reduce((sum, t) => sum + t.factors.effortHours, 0)
  let dueSoFar = 0
  const days: DayLoad[] = Array.from({ length: FORECAST_DAYS }, (_, i) => {
    const date = addDays(today, i)
    const due = dueOn(date, i === 0)
    dueSoFar += due
    return {
      date,
      capacityHours: round4(capacityOn(capacity, date) / 60),
      plannedHours: round4(planned.get(date) ?? 0),
      dueHours: round4(due),
      overbooked: round4(dueSoFar) > round4(capacityBetween(capacity, today, date) / 60),
    }
  })

  // In the order the work happens, which a blocker can change from the Suggested order
  const names = new Map(scored.map((t) => [t.taskId, t.name]))
  const todayPlan: PlanItem[] = [...todayHours].map(([taskId, worked]) => ({
    taskId,
    name: names.get(taskId)!,
    hours: round4(worked),
    finishes: finish.get(taskId) === today,
  }))

  const sum = (list: typeof scored) => round4(list.reduce((total, t) => total + t.factors.effortHours, 0))
  const totals = {
    hours: sum(scored),
    unestimatedHours: sum(scored.filter((t) => t.flags.unestimated)),
    noDeadlineHours: sum(scored.filter((t) => t.effectiveDeadline === null)),
  }
  const finishes = taskForecasts.map((t) => t.finish)
  const allDone =
    finishes.length === 0 || finishes.includes(null) ? null : finishes.reduce((a, b) => (b! > a! ? b : a))!

  const result = { today, tasks: taskForecasts, projects: projectForecasts, days, todayPlan, totals, allDone }
  return { ...result, brief: briefOf(result) }
}

// e.g. '"Thesis" is tight: it should finish 2026-11-19, 1 working day before delivery.'
function paceSentence(project: Project, pace: Pace, finish: string, workingDaysLeft: number): Sentence {
  const days = Math.abs(workingDaysLeft)
  const when =
    workingDaysLeft === 0
      ? `${finish}, on its delivery date`
      : `${finish}, ${days} working ${days === 1 ? 'day' : 'days'} ${workingDaysLeft > 0 ? 'before' : 'after'} delivery`
  const label = { on_pace: 'on pace', tight: 'tight', behind: 'behind' }[pace]
  return {
    code: 'pace',
    params: { projectId: project.id, project: project.name, pace, finish, deliveryDate: project.deliveryDate, workingDaysLeft },
    text: `"${project.name}" is ${label}: it should finish ${when}.`,
  }
}

// The brief

// e.g. "6 h", "1.5 h"
const hoursText = (hours: number) => `${Math.round(hours * 10) / 10} h`
// "A", "A and B", "A, B and C"
const listOf = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
const quoted = (names: string[]) => listOf(names.map((n) => `"${n}"`))

function briefOf(f: Omit<Forecast, 'brief'>): Forecast['brief'] {
  const parts: Sentence[] = []
  const say = (code: string, params: Sentence['params'], text: string) => parts.push({ code, params, text })

  const day = f.days[0]!
  const planned = f.todayPlan.reduce((total, item) => total + item.hours, 0)
  if (day.capacityHours === 0) say('today_off', {}, 'Today is a day off.')
  else if (f.todayPlan.length === 0) say('today_free', { capacityHours: day.capacityHours }, 'Nothing is planned for today.')
  else {
    const count = f.todayPlan.length
    say(
      'today_plan',
      { tasks: count, hours: round4(planned), capacityHours: day.capacityHours },
      `Today: ${count} ${count === 1 ? 'task' : 'tasks'}, ${hoursText(planned)} of ${hoursText(day.capacityHours)}.`,
    )
  }

  for (const pace of ['behind', 'tight'] as const) {
    const names = f.projects.filter((p) => p.pace === pace).map((p) => p.name)
    if (names.length) {
      say(
        `projects_${pace}`,
        { projects: names },
        `${quoted(names)} ${names.length === 1 ? 'is' : 'are'} ${pace === 'behind' ? 'behind' : 'tight'}.`,
      )
    }
  }

  const overbooked = f.days.filter((d) => d.overbooked).map((d) => d.date)
  if (overbooked.length) {
    say(
      'overbooked_days',
      { days: overbooked.length, dates: overbooked, window: f.days.length },
      `${overbooked.length} of the next ${f.days.length} days ${overbooked.length === 1 ? 'is' : 'are'} overbooked.`,
    )
  }

  const late = f.tasks.filter((t) => t.late).length
  if (late) {
    say(
      'late_tasks',
      { tasks: late },
      `${late} ${late === 1 ? 'task is' : 'tasks are'} projected to finish after ${late === 1 ? 'its' : 'their'} deadline.`,
    )
  }

  // Always said, so the forecast's guesses are never hidden
  const { hours, unestimatedHours, noDeadlineHours } = f.totals
  if (hours === 0) {
    say('no_work', {}, 'There is no open work.')
    return { parts, text: joinSentences(parts) }
  }
  say(
    'assumptions',
    { hours, unestimatedHours, noDeadlineHours },
    `Of ${hoursText(hours)} of open work, ${unestimatedHours ? hoursText(unestimatedHours) : 'none'} ${unestimatedHours === 1 ? 'comes' : 'come'} from the 2-hour default for tasks with no estimate, and ${
      noDeadlineHours === 0
        ? 'all of it has a deadline'
        : noDeadlineHours === hours
          ? 'none of it has a deadline'
          : `${hoursText(noDeadlineHours)} ${noDeadlineHours === 1 ? 'has' : 'have'} no deadline`
    }.`,
  )

  if (f.allDone) say('all_done', { date: f.allDone }, `All of it is done by ${f.allDone}.`)

  return { parts, text: joinSentences(parts) }
}
