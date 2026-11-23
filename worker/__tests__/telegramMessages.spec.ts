// Unit tests for what the Telegram bot says (worker/pamBot/messages.ts) and the shared helpers in
// src/types/telegram.ts. Pure functions, so no database or fake Bot API.
import { describe, expect, it } from 'vitest'
import { forecast } from '../../src/types/forecast'
import { prioritise } from '../../src/types/priority'
import { DEFAULT_SETTINGS } from '../../src/types/settings'
import { lateTasks, offTrackProjects, quickWins, type ProjectTasks } from '../../src/types/lookups'
import { createEmptyProject, type Project } from '../../src/types/project'
import { createEmptyTask, type Task } from '../../src/types/task'
import { deepLink, formatMinutes, isTimeZone, parseMinutes } from '../../src/types/telegram'
import {
  addedMessage,
  alreadyDoneNote,
  appUrl,
  badCodeMessage,
  briefMessage,
  decodePress,
  doneLine,
  encodePress,
  estimateText,
  goneNote,
  helpMessage,
  lateMessage,
  linkedMessage,
  markTask,
  MAX_MESSAGE_LENGTH,
  nextMessage,
  noProjectMessage,
  notTodayLine,
  offTrackMessage,
  parseCommand,
  projectGoneNote,
  projectTasksMessage,
  quickWinsMessage,
  severalProjectsMessage,
  startCode,
  stoppedMessage,
  tasksUsage,
  todayMessage,
  unlinkedMessage,
  visibleTasks,
} from '../pamBot/messages'
import { briefDue, dueDateFor, localDateTime } from '../pamBot/schedule'
import {
  carriedErrandMessage,
  decodePress as decodeErrandPress,
  encodePress as encodeErrandPress,
  errandsMessage,
  markErrand,
  MAX_ERRANDS_SHOWN,
  type ButtonPress as ErrandPress,
} from '../pamBot/messages'

const ORIGIN = 'https://pam.example'

describe('startCode', () => {
  it('reads the code a t.me ?start= link sends', () => {
    expect(startCode('/start 0123abcdef')).toBe('0123abcdef')
    expect(startCode('/start@PamBot A-z_9')).toBe('A-z_9')
    expect(startCode('/start   abc  ')).toBe('abc')
    expect(startCode(`/start ${'a'.repeat(64)}`)).toBe('a'.repeat(64))
  })

  it('is null for anything else', () => {
    for (const text of [undefined, '', '/start', '/start ', 'start abc', '/starter abc', '/start a b', '/start a.b', `/start ${'a'.repeat(65)}`, ' /start abc']) {
      expect(startCode(text), String(text)).toBeNull()
    }
  })
})

describe('messages', () => {
  it('say who the chat is linked to and when the brief comes', () => {
    expect(linkedMessage(ORIGIN, { email: 'me@example.com', timeZone: 'Europe/London', briefMinutes: 7 * 60 + 5 })).toEqual({
      text:
        'This chat is linked to Pam as me@example.com.\n' +
        'Your morning brief comes at 07:05 (Europe/London) on days with hours for tasks.\n' +
        "Change the time, or turn it off, in Pam's settings: https://pam.example/settings",
    })
  })

  it('point to the settings page for a new code, or to link again', () => {
    expect(badCodeMessage(ORIGIN).text).toBe(
      "That link has expired or was already used. Get a new one from Connect in Pam's settings: https://pam.example/settings",
    )
    expect(unlinkedMessage(ORIGIN).text).toBe(
      "This chat is no longer linked to Pam. To link it again, use Connect in Pam's settings: https://pam.example/settings",
    )
  })

  it('link to pages of Pam from APP_ORIGIN', () => {
    expect(appUrl(ORIGIN, '/tasks/abc')).toBe('https://pam.example/tasks/abc')
  })
})

