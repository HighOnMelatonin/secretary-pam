import { describe, it, expect } from 'vitest'
import { createEmptyProject, type Project } from '../types/project'
import { applyPreset, DEFAULT_SETTINGS, type UserSettings } from '../types/settings'
import { describePace, previewSettings } from '../types/settingsPreview'
import { createEmptyTask, type Task } from '../types/task'

// A Monday; the default capacity is 8 hours Monday to Friday
const today = '2026-11-16'
const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id, name: id, ...fields })

// Balanced puts Important first; Deadline-driven weighs Due tomorrow's deadline more
const tasks = [task('Important', { priority: 'high' }), task('Due tomorrow', { dueDate: '2026-11-17' })]
// Other comes first, so Report finishes Tuesday, a working day before Thesis delivers on Wednesday
const forecastTasks = [task('Other', { priority: 'high', effortMinutes: 360 }), task('Report', { effortMinutes: 360 })]
const thesis: Project = { ...createEmptyProject(), id: 'p', name: 'Thesis', deliveryDate: '2026-11-18', taskIds: ['Report'] }
const longMonday: UserSettings = { ...DEFAULT_SETTINGS, capacityMinutes: { ...DEFAULT_SETTINGS.capacityMinutes, mon: 720 } }

describe('previewSettings', () => {
  it('lists the Suggested order the candidate settings give, saying how each row moves', () => {
    const preview = previewSettings(tasks, [], DEFAULT_SETTINGS, applyPreset(DEFAULT_SETTINGS, 'deadline'), today)
    expect(preview.rows).toEqual([
      {
        taskId: 'Due tomorrow',
        name: 'Due tomorrow',
        category: 'do_next',
        position: 1,
        previousPosition: 2,
        previousCategory: 'do_next',
        move: { code: 'moved', params: { from: 2, to: 1, fromCategory: 'do_next', toCategory: 'do_next' }, text: 'up 1' },
      },
      {
        taskId: 'Important',
        name: 'Important',
        category: 'do_next',
        position: 2,
        previousPosition: 1,
        previousCategory: 'do_next',
        move: { code: 'moved', params: { from: 1, to: 2, fromCategory: 'do_next', toCategory: 'do_next' }, text: 'down 1' },
      },
    ])
    expect(preview.moved).toBe(2)
    expect(preview.summary.text).toBe('Switching from Balanced to Deadline-driven. 2 of 2 tasks would move in Suggested.')
  })

  it('names a row that changes category', () => {
    // With 2 hours on Mondays, the 8-hour task due Tuesday needs all the time left
    const short = { ...DEFAULT_SETTINGS, capacityMinutes: { ...DEFAULT_SETTINGS.capacityMinutes, mon: 120, tue: 360 } }
    const preview = previewSettings([task('Big', { dueDate: '2026-11-17', effortMinutes: 480 })], [], DEFAULT_SETTINGS, short, today)
    expect(preview.rows[0]!.move!.text).toBe('now in Do nowww')
  })

  it('lists the projects whose pace or finish would change, and when everything would be done', () => {
    const preview = previewSettings(forecastTasks, [thesis], DEFAULT_SETTINGS, longMonday, today)
    expect(preview.projects).toEqual([
      {
        projectId: 'p',
        name: 'Thesis',
        before: { pace: 'tight', finish: '2026-11-17' },
        after: { pace: 'on_pace', finish: '2026-11-16' },
        sentence: {
          code: 'project_change',
          params: {
            projectId: 'p',
            project: 'Thesis',
            paceBefore: 'tight',
            finishBefore: '2026-11-17',
            paceAfter: 'on_pace',
            finishAfter: '2026-11-16',
          },
          text: '"Thesis" would go from tight, finishing 2026-11-17, to on pace, finishing 2026-11-16.',
        },
      },
    ])
    expect(preview.allDone).toEqual({ before: '2026-11-17', after: '2026-11-16' })
    expect(preview.summary.parts.map((p) => p.code)).toEqual(['order', 'project_change', 'all_done'])
    expect(preview.summary.text).toBe(
      'The Suggested order would stay the same. "Thesis" would go from tight, finishing 2026-11-17, to on pace, ' +
        'finishing 2026-11-16. Everything would be done by 2026-11-16 instead of 2026-11-17.',
    )
  })

  it('says when a project keeps its pace but moves its finish', () => {
    // Monday off: Report finishes Wednesday, its delivery day, so it's still tight but a day later
    const short = { ...DEFAULT_SETTINGS, capacityMinutes: { ...DEFAULT_SETTINGS.capacityMinutes, mon: 0 } }
    const preview = previewSettings(forecastTasks, [thesis], DEFAULT_SETTINGS, short, today)
    expect(preview.projects[0]!.sentence.text).toBe('"Thesis" would stay tight, finishing 2026-11-18 instead of 2026-11-17.')
  })

  it('says when nothing changes, or there is nothing to suggest', () => {
    const same = previewSettings(tasks, [], DEFAULT_SETTINGS, DEFAULT_SETTINGS, today)
    expect([same.changed, same.moved, same.projects, same.allDone]).toEqual([false, 0, [], null])
    expect(same.summary.text).toBe('These are the settings already saved. The Suggested order would stay the same.')
    expect(previewSettings([], [], DEFAULT_SETTINGS, longMonday, today).summary.text).toBe('There are no tasks to suggest yet.')
  })

  it('returns plain JSON', () => {
    const preview = previewSettings(forecastTasks, [thesis], DEFAULT_SETTINGS, longMonday, today)
    expect(JSON.parse(JSON.stringify(preview))).toEqual(preview)
  })
})

describe('describePace', () => {
  it('reads a pace and finish as words', () => {
    expect(describePace({ pace: 'behind', finish: '2026-11-20' })).toBe('behind, finishing 2026-11-20')
    expect(describePace({ pace: null, finish: '2026-11-20' })).toBe('finishing 2026-11-20')
    expect(describePace({ pace: null, finish: null })).toBe('no forecast')
  })
})
