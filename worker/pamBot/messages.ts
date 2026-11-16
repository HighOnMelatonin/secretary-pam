// What the bot says. Pure functions over plain data, with no I/O and no clock, so each is
// unit-tested (worker/__tests__/telegramMessages.spec.ts). Everything is plain text. Rankings,
// reasons and the brief are the shared functions' own sentences (src/types/priority.ts and
// forecast.ts), never worded here.
import { PACE_LABELS, type Forecast, type PlanItem } from '../../src/types/forecast'
import {
  TASK_GROUP_LABELS,
  visibleTasks,
  type LateTask,
  type LookupTask,
  type OffTrackProject,
  type ProjectName,
  type ProjectTasks,
  type QuickWins,
} from '../../src/types/lookups'
import { formatHours, type Priorities, type ScoredTask } from '../../src/types/priority'
import { formatMinutes } from '../../src/types/telegram'
import type { InlineButton, OutgoingMessage } from './botApi'

// How many tasks a message shows at a time
export const TASKS_PER_MESSAGE = 2
// The most callback data a button can carry (https://core.telegram.org/bots/api#inlinekeyboardbutton)
export const MAX_CALLBACK_BYTES = 64

// What a button asks for. Everything it needs is in its callback data, so nothing is remembered
// between presses.
export type ButtonPress =
  | { action: 'done'; taskId: string }
  | { action: 'not_today'; taskId: string }
  | { action: 'next'; offset: number } // the tasks from this place in the list on
  // The buttons under a task added with /add, each setting one field
  | { action: 'priority'; taskId: string; value: PriorityChoice }
  | { action: 'due'; taskId: string; value: DueChoice }
  | { action: 'estimate'; taskId: string; value: EstimateChoice }
  // A project's tasks, from the buttons under a /tasks reply that matched several projects
  | { action: 'project'; projectId: string }

export const PRIORITY_CHOICES = ['low', 'high', 'urgent'] as const
export type PriorityChoice = (typeof PRIORITY_CHOICES)[number]
export const DUE_CHOICES = ['today', 'tomorrow', 'week'] as const // "week" is the end of the week
export type DueChoice = (typeof DUE_CHOICES)[number]
export const ESTIMATE_CHOICES = [30, 60, 240] as const // minutes
export type EstimateChoice = (typeof ESTIMATE_CHOICES)[number]

const PREFIXES = { done: 'd:', not_today: 'nt:', next: 'next:', priority: 'p:', due: 'due:', estimate: 'e:', project: 'tp:' } as const

// The choice comes before the task id, so an id with ":" in it still reads back
export function encodePress(press: ButtonPress): string {
  switch (press.action) {
    case 'next':
      return `${PREFIXES.next}${press.offset}`
    case 'done':
    case 'not_today':
      return `${PREFIXES[press.action]}${press.taskId}`
    case 'project':
      return `${PREFIXES.project}${press.projectId}`
    default:
      return `${PREFIXES[press.action]}${press.value}:${press.taskId}`
  }
}

const includes = <T>(list: readonly T[], value: unknown): value is T => list.includes(value as T)

// The press a button's callback data stands for, or null for data the bot didn't make
export function decodePress(data: string | undefined): ButtonPress | null {
  const match = /^(d|nt|next|p|due|e|tp):(.+)$/s.exec(data ?? '')
  if (!match || !fits(data!)) return null
  const [, prefix, value] = match as unknown as [string, string, string]
  if (prefix === 'd') return { action: 'done', taskId: value }
  if (prefix === 'nt') return { action: 'not_today', taskId: value }
  if (prefix === 'tp') return { action: 'project', projectId: value }
  if (prefix === 'next') return /^(0|[1-9]\d{0,5})$/.test(value) ? { action: 'next', offset: Number(value) } : null

  const field = /^([a-z0-9]+):(.+)$/s.exec(value)
  if (!field) return null
  const [, choice, taskId] = field as unknown as [string, string, string]
  if (prefix === 'p') return includes(PRIORITY_CHOICES, choice) ? { action: 'priority', taskId, value: choice } : null
  if (prefix === 'due') return includes(DUE_CHOICES, choice) ? { action: 'due', taskId, value: choice } : null
  const minutes = Number(choice)
  return String(minutes) === choice && includes(ESTIMATE_CHOICES, minutes) ? { action: 'estimate', taskId, value: minutes } : null
}