describe('shared helpers', () => {
  it('write and read brief times', () => {
    expect(formatMinutes(0)).toBe('00:00')
    expect(formatMinutes(450)).toBe('07:30')
    expect(formatMinutes(1439)).toBe('23:59')
    expect(parseMinutes('07:30')).toBe(450)
    expect(parseMinutes('23:59')).toBe(1439)
    for (const bad of ['24:00', '7:30', '07:60', '', '07:30:00']) expect(parseMinutes(bad), bad).toBeNull()
  })

  it('know IANA time zones', () => {
    for (const zone of ['UTC', 'Asia/Singapore', 'America/New_York']) expect(isTimeZone(zone)).toBe(true)
    for (const zone of ['', 'Mars/Olympus', 7, null, 'x'.repeat(101)]) expect(isTimeZone(zone)).toBe(false)
  })

  it('build the deep link', () => {
    expect(deepLink('PamBot', 'abc_1-2')).toBe('https://t.me/PamBot?start=abc_1-2')
  })
})

describe('localDateTime', () => {
  it("gives the date and time on the user's clock", () => {
    // Singapore is 8 hours ahead, so its morning is the evening before in UTC
    expect(localDateTime(new Date('2026-11-15T23:30:00Z'), 'Asia/Singapore')).toEqual({ date: '2026-11-16', minutes: 450 })
    // Kathmandu is 5:45 ahead: still on a quarter hour
    expect(localDateTime(new Date('2026-11-16T01:45:00Z'), 'Asia/Kathmandu')).toEqual({ date: '2026-11-16', minutes: 450 })
    expect(localDateTime(new Date('2026-11-16T00:00:00Z'), 'UTC')).toEqual({ date: '2026-11-16', minutes: 0 })
    expect(localDateTime(new Date('2026-11-16T23:59:00Z'), 'UTC')).toEqual({ date: '2026-11-16', minutes: 1439 })
  })

  it('follows daylight saving time', () => {
    expect(localDateTime(new Date('2026-07-01T11:30:00Z'), 'America/New_York')).toEqual({ date: '2026-07-01', minutes: 450 })
    expect(localDateTime(new Date('2026-12-01T12:30:00Z'), 'America/New_York')).toEqual({ date: '2026-12-01', minutes: 450 })
  })
})

describe('briefDue', () => {
  const link = { enabled: true, briefMinutes: 450, lastBriefDate: '2026-11-15' }
  const at = (minutes: number, date = '2026-11-16') => ({ date, minutes })

  it('is due once the brief time is reached, once a day', () => {
    expect(briefDue(link, at(449), 480)).toBe(false)
    expect(briefDue(link, at(450), 480)).toBe(true)
    expect(briefDue(link, at(1439), 480)).toBe(true)
    expect(briefDue({ ...link, lastBriefDate: '2026-11-16' }, at(600), 480)).toBe(false)
    expect(briefDue({ ...link, lastBriefDate: null }, at(450), 480)).toBe(true)
  })

  it('is never due when turned off, or on a day with no hours for tasks', () => {
    expect(briefDue({ ...link, enabled: false }, at(450), 480)).toBe(false)
    expect(briefDue(link, at(450), 0)).toBe(false)
  })
})

