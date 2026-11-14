// What changing the settings would change, before anything is saved: the Suggested list's new
// order, the projects whose forecast pace or finish moves, and when everything is done, with a
// summary in sentences. The settings page shows it, and POST /api/settings/preview returns it for
// a voice front-end to read out before asking to apply. Pure functions over plain data only: no
// Vue, no browser APIs, no clock and relative imports only, since worker/ imports this file too.
import { forecast, PACE_LABELS, type Pace, type ProjectForecast } from './forecast'
import { CATEGORIES, CATEGORY_LABELS, prioritise, type Category, type Priorities } from './priority'
import type { Project } from './project'
import { joinSentences, type Sentence } from './sentence'
import { PRESETS, type UserSettings } from './settings'
import type { Task } from './task'

export interface PreviewRow {
  taskId: string
  name: string
  category: Category
  position: number // 1 for the top of the list
  previousPosition: number
  previousCategory: Category
  move: Sentence | null // e.g. "up 2", "down 1, now in Do nowww"; null when it stays put
}

export interface PaceSummary {
  pace: Pace | null
  finish: string | null
}

export interface ProjectChange {
  projectId: string
  name: string
  before: PaceSummary
  after: PaceSummary
  sentence: Sentence
}

export interface SettingsPreview {
  today: string
  current: UserSettings
  candidate: UserSettings
  changed: boolean // the candidate differs from the current settings
  rows: PreviewRow[] // the shown Suggested list in its new order; settings can't hide or show a task
  moved: number
  projects: ProjectChange[]
  allDone: { before: string | null; after: string | null } | null // null when it doesn't move
  summary: { parts: Sentence[]; text: string }
}

const visibleOrder = (result: Priorities) => CATEGORIES.flatMap((c) => result.sections[c])
const categories = (result: Priorities) =>
  new Map(CATEGORIES.flatMap((c) => result.sections[c].map((id) => [id, c] as [string, Category])))

// e.g. "tight, finishing 2026-11-17", "finishing 2026-11-17" without a pace, or "no forecast"
export function describePace({ pace, finish }: PaceSummary): string {
  if (finish === null) return 'no forecast'
  return pace ? `${PACE_LABELS[pace].toLowerCase()}, finishing ${finish}` : `finishing ${finish}`
}

const summaryOf = (p: ProjectForecast | undefined): PaceSummary => ({ pace: p?.pace ?? null, finish: p?.finish ?? null })

export function previewSettings(
  tasks: Task[],
  projects: Project[],
  current: UserSettings,
  candidate: UserSettings,
  today: string,
): SettingsPreview {
  const now = prioritise(tasks, projects, current, today)
  const next = prioritise(tasks, projects, candidate, today)
  const before = visibleOrder(now)
  const beforeCategory = categories(now)
  const afterCategory = categories(next)
  const names = new Map(next.tasks.map((t) => [t.taskId, t.name]))

  const rows: PreviewRow[] = visibleOrder(next).map((taskId, index) => {
    const category = afterCategory.get(taskId)!
    const previousCategory = beforeCategory.get(taskId)!
    const was = before.indexOf(taskId)
    const parts = [
      was > index ? `up ${was - index}` : was < index ? `down ${index - was}` : '',
      previousCategory !== category ? `now in ${CATEGORY_LABELS[category]}` : '',
    ].filter(Boolean)
    return {
      taskId,
      name: names.get(taskId)!,
      category,
      position: index + 1,
      previousPosition: was + 1,
      previousCategory,
      move: parts.length
        ? { code: 'moved', params: { from: was + 1, to: index + 1, fromCategory: previousCategory, toCategory: category }, text: parts.join(', ') }
        : null,
    }
  })

  const forecastNow = forecast(tasks, projects, current, today, now)
  const forecastNext = forecast(tasks, projects, candidate, today, next)
  const was = new Map(forecastNow.projects.map((p) => [p.projectId, p]))
  const projectChanges: ProjectChange[] = forecastNext.projects
    .filter((p) => was.get(p.projectId)?.pace !== p.pace || was.get(p.projectId)?.finish !== p.finish)
    .map((p) => {
      const b = summaryOf(was.get(p.projectId))
      const a = summaryOf(p)
      const text =
        a.pace !== null && a.pace === b.pace
          ? `"${p.name}" would stay ${PACE_LABELS[a.pace].toLowerCase()}, finishing ${a.finish} instead of ${b.finish}.`
          : `"${p.name}" would go from ${describePace(b)}, to ${describePace(a)}.`
      const params = { projectId: p.projectId, project: p.name, paceBefore: b.pace, finishBefore: b.finish, paceAfter: a.pace, finishAfter: a.finish }
      return { projectId: p.projectId, name: p.name, before: b, after: a, sentence: { code: 'project_change', params, text } }
    })
  const allDone =
    forecastNow.allDone !== forecastNext.allDone ? { before: forecastNow.allDone, after: forecastNext.allDone } : null

  const changed = JSON.stringify(current) !== JSON.stringify(candidate)
  const moved = rows.filter((r) => r.move !== null).length
  const parts: Sentence[] = []
  if (!changed) parts.push({ code: 'no_change', params: {}, text: 'These are the settings already saved.' })
  if (candidate.preset !== current.preset) {
    parts.push({
      code: 'preset',
      params: { from: current.preset, to: candidate.preset },
      text: `Switching from ${PRESETS[current.preset].label} to ${PRESETS[candidate.preset].label}.`,
    })
  }
  if (rows.length === 0) parts.push({ code: 'order', params: { moved: 0, tasks: 0 }, text: 'There are no tasks to suggest yet.' })
  else if (moved === 0) parts.push({ code: 'order', params: { moved: 0, tasks: rows.length }, text: 'The Suggested order would stay the same.' })
  else {
    parts.push({
      code: 'order',
      params: { moved, tasks: rows.length },
      text: `${moved} of ${rows.length} ${rows.length === 1 ? 'task' : 'tasks'} would move in Suggested.`,
    })
  }
  parts.push(...projectChanges.map((c) => c.sentence))
  if (allDone) {
    parts.push({
      code: 'all_done',
      params: allDone,
      text: `Everything would be done by ${allDone.after ?? 'no date'} instead of ${allDone.before ?? 'no date'}.`,
    })
  }

  return {
    today,
    current,
    candidate,
    changed,
    rows,
    moved,
    projects: projectChanges,
    allDone,
    summary: { parts, text: joinSentences(parts) },
  }
}