const fits = (data: string) => new TextEncoder().encode(data).length <= MAX_CALLBACK_BYTES

// A page of Pam, e.g. appUrl("https://pam.example", "/settings")
export const appUrl = (origin: string, route: string) => `${origin}${route}`

// The code in "/start <code>", which a t.me/<bot>?start=<code> link sends (the code is 1 to 64 of
// A-Z, a-z, 0-9, _ and -, the characters Telegram allows there); null for any other text
export function startCode(text: string | undefined): string | null {
  const match = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{1,64})\s*$/.exec(text ?? '')
  return match ? match[1]! : null
}

export interface Linked {
  email: string // the Pam account the chat is now linked to
  timeZone: string
  briefMinutes: number
}

export function linkedMessage(origin: string, linked: Linked): OutgoingMessage {
  return {
    text: [
      `This chat is linked to Pam as ${linked.email}.`,
      `Your morning brief comes at ${formatMinutes(linked.briefMinutes)} (${linked.timeZone}) on days with hours for tasks.`,
      `Change the time, or turn it off, in Pam's settings: ${appUrl(origin, '/settings')}`,
    ].join('\n'),
  }
}

// A command sent to the bot, such as "/next" or "/next@PamBot" (as Telegram's menu sends it), with
// whatever follows it. null for other text, and for a command addressed to another bot.
export function parseCommand(text: string | undefined, botUsername: string): { command: string; args: string } | null {
  const match = /^\/([A-Za-z0-9_]{1,32})(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/.exec((text ?? '').trim())
  if (!match) return null
  const [, command, bot, args] = match
  if (bot !== undefined && bot.toLowerCase() !== botUsername.toLowerCase()) return null
  return { command: command!.toLowerCase(), args: (args ?? '').trim() }
}

export function badCodeMessage(origin: string): OutgoingMessage {
  return {
    text: `That link has expired or was already used. Get a new one from Connect in Pam's settings: ${appUrl(origin, '/settings')}`,
  }
}

export function unlinkedMessage(origin: string): OutgoingMessage {
  return { text: `This chat is no longer linked to Pam. To link it again, use Connect in Pam's settings: ${appUrl(origin, '/settings')}` }
}

export function helpMessage(origin: string): OutgoingMessage {
  return {
    text: [
      "Pam's commands:",
      '/next: the next two tasks to do',
      "/today: today's plan",
      '/brief: the morning brief, now',
      '/stop: turn the morning brief off',
      '/add <name>: add a task, then set its priority, due date and estimate with the buttons',
      '/desc <text>: describe the task you last added',
      "/tasks <name>: a project's open tasks, from part of its name",
      '/late: the tasks projected to finish after their deadline',
      '/offtrack: the projects that are tight, behind or never finish',
      '/quickwins: the tasks of an hour or less',
      '/help: this list',
      'The buttons under a task mark it done, or move it to tomorrow (Not today). Next shows the two after.',
    ].join('\n'),
    buttons: [[openPam(origin)]],
  }
}

export function stoppedMessage(origin: string): OutgoingMessage {
  return { text: `The morning brief is off. To turn it back on, use Pam's settings: ${appUrl(origin, '/settings')}` }
}

// For a button whose task has changed since the message was sent
export const alreadyDoneNote = (name: string): OutgoingMessage => ({ text: `"${name}" is already done.` })
export const goneNote: OutgoingMessage = { text: 'That task is no longer in Pam.' }

const openPam = (origin: string): InlineButton => ({ text: 'Open Pam', url: appUrl(origin, '/') })

// The tasks the Suggested list shows, in its order (src/types/lookups.ts)
export { visibleTasks }

// The hours the forecast counts for the task (its estimate times the buffer), e.g. "3 h", or
// "2 h, no estimate" for the default
export const hoursOf = (task: ScoredTask) =>
  task.flags.unestimated ? `${formatHours(task.factors.effortHours)}, no estimate` : formatHours(task.factors.effortHours)

// e.g. "1. Write report (3 h). Due tomorrow"
export const taskLine = (n: number, task: ScoredTask) => `${n}. ${task.name} (${hoursOf(task)}). ${task.reason.text}`

// "<n> Done" and "<n> Not today", or none when the task's id is too long for callback data
function taskButtons(n: number, task: ScoredTask): InlineButton[] | null {
  const done = encodePress({ action: 'done', taskId: task.taskId })
  const later = encodePress({ action: 'not_today', taskId: task.taskId })
  if (!fits(done) || !fits(later)) return null
  return [
    { text: `${n} Done`, callback_data: done },
    { text: `${n} Not today`, callback_data: later },
  ]
}

// The tasks from `offset`, two at a time: their lines, a button row for each, and Next (when there
// are more) and Open Pam
function taskList(origin: string, tasks: ScoredTask[], offset: number) {
  const shown = tasks.slice(offset, offset + TASKS_PER_MESSAGE)
  const lines = shown.map((task, i) => taskLine(offset + i + 1, task))
  const rows = shown.flatMap((task, i) => {
    const row = taskButtons(offset + i + 1, task)
    return row ? [row] : []
  })
  const last: InlineButton[] = []
  const next = offset + TASKS_PER_MESSAGE
  if (next < tasks.length) last.push({ text: 'Next', callback_data: encodePress({ action: 'next', offset: next }) })
  last.push(openPam(origin))
  return { shown, lines, buttons: [...rows, last] }
}

// The one line sent instead of tasks when there are none to start, saying why if some are hidden
function nothingToStart(priorities: Priorities): OutgoingMessage {
  return { text: priorities.hiddenSummary ? `Nothing to start today. ${priorities.hiddenSummary.text}` : 'No open tasks today.' }
}

// e.g. "Plus 3 more overdue and 1 more to do now." for the Overdue and Do nowww tasks the brief
// leaves out; null when it shows them all
function notShownLine(priorities: Priorities, shown: ScoredTask[]): string | null {
  const ids = new Set(shown.map((t) => t.taskId))
  const left = (section: string[]) => section.filter((id) => !ids.has(id)).length
  const parts = [
    [left(priorities.sections.overdue), 'overdue'],
    [left(priorities.sections.do_now), 'to do now'],
  ]
    .filter(([count]) => (count as number) > 0)
    .map(([count, what]) => `${count} more ${what}`)
  return parts.length ? `Plus ${parts.join(' and ')}.` : null
}

// The morning brief: the forecast's brief, how many urgent tasks it leaves out, then the top two
// tasks with their buttons. A single line when there's nothing to start.
export function briefMessage(origin: string, priorities: Priorities, forecast: Forecast): OutgoingMessage {
  const tasks = visibleTasks(priorities)
  if (tasks.length === 0) return nothingToStart(priorities)
  const { shown, lines, buttons } = taskList(origin, tasks, 0)
  const notShown = notShownLine(priorities, shown)
  return { text: [forecast.brief.text, ...(notShown ? [notShown] : []), 'Start with:', ...lines].join('\n'), buttons }
}

// The next tasks to do, two at a time from `offset` (for /next, after a Done or Not today, and for
// Next, whose offset is where the message it was under stopped)
export function nextMessage(origin: string, priorities: Priorities, offset = 0): OutgoingMessage {
  const tasks = visibleTasks(priorities)
  if (tasks.length === 0) return nothingToStart(priorities)
  if (offset >= tasks.length) return { text: "That's every task for today.", buttons: [[openPam(origin)]] }
  const { lines, buttons } = taskList(origin, tasks, offset)
  return { text: [offset === 0 ? 'Next up:' : 'Then:', ...lines].join('\n'), buttons }
}

// e.g. "1. Report (1.5 h)", or "2. Thesis (3 h, more after today)" when the plan doesn't finish it
const planLine = (n: number, item: PlanItem) =>
  `${n}. ${item.name} (${formatHours(item.hours)}${item.finishes ? '' : ', more after today'})`

// /today: the brief's first sentence about today, then the forecast's plan for it in the order the
// work happens
export function todayMessage(origin: string, forecast: Forecast): OutgoingMessage {
  const lines = [forecast.brief.parts[0]!.text, ...forecast.todayPlan.map((item, i) => planLine(i + 1, item))]
  return { text: lines.join('\n'), buttons: [[openPam(origin)]] }
}

// The longest text a message can have (https://core.telegram.org/bots/api#sendmessage)
export const MAX_MESSAGE_LENGTH = 4096

// A message the bot sent, after a button under it was pressed for a task: the line `note` (such as
// "Done: Report") is added at the end, and the task's own buttons are taken away, leaving the rest
export function markTask(message: OutgoingMessage, taskId: string, note: string): OutgoingMessage {
  const own = new Set([encodePress({ action: 'done', taskId }), encodePress({ action: 'not_today', taskId })])
  const buttons = (message.buttons ?? []).filter((row) => !row.some((b) => 'callback_data' in b && own.has(b.callback_data)))
  const text = `${message.text}\n${note}`
  return { text: text.length <= MAX_MESSAGE_LENGTH ? text : message.text, buttons }
}

export const doneLine = (name: string) => `Done: ${name}`
export const notTodayLine = (name: string) => `Not today: ${name}`

// Capture: /add, its buttons, and /desc

// A task's page in Pam
export const taskUrl = (origin: string, taskId: string) => appUrl(origin, `/tasks/${encodeURIComponent(taskId)}`)

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
// e.g. "2026-11-20 (Friday)"
export const dateText = (date: string) => `${date} (${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]})`
// e.g. "30 m", "1 h", "1.5 h"
export const estimateText = (minutes: number) => (minutes < 60 ? `${minutes} m` : formatHours(minutes / 60))
const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

const DUE_LABELS: Record<DueChoice, string> = { today: 'Today', tomorrow: 'Tomorrow', week: 'End of week' }

// The fields /add's buttons set, as the task has them now
export interface AddedTask {
  id: string
  name: string
  priority: string
  dueDate: string | null
  effortMinutes?: number
}

// The reply to /add, and the same message once a button under it has changed a field: the task's
// current values, a row of buttons for each field, and Open in Pam
export function addedMessage(origin: string, task: AddedTask): OutgoingMessage {
  const text = [
    `Added: ${task.name}`,
    `Priority: ${capitalised(task.priority)}`,
    `Due: ${task.dueDate ? dateText(task.dueDate) : 'none'}`,
    `Estimate: ${task.effortMinutes !== undefined ? estimateText(task.effortMinutes) : 'none'}`,
  ].join('\n')
  const button = (text: string, press: ButtonPress): InlineButton => ({ text, callback_data: encodePress(press) })
  const rows: InlineButton[][] = [
    PRIORITY_CHOICES.map((value) => button(capitalised(value), { action: 'priority', taskId: task.id, value })),
    DUE_CHOICES.map((value) => button(DUE_LABELS[value], { action: 'due', taskId: task.id, value })),
    ESTIMATE_CHOICES.map((value) => button(estimateText(value), { action: 'estimate', taskId: task.id, value })),
  ]
  // An id too long for callback data (only one set by hand or imported could be) keeps only the link
  const fitting = rows.filter((row) => row.every((b) => 'callback_data' in b && fits(b.callback_data)))
  return { text, buttons: [...fitting, [{ text: 'Open in Pam', url: taskUrl(origin, task.id) }]] }
}

export const addUsage: OutgoingMessage = { text: "Send /add and the task's name, such as /add Write the report." }
export const nameTooLong = (max: number): OutgoingMessage => ({ text: `A task's name can be at most ${max} characters.` })
export const descUsage: OutgoingMessage = {
  text: 'Send /desc and the description, such as /desc Ask Sam for the figures. It goes on the task you last added with /add.',
}
export const noTaskToDescribe: OutgoingMessage = { text: 'Add a task with /add first, then describe it with /desc.' }
export const descriptionTooLong = (max: number): OutgoingMessage => ({
  text: `A description can be at most ${max.toLocaleString('en-US')} characters.`,
})
export const describedMessage = (name: string): OutgoingMessage => ({ text: `Saved the description of "${name}".` })

// The one line for any other text, which never makes a task
export const hintMessage: OutgoingMessage = { text: 'To add a task, send /add and its name. /help lists everything else.' }

// Lookups: /tasks, /late, /offtrack and /quickwins. What they list comes from src/types/lookups.ts;
// these only word it. Each ends with an Open Pam button to the page that shows the same thing.

const openPamAt = (origin: string, route: string): InlineButton => ({ text: 'Open Pam', url: appUrl(origin, route) })
const projectRoute = (projectId: string) => `/projects/${encodeURIComponent(projectId)}`
const taskRoute = (taskId: string) => `/tasks/${encodeURIComponent(taskId)}`
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

// The head line(s), then as many of the lines as fit in one message. A list cut short ends with
// "And N more in Pam." Only lines marked as items count towards N (not a group's heading).
type Line = { text: string; item: boolean }
function fitted(head: string[], lines: Line[]): string {
  const total = lines.filter((l) => l.item).length
  const kept: Line[] = []
  let length = head.join('\n').length
  let shown = 0
  for (const [i, line] of lines.entries()) {
    // Room for this line, and for the closing line while there are more after it
    const reserve = i < lines.length - 1 ? `\nAnd ${total} more in Pam.`.length : 0
    if (length + 1 + line.text.length + reserve > MAX_MESSAGE_LENGTH) {
      // A heading with none of its items shown goes too
      while (kept.length && !kept[kept.length - 1]!.item) kept.pop()
      return [...head, ...kept.map((l) => l.text), `And ${total - shown} more in Pam.`].join('\n')
    }
    kept.push(line)
    length += 1 + line.text.length
    if (line.item) shown++
  }
  return [...head, ...kept.map((l) => l.text)].join('\n')
}

// e.g. "Write intro (1.5 h)", "Draft (2 h, no estimate)" or "Meeting" for a task not counted
const lookupTaskLine = (task: LookupTask) =>
  task.hours === null ? `- ${task.name}` : `- ${task.name} (${formatHours(task.hours)}${task.unestimated ? ', no estimate' : ''})`

export const tasksUsage = (origin: string): OutgoingMessage => ({
  text: "Send /tasks and part of a project's name, such as /tasks thesis.",
  buttons: [[openPam(origin)]],
})

// /tasks with one match: the project's open tasks by group, with its count and hours
export function projectTasksMessage(origin: string, project: ProjectTasks): OutgoingMessage {
  const buttons = [[openPamAt(origin, projectRoute(project.projectId))]]
  if (project.groups.length === 0) return { text: `"${project.name}" has no open tasks.`, buttons }
  const head = `${project.name}: ${plural(project.openCount, 'open task')}, ${formatHours(project.totalHours)}.`
  const lines = project.groups.flatMap(({ group, tasks }) => [
    { text: TASK_GROUP_LABELS[group], item: false },
    ...tasks.map((t) => ({ text: lookupTaskLine(t), item: true })),
  ])
  return { text: fitted([head], lines), buttons }
}

// /tasks with several matches: a button for each, which sends that project's tasks. A project
// whose id is too long for callback data gets a link to its page instead.
export function severalProjectsMessage(origin: string, query: string, projects: ProjectName[]): OutgoingMessage {
  const rows = projects.map((p): InlineButton[] => {
    const data = encodePress({ action: 'project', projectId: p.projectId })
    return [fits(data) ? { text: p.name, callback_data: data } : { text: p.name, url: appUrl(origin, projectRoute(p.projectId)) }]
  })
  return { text: `${plural(projects.length, 'project')} match "${query.trim()}". Which one?`, buttons: [...rows, [openPam(origin)]] }
}

// /tasks with no match: the projects there are
export function noProjectMessage(origin: string, query: string, projects: ProjectName[]): OutgoingMessage {
  const buttons = [[openPam(origin)]]
  if (projects.length === 0) return { text: `No project matches "${query.trim()}". You have no open projects.`, buttons }
  const lines = projects.map((p) => ({ text: `- ${p.name}`, item: true }))
  return { text: fitted([`No project matches "${query.trim()}". Your projects:`], lines), buttons }
}

// For a project button pressed after the project was deleted or archived
export const projectGoneNote: OutgoingMessage = { text: 'That project is no longer open in Pam.' }

// /late: the brief's own sentence about late tasks, then each with its deadline and projected
// finish. One task links to its page; more, to the dashboard.
export function lateMessage(origin: string, forecast: Forecast, late: LateTask[]): OutgoingMessage {
  if (late.length === 0) return { text: 'No task is projected to finish after its deadline.', buttons: [[openPam(origin)]] }
  const head = forecast.brief.parts.find((p) => p.code === 'late_tasks')!.text
  const lines = late.map((t, i) => ({
    text: `${i + 1}. ${t.name}: deadline ${dateText(t.deadline)}, ${t.finish ? `projected ${dateText(t.finish)}` : "doesn't finish in the forecast"}.`,
    item: true,
  }))
  const route = late.length === 1 ? taskRoute(late[0]!.taskId) : '/'
  return { text: fitted([head], lines), buttons: [[openPamAt(origin, route)]] }
}

// /offtrack: each project with its pace, projected finish and delivery date. One project links
// to its page; more, to the dashboard.
export function offTrackMessage(origin: string, projects: OffTrackProject[]): OutgoingMessage {
  if (projects.length === 0) {
    return { text: 'Every project with a delivery date is on pace.', buttons: [[openPam(origin)]] }
  }
  const lines = projects.map((p, i) => ({
    text: `${i + 1}. ${p.name}: ${
      p.pace === null ? "doesn't finish in the forecast" : `${PACE_LABELS[p.pace]}, projected ${dateText(p.finish!)}`
    }, delivery ${dateText(p.deliveryDate)}.`,
    item: true,
  }))
  const head = `${plural(projects.length, 'project is', 'projects are')} off track:`
  const route = projects.length === 1 ? projectRoute(projects[0]!.projectId) : '/'
  return { text: fitted([head], lines), buttons: [[openPamAt(origin, route)]] }
}

// /quickwins: the tasks of an hour or less, in Suggested order, with their hours in all
export function quickWinsMessage(origin: string, wins: QuickWins): OutgoingMessage {
  const buttons = [[openPam(origin)]]
  if (wins.tasks.length === 0) {
    return {
      text: 'No task you can start now takes 1 h or less. Tasks with no estimate count as 2 h, so give quick ones an estimate.',
      buttons,
    }
  }
  const head = `Quick wins: ${plural(wins.tasks.length, 'task')}, ${formatHours(wins.totalHours)} in all.`
  return { text: fitted([head], wins.tasks.map((t, i) => ({ text: taskLine(i + 1, t), item: true }))), buttons }
}