describe('briefMessage', () => {
  const today = '2026-11-16' // a Monday
  const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id, name: id, ...fields })
  const briefOf = (tasks: Task[], settings = DEFAULT_SETTINGS) => {
    const priorities = prioritise(tasks, [], settings, today)
    const result = forecast(tasks, [], settings, today, priorities)
    return { priorities, result, message: briefMessage(ORIGIN, priorities, result) }
  }
  const reasonOf = (priorities: ReturnType<typeof prioritise>, id: string) => priorities.tasks.find((t) => t.taskId === id)!.reason.text

  it("is the forecast's brief, what it leaves out, then the top two tasks with their hours and reasons", () => {
    const tasks = [
      task('o1', { name: 'Report', dueDate: '2026-11-10', effortMinutes: 90 }),
      task('o2', { name: 'Slides', dueDate: '2026-11-12' }),
      task('o3', { name: 'Email', dueDate: '2026-11-13', effortMinutes: 30 }),
      task('pinned', { pinnedDate: today, effortMinutes: 60 }),
      task('later', { effortMinutes: 60 }),
    ]
    const { priorities, result, message } = briefOf(tasks)
    expect(visibleTasks(priorities).map((t) => t.taskId)).toEqual(['o1', 'o2', 'o3', 'pinned', 'later'])

    expect(message.text).toBe(
      [
        result.brief.text,
        'Plus 1 more overdue and 1 more to do now.',
        'Start with:',
        `1. Report (1.5 h). ${reasonOf(priorities, 'o1')}`,
        `2. Slides (2 h, no estimate). ${reasonOf(priorities, 'o2')}`,
      ].join('\n'),
    )
    expect(message.buttons).toEqual([
      [
        { text: '1 Done', callback_data: 'd:o1' },
        { text: '1 Not today', callback_data: 'nt:o1' },
      ],
      [
        { text: '2 Done', callback_data: 'd:o2' },
        { text: '2 Not today', callback_data: 'nt:o2' },
      ],
      [
        { text: 'Next', callback_data: 'next:2' },
        { text: 'Open Pam', url: 'https://pam.example/' },
      ],
    ])
  })

  it('counts the buffer in the hours', () => {
    const { message } = briefOf([task('t', { effortMinutes: 120 })], { ...DEFAULT_SETTINGS, buffer: 1.5 })
    expect(message.text.split('\n').at(-1)).toMatch(/^1\. t \(3 h\)\. /)
  })

  it('leaves out the count line, and Next, when everything fits', () => {
    const { result, message } = briefOf([task('a', { effortMinutes: 60 }), task('b', { effortMinutes: 30 })])
    expect(message.text.split('\n').slice(0, 2)).toEqual([result.brief.text, 'Start with:'])
    expect(message.buttons!.at(-1)).toEqual([{ text: 'Open Pam', url: 'https://pam.example/' }])
  })

  it("leaves out the buttons of a task whose id doesn't fit in callback data", () => {
    const fits = 'x'.repeat(61) // "nt:" and 61 characters make 64 bytes
    const tooLong = 'y'.repeat(62)
    const { message } = briefOf([task(fits, { name: 'Fits', effortMinutes: 30 }), task(tooLong, { name: 'Too long', effortMinutes: 60 })])
    expect(message.text).toContain('Too long')
    expect(message.buttons!.flat().map((b) => b.text)).toEqual(['1 Done', '1 Not today', 'Open Pam'])
    expect(message.buttons![0]![1]).toEqual({ text: '1 Not today', callback_data: `nt:${fits}` })
  })

  it('is one short line when there is nothing to start', () => {
    expect(briefOf([]).message).toEqual({ text: 'No open tasks today.' })
    expect(briefOf([task('done', { completed: true })]).message).toEqual({ text: 'No open tasks today.' })
    const { priorities, message } = briefOf([task('soon', { startDate: '2026-11-17' })])
    expect(message).toEqual({ text: `Nothing to start today. ${priorities.hiddenSummary!.text}` })
  })
})

describe('encodePress', () => {
  it('puts the action and the task, or the offset, in the callback data', () => {
    expect(encodePress({ action: 'done', taskId: 'abc' })).toBe('d:abc')
    expect(encodePress({ action: 'not_today', taskId: 'abc' })).toBe('nt:abc')
    expect(encodePress({ action: 'next', offset: 4 })).toBe('next:4')
    expect(encodePress({ action: 'project', projectId: 'p1' })).toBe('tp:p1')
  })
})

describe('decodePress', () => {
  it('reads back what encodePress makes', () => {
    for (const press of [
      { action: 'done', taskId: 'abc' },
      { action: 'not_today', taskId: 'a:b c' },
      { action: 'next', offset: 0 },
      { action: 'next', offset: 12 },
      { action: 'project', projectId: 'p:1' },
    ] as const) {
      expect(decodePress(encodePress(press))).toEqual(press)
    }
  })

  it('is null for data the bot did not make', () => {
    for (const data of [undefined, '', 'd:', 'x:abc', 'next:', 'next:-1', 'next:01', 'next:1.5', 'next:abc', `d:${'a'.repeat(63)}`, 'tp:', `tp:${'a'.repeat(62)}`]) {
      expect(decodePress(data), String(data)).toBeNull()
    }
  })
})

describe('parseCommand', () => {
  it('reads the command, with or without the bot named, and what follows it', () => {
    expect(parseCommand('/next', 'PamBot')).toEqual({ command: 'next', args: '' })
    expect(parseCommand('/Next@pambot', 'PamBot')).toEqual({ command: 'next', args: '' })
    expect(parseCommand('  /add Write the report  ', 'PamBot')).toEqual({ command: 'add', args: 'Write the report' })
    expect(parseCommand('/desc line one\nline two', 'PamBot')).toEqual({ command: 'desc', args: 'line one\nline two' })
  })

  it('is null for other text, and for a command to another bot', () => {
    for (const text of [undefined, '', 'next', 'hello /next', '/', '/next@OtherBot', '/ne-xt']) {
      expect(parseCommand(text, 'PamBot'), String(text)).toBeNull()
    }
  })
})

describe('nextMessage', () => {
  const today = '2026-11-16'
  const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id, name: id, effortMinutes: 60, ...fields })
  const tasks = ['a', 'b', 'c'].map((id, i) => task(id, { dueDate: `2026-11-1${7 + i}` }))
  const priorities = prioritise(tasks, [], DEFAULT_SETTINGS, today)
  const reason = (id: string) => priorities.tasks.find((t) => t.taskId === id)!.reason.text

  it('is the top two, with their buttons, Next and Open Pam', () => {
    expect(nextMessage(ORIGIN, priorities)).toEqual({
      text: ['Next up:', `1. a (1 h). ${reason('a')}`, `2. b (1 h). ${reason('b')}`].join('\n'),
      buttons: [
        [
          { text: '1 Done', callback_data: 'd:a' },
          { text: '1 Not today', callback_data: 'nt:a' },
        ],
        [
          { text: '2 Done', callback_data: 'd:b' },
          { text: '2 Not today', callback_data: 'nt:b' },
        ],
        [
          { text: 'Next', callback_data: 'next:2' },
          { text: 'Open Pam', url: 'https://pam.example/' },
        ],
      ],
    })
  })

  it('goes on from an offset, numbering on, with no Next after the last', () => {
    const message = nextMessage(ORIGIN, priorities, 2)
    expect(message.text).toBe(['Then:', `3. c (1 h). ${reason('c')}`].join('\n'))
    expect(message.buttons!.at(-1)).toEqual([{ text: 'Open Pam', url: 'https://pam.example/' }])
  })

  it('says when there are no more, or none at all', () => {
    expect(nextMessage(ORIGIN, priorities, 3)).toEqual({
      text: "That's every task for today.",
      buttons: [[{ text: 'Open Pam', url: 'https://pam.example/' }]],
    })
    expect(nextMessage(ORIGIN, prioritise([], [], DEFAULT_SETTINGS, today))).toEqual({ text: 'No open tasks today.' })
  })
})

describe('todayMessage', () => {
  const today = '2026-11-16' // a Monday, with 6 hours for tasks by default
  const of = (tasks: Task[]) => {
    const priorities = prioritise(tasks, [], DEFAULT_SETTINGS, today)
    return forecast(tasks, [], DEFAULT_SETTINGS, today, priorities)
  }

  it("is the brief's sentence about today, then the plan in the order the work happens", () => {
    const result = of([
      { ...createEmptyTask(), id: 'a', name: 'Report', dueDate: '2026-11-17', effortMinutes: 90 },
      { ...createEmptyTask(), id: 'b', name: 'Thesis', dueDate: '2026-11-30', effortMinutes: 20 * 60 },
    ])
    expect(result.todayPlan.map((i) => [i.name, i.finishes])).toEqual([
      ['Report', true],
      ['Thesis', false],
    ])
    const [first, second] = result.todayPlan
    expect(todayMessage(ORIGIN, result)).toEqual({
      text: [result.brief.parts[0]!.text, `1. Report (${first!.hours} h)`, `2. Thesis (${second!.hours} h, more after today)`].join('\n'),
      buttons: [[{ text: 'Open Pam', url: 'https://pam.example/' }]],
    })
  })

  it('is one line on a day with nothing planned', () => {
    expect(todayMessage(ORIGIN, of([])).text).toBe('Nothing is planned for today.')
  })
})

describe('markTask', () => {
  const buttons = [
    [
      { text: '1 Done', callback_data: 'd:a' },
      { text: '1 Not today', callback_data: 'nt:a' },
    ],
    [
      { text: '2 Done', callback_data: 'd:b' },
      { text: '2 Not today', callback_data: 'nt:b' },
    ],
    [
      { text: 'Next', callback_data: 'next:2' },
      { text: 'Open Pam', url: 'https://pam.example/' },
    ],
  ]

  it("adds the line at the end and takes away only that task's buttons", () => {
    expect(markTask({ text: 'Start with:\n1. A\n2. B', buttons }, 'b', doneLine('B'))).toEqual({
      text: 'Start with:\n1. A\n2. B\nDone: B',
      buttons: [buttons[0], buttons[2]],
    })
    expect(markTask({ text: 'x', buttons }, 'a', notTodayLine('A')).text).toBe('x\nNot today: A')
  })

  it('keeps the text as it is when the line would make it too long', () => {
    const text = 'x'.repeat(MAX_MESSAGE_LENGTH - 3)
    expect(markTask({ text, buttons }, 'a', doneLine('A'))).toEqual({ text, buttons: buttons.slice(1) })
  })
})

describe('help and notes', () => {
  it('list the commands, and say what changed', () => {
    expect(helpMessage(ORIGIN).text.split('\n').slice(0, 14)).toEqual([
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
      '/errand <name>: add an errand for today, such as /errand Buy milk',
      "/errands: today's errands, with Done buttons",
      '/help: this list',
    ])
    expect(stoppedMessage(ORIGIN).text).toBe("The morning brief is off. To turn it back on, use Pam's settings: https://pam.example/settings")
    expect(alreadyDoneNote('Report').text).toBe('"Report" is already done.')
    expect(goneNote.text).toBe('That task is no longer in Pam.')
  })
})

describe('the field buttons', () => {
  it('put the choice before the task id, and read back', () => {
    const presses = [
      { action: 'priority', taskId: 'abc', value: 'urgent' },
      { action: 'due', taskId: 'a:b', value: 'week' },
      { action: 'estimate', taskId: 'abc', value: 240 },
    ] as const
    expect(presses.map(encodePress)).toEqual(['p:urgent:abc', 'due:week:a:b', 'e:240:abc'])
    for (const press of presses) expect(decodePress(encodePress(press))).toEqual(press)
  })

  it('refuse choices the buttons never offer', () => {
    for (const data of ['p:medium:abc', 'p:low', 'due:monday:abc', 'e:45:abc', 'e:030:abc', 'e:60']) {
      expect(decodePress(data), data).toBeNull()
    }
  })
})

describe('dueDateFor', () => {
  it('is today, tomorrow, or the coming Friday', () => {
    expect(dueDateFor('today', '2026-11-16')).toBe('2026-11-16')
    expect(dueDateFor('tomorrow', '2026-11-30')).toBe('2026-12-01')
    // Monday to Friday 16 to 20 November 2026, then the weekend
    for (const [today, friday] of [
      ['2026-11-16', '2026-11-20'],
      ['2026-11-19', '2026-11-20'],
      ['2026-11-20', '2026-11-20'],
      ['2026-11-21', '2026-11-27'],
      ['2026-11-22', '2026-11-27'],
      ['2026-12-29', '2027-01-01'],
    ]) {
      expect(dueDateFor('week', today!), today).toBe(friday)
    }
  })
})

describe('addedMessage', () => {
  const task = { id: 't1', name: 'Write the report', priority: 'medium', dueDate: null }

  it("shows the task's values now, with a row of buttons for each field and its page", () => {
    expect(addedMessage(ORIGIN, task).text).toBe('Added: Write the report\nPriority: Medium\nDue: none\nEstimate: none')
    expect(addedMessage(ORIGIN, { ...task, priority: 'high', dueDate: '2026-11-20', effortMinutes: 90 }).text).toBe(
      'Added: Write the report\nPriority: High\nDue: 2026-11-20 (Friday)\nEstimate: 1.5 h',
    )
    expect(addedMessage(ORIGIN, task).buttons!.map((row) => row.map((b) => b.text))).toEqual([
      ['Low', 'High', 'Urgent'],
      ['Today', 'Tomorrow', 'End of week'],
      ['30 m', '1 h', '4 h'],
      ['Open in Pam'],
    ])
    expect(addedMessage(ORIGIN, { ...task, id: 'a b/c' }).buttons!.at(-1)).toEqual([
      { text: 'Open in Pam', url: 'https://pam.example/tasks/a%20b%2Fc' },
    ])
  })

  it("keeps only the link when the task's id is too long for callback data", () => {
    const buttons = addedMessage(ORIGIN, { ...task, id: 'x'.repeat(60) }).buttons!
    expect(buttons.map((row) => row.map((b) => b.text))).toEqual([['Open in Pam']])
  })

  it('writes estimates in minutes under an hour, and hours from one', () => {
    expect([30, 59, 60, 240, 100].map(estimateText)).toEqual(['30 m', '59 m', '1 h', '4 h', '1.7 h'])
  })
})

describe('the lookups', () => {
  const today = '2026-11-16' // a Monday
  const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id, name: id, ...fields })
  const project = (id: string, fields: Partial<Project> = {}): Project => ({ ...createEmptyProject(), id, name: id, ...fields })
  const dashboard = [[{ text: 'Open Pam', url: 'https://pam.example/' }]]
  const forecastOf = (tasks: Task[], projects: Project[] = []) => forecast(tasks, projects, DEFAULT_SETTINGS, today)
  const NO_CAPACITY = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 }

  describe('/tasks', () => {
    const thesis: ProjectTasks = {
      projectId: 'p 1',
      name: 'Thesis',
      groups: [
        { group: 'overdue', tasks: [{ taskId: 'a', name: 'Intro', hours: 2, unestimated: true }] },
        { group: 'do_next', tasks: [{ taskId: 'b', name: 'Method', hours: 1.5, unestimated: false }] },
        { group: 'not_started', tasks: [{ taskId: 'c', name: 'Results', hours: 4, unestimated: false }] },
        { group: 'not_counted', tasks: [{ taskId: 'd', name: 'Meeting', hours: null, unestimated: true }] },
      ],
      openCount: 3,
      totalHours: 7.5,
    }

    it("lists the project's open tasks by group, with the count and hours, linking to its page", () => {
      expect(projectTasksMessage(ORIGIN, thesis)).toEqual({
        text: [
          'Thesis: 3 open tasks, 7.5 h.',
          'Overdue',
          '- Intro (2 h, no estimate)',
          'Do next',
          '- Method (1.5 h)',
          'Not started yet',
          '- Results (4 h)',
          'Not counted (from Google Calendar, no estimate)',
          '- Meeting',
        ].join('\n'),
        buttons: [[{ text: 'Open Pam', url: 'https://pam.example/projects/p%201' }]],
      })
      expect(projectTasksMessage(ORIGIN, { ...thesis, groups: [], openCount: 0, totalHours: 0 }).text).toBe('"Thesis" has no open tasks.')
      expect(projectTasksMessage(ORIGIN, { ...thesis, openCount: 1 }).text.split('\n')[0]).toBe('Thesis: 1 open task, 7.5 h.')
    })

    it('cuts a long list to fit one message, saying how many are left out', () => {
      const many = Array.from({ length: 300 }, (_, i) => ({ taskId: `t${i}`, name: `A task with a longish name ${i}`, hours: 1, unestimated: false }))
      const { text } = projectTasksMessage(ORIGIN, { ...thesis, groups: [{ group: 'do_next', tasks: many }], openCount: 300, totalHours: 300 })
      expect(text.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH)
      const lines = text.split('\n')
      const shown = lines.filter((l) => l.startsWith('- ')).length
      expect(shown).toBeGreaterThan(50)
      expect(lines.at(-1)).toBe(`And ${300 - shown} more in Pam.`)
    })

    it('offers a button for each match, or a link when its id is too long for callback data', () => {
      const message = severalProjectsMessage(ORIGIN, ' thesis ', [
        { projectId: 'p1', name: 'Thesis' },
        { projectId: 'x'.repeat(62), name: 'Thesis defence' },
      ])
      expect(message).toEqual({
        text: '2 projects match "thesis". Which one?',
        buttons: [
          [{ text: 'Thesis', callback_data: 'tp:p1' }],
          [{ text: 'Thesis defence', url: `https://pam.example/projects/${'x'.repeat(62)}` }],
          ...dashboard,
        ],
      })
    })

    it('lists the projects when nothing matches, and says how to use it', () => {
      expect(
        noProjectMessage(ORIGIN, 'zzz', [
          { projectId: 'a', name: 'Thesis' },
          { projectId: 'b', name: 'Garden' },
        ]),
      ).toEqual({ text: 'No project matches "zzz". Your projects:\n- Thesis\n- Garden', buttons: dashboard })
      expect(noProjectMessage(ORIGIN, 'zzz', []).text).toBe('No project matches "zzz". You have no open projects.')
      expect(tasksUsage(ORIGIN)).toEqual({ text: "Send /tasks and part of a project's name, such as /tasks thesis.", buttons: dashboard })
      expect(projectGoneNote.text).toBe('That project is no longer open in Pam.')
    })
  })

  describe('/late', () => {
    it("starts with the brief's own sentence, then each task's deadline and projected finish", () => {
      const tasks = [task('Report', { dueDate: '2026-11-17', effortMinutes: 20 * 60 }), task('Essay', { dueDate: '2026-11-20', effortMinutes: 60 })]
      const result = forecastOf(tasks)
      const message = lateMessage(ORIGIN, result, lateTasks(result))
      expect(message.text).toBe(
        '1 task is projected to finish after its deadline.\n1. Report: deadline 2026-11-17 (Tuesday), projected 2026-11-18 (Wednesday).',
      )
      // One task links to its own page
      expect(message.buttons).toEqual([[{ text: 'Open Pam', url: 'https://pam.example/tasks/Report' }]])
    })

    it("says when a task doesn't finish, links to the dashboard for several, and says when nothing is late", () => {
      const tasks = [task('a', { dueDate: '2026-11-17' }), task('b', { dueDate: '2026-11-18' })]
      const result = forecast(tasks, [], { ...DEFAULT_SETTINGS, capacityMinutes: NO_CAPACITY }, today)
      const message = lateMessage(ORIGIN, result, lateTasks(result))
      expect(message.text.split('\n')).toEqual([
        '2 tasks are projected to finish after their deadline.',
        "1. a: deadline 2026-11-17 (Tuesday), doesn't finish in the forecast.",
        "2. b: deadline 2026-11-18 (Wednesday), doesn't finish in the forecast.",
      ])
      expect(message.buttons).toEqual(dashboard)
      const fine = forecastOf([])
      expect(lateMessage(ORIGIN, fine, lateTasks(fine))).toEqual({ text: 'No task is projected to finish after its deadline.', buttons: dashboard })
    })
  })

  describe('/offtrack', () => {
    it("gives each project's pace, projected finish and delivery date", () => {
      const tasks = [task('a', { effortMinutes: 48 * 60 }), task('b', { effortMinutes: 60 })]
      const projects = [project('Thesis', { deliveryDate: '2026-11-20', taskIds: ['a'] })]
      expect(offTrackMessage(ORIGIN, offTrackProjects(forecastOf(tasks, projects)))).toEqual({
        text: '1 project is off track:\n1. Thesis: Behind, projected 2026-11-23 (Monday), delivery 2026-11-20 (Friday).',
        buttons: [[{ text: 'Open Pam', url: 'https://pam.example/projects/Thesis' }]],
      })
    })

    it("says when a project doesn't finish, links to the dashboard for several, and says when all are on pace", () => {
      const message = offTrackMessage(ORIGIN, [
        { projectId: 'a', name: 'A', pace: 'tight', finish: '2026-11-19', deliveryDate: '2026-11-20' },
        { projectId: 'b', name: 'B', pace: null, finish: null, deliveryDate: '2026-11-20' },
      ])
      expect(message.text.split('\n')).toEqual([
        '2 projects are off track:',
        '1. A: Tight, projected 2026-11-19 (Thursday), delivery 2026-11-20 (Friday).',
        "2. B: doesn't finish in the forecast, delivery 2026-11-20 (Friday).",
      ])
      expect(message.buttons).toEqual(dashboard)
      expect(offTrackMessage(ORIGIN, [])).toEqual({ text: 'Every project with a delivery date is on pace.', buttons: dashboard })
    })
  })

  describe('/quickwins', () => {
    it('lists the quick wins as the brief does, with their total hours', () => {
      const tasks = [task('Email Sam', { effortMinutes: 30, dueDate: '2026-11-17' }), task('Call', { effortMinutes: 60 }), task('Long', { effortMinutes: 120 })]
      const priorities = prioritise(tasks, [], DEFAULT_SETTINGS, today)
      const reason = (id: string) => priorities.tasks.find((t) => t.taskId === id)!.reason.text
      expect(quickWinsMessage(ORIGIN, quickWins(priorities))).toEqual({
        text: `Quick wins: 2 tasks, 1.5 h in all.\n1. Email Sam (0.5 h). ${reason('Email Sam')}\n2. Call (1 h). ${reason('Call')}`,
        buttons: dashboard,
      })
    })

    it('says how to get some when there are none', () => {
      expect(quickWinsMessage(ORIGIN, { tasks: [], totalHours: 0 })).toEqual({
        text: 'No task you can start now takes 1 h or less. Tasks with no estimate count as 2 h, so give quick ones an estimate.',
        buttons: dashboard,
      })
    })
  })
})

describe('errand buttons and messages', () => {
  it('write and read each errand press, and refuse what the bot never made', () => {
    const presses: ErrandPress[] = [
      { action: 'errands' },
      { action: 'errand_done', taskId: 'a:b' },
      { action: 'plan', taskId: 'e', value: 'today' },
      { action: 'plan', taskId: 'e', value: 'tomorrow' },
      { action: 'pick', taskId: 'e' },
      { action: 'drop', taskId: 'e' },
    ]
    expect(presses.map(encodeErrandPress)).toEqual(['er:today', 'ed:a:b', 'pl:today:e', 'pl:tomorrow:e', 'pk:e', 'dr:e'])
    for (const press of presses) expect(decodeErrandPress(encodeErrandPress(press))).toEqual(press)
    expect(decodeErrandPress('er:later')).toBeNull()
    expect(decodeErrandPress('pl:someday:e')).toBeNull()
  })

  it('offers only the link under a carried-over errand whose id is too long for the buttons', () => {
    const item = { taskId: 'x'.repeat(60), name: 'Long', hours: 0.5, carriedDays: 1 }
    expect(carriedErrandMessage('https://pam.example', item)).toEqual({
      text: 'Carried over: Long (30 m), planned yesterday',
      buttons: [[{ text: 'Open in Pam', url: `https://pam.example/tasks/${'x'.repeat(60)}` }]],
    })
  })

  it('lists at most MAX_ERRANDS_SHOWN errands, and says when there are none', () => {
    const items = Array.from({ length: MAX_ERRANDS_SHOWN + 2 }, (_, i) => ({ taskId: `e${i}`, name: `E${i}`, hours: 1, carriedDays: 0 }))
    const message = errandsMessage('https://pam.example', items)
    expect(message.text.split('\n')).toHaveLength(MAX_ERRANDS_SHOWN + 2)
    expect(message.text).toContain('And 2 more in Pam.')
    expect(message.buttons).toHaveLength(MAX_ERRANDS_SHOWN + 1)
    expect(errandsMessage('https://pam.example', []).text).toBe('No errands today. Add one with /errand and its name.')
  })

  it("take only that errand's buttons away when it's done", () => {
    const marked = markErrand(
      { text: 'List', buttons: [[{ text: '1 Done', callback_data: 'ed:a' }], [{ text: '2 Done', callback_data: 'ed:b' }]] },
      'a',
      'Done: A',
    )
    expect(marked).toEqual({ text: 'List\nDone: A', buttons: [[{ text: '2 Done', callback_data: 'ed:b' }]] })
  })
})
