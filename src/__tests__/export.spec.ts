import { describe, it, expect } from 'vitest'
import {
  CSV_BOM,
  csvField,
  exportFilename,
  exportRows,
  FORMATS,
  slug,
  toCsv,
  toJson,
  toMarkdown,
  toPlainText,
  type ExportData,
} from '../types/export'
import { createEmptyProject, type Project } from '../types/project'
import { createEmptyTask, type Task } from '../types/task'

const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id, name: id, ...fields })
const project = (fields: Partial<Project> = {}): Project => ({ ...createEmptyProject(), id: 'p', name: 'Thesis', ...fields })
const meta = { exportedAt: '2026-11-02T08:30:00.000Z' }
const format = (id: string) => FORMATS.find((f) => f.id === id)!

const tasks = [
  task('t1', {
    name: 'Write report',
    dueDate: '2026-11-02',
    priority: 'high',
    description: 'Chapters 1 to 3\n\nThen the appendix',
    relations: [{ taskId: 'secret-task', type: 'blocks' }],
  }),
  task('t2', { name: 'Review slides', completed: true }),
  task('t3', { name: 'Book room', priority: 'low' }),
]
const thesis = project({ deliveryDate: '2026-12-01', taskIds: ['t3', 'missing', 't1', 't2'] })
const all = exportRows(thesis, tasks, { includeCompleted: true })
const empty: ExportData = { project: { name: 'Thesis', deliveryDate: null }, tasks: [] }

describe('exportRows', () => {
  it("lists the project's tasks in its own order, skipping ids with no task", () => {
    expect(all.tasks.map((t) => t.id)).toEqual(['t3', 't1', 't2'])
  })

  it('leaves completed tasks out unless asked to include them', () => {
    expect(exportRows(thesis, tasks, { includeCompleted: false }).tasks.map((t) => t.id)).toEqual(['t3', 't1'])
    expect(all.tasks.map((t) => t.completed)).toEqual([false, false, true])
  })

  it("keeps only the project's name and delivery date, and each task's own fields", () => {
    const busy = project({ description: 'Secret notes', priority: 'urgent', tagIds: ['work'], links: [{ label: 'Repo', url: 'https://example.com' }], taskIds: ['t1'] })
    const rows = exportRows(busy, tasks, { includeCompleted: true })
    expect(rows.project).toEqual({ name: 'Thesis', deliveryDate: null })
    expect(Object.keys(rows.tasks[0]!).sort()).toEqual(['completed', 'description', 'dueDate', 'id', 'name', 'priority'])
  })

  it("doesn't change the project or its tasks", () => {
    const before = structuredClone([thesis, tasks])
    exportRows(thesis, tasks, { includeCompleted: false })
    expect([thesis, tasks]).toEqual(before)
  })
})

describe('export formats', () => {
  it('never include task relations', () => {
    for (const f of FORMATS) {
      const text = f.render(all, meta)
      expect(text, f.id).not.toMatch(/secret-task|blocks|relation/i)
    }
  })

  it('keep non-ASCII text as it is', () => {
    const rows = exportRows(project({ name: 'Café 論文', taskIds: ['t'] }), [task('t', { name: 'Résumé — “draft” ✓', description: 'Ünïcödé 🚀' })], {
      includeCompleted: true,
    })
    for (const f of FORMATS) {
      const text = f.render(rows, meta)
      expect(text, f.id).toContain('Café 論文')
      expect(text, f.id).toContain('Résumé — “draft” ✓')
      expect(text, f.id).toContain('Ünïcödé 🚀')
    }
  })
})

describe('toMarkdown', () => {
  it('writes a heading, the delivery date and a checklist, with descriptions indented under their task', () => {
    expect(toMarkdown(all, meta)).toBe(
      [
        '# Thesis',
        '',
        'Delivery date: 2026-12-01',
        '',
        '- [ ] Book room · No due date · Priority: low',
        '- [ ] Write report · Due 2026-11-02 · Priority: high',
        '',
        '  Chapters 1 to 3',
        '',
        '  Then the appendix',
        '',
        '- [x] Review slides · No due date · Priority: medium',
        '',
      ].join('\n'),
    )
  })

  it('says when there is no delivery date or no task', () => {
    expect(toMarkdown(empty, meta)).toBe('# Thesis\n\nNo delivery date\n\nNo tasks\n')
  })
})

describe('toPlainText', () => {
  it('writes the same content with [ ] and [done] markers and no Markdown syntax', () => {
    const text = toPlainText(all, meta)
    expect(text).toBe(
      [
        'Thesis',
        'Delivery date: 2026-12-01',
        '',
        '[ ] Book room · No due date · Priority: low',
        '[ ] Write report · Due 2026-11-02 · Priority: high',
        '    Chapters 1 to 3',
        '',
        '    Then the appendix',
        '[done] Review slides · No due date · Priority: medium',
        '',
      ].join('\n'),
    )
    expect(text).not.toMatch(/^#|- \[|\[x\]/m)
  })

  it('says when there is no delivery date or no task', () => {
    expect(toPlainText(empty, meta)).toBe('Thesis\nNo delivery date\n\nNo tasks\n')
  })
})

describe('toCsv', () => {
  const lines = (csv: string) => csv.slice(CSV_BOM.length).split('\r\n')

  it('starts with a byte order mark, then a header and a row per task, with CRLF line endings', () => {
    const csv = toCsv(all, meta)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(lines(csv)).toEqual([
      'project,project_delivery_date,task,due_date,priority,completed,description',
      'Thesis,2026-12-01,Book room,,low,false,',
      'Thesis,2026-12-01,Write report,2026-11-02,high,false,"Chapters 1 to 3\n\nThen the appendix"',
      'Thesis,2026-12-01,Review slides,,medium,true,',
      '',
    ])
  })

  it('quotes fields with commas, quotes or line breaks, doubling the quotes', () => {
    expect(csvField('Plain')).toBe('Plain')
    expect(csvField('Draft, then review')).toBe('"Draft, then review"')
    expect(csvField('The "final" one')).toBe('"The ""final"" one"')
    expect(csvField('Line one\nline two')).toBe('"Line one\nline two"')
    expect(csvField('Windows\r\nline')).toBe('"Windows\r\nline"')
  })

  it('stops spreadsheets reading a field as a formula', () => {
    expect(['=SUM(A1:A9)', '+1', '-1', '@cmd', '\tTab'].map(csvField)).toEqual(["'=SUM(A1:A9)", "'+1", "'-1", "'@cmd", "'\tTab"])
    expect(csvField('=HYPERLINK("x", "y")')).toBe(`"'=HYPERLINK(""x"", ""y"")"`)
    expect(csvField('a = b')).toBe('a = b') // only a leading one
  })

  it('leaves missing dates empty, and gives a project with no tasks one row of its own', () => {
    expect(lines(toCsv(empty, meta))).toEqual([
      'project,project_delivery_date,task,due_date,priority,completed,description',
      'Thesis,,,,,,',
      '',
    ])
  })
})

describe('toJson', () => {
  it('parses to the pam-project-export structure, version 1', () => {
    expect(JSON.parse(toJson(all, meta))).toEqual({
      format: 'pam-project-export',
      version: 1,
      exportedAt: '2026-11-02T08:30:00.000Z',
      project: { name: 'Thesis', deliveryDate: '2026-12-01' },
      tasks: [
        { id: 't3', name: 'Book room', dueDate: null, priority: 'low', completed: false, description: '' },
        {
          id: 't1',
          name: 'Write report',
          dueDate: '2026-11-02',
          priority: 'high',
          completed: false,
          description: 'Chapters 1 to 3\n\nThen the appendix',
        },
        { id: 't2', name: 'Review slides', dueDate: null, priority: 'medium', completed: true, description: '' },
      ],
    })
  })

  it('is pretty-printed with two spaces, with nulls for missing dates and no tasks for an empty project', () => {
    const json = toJson(empty, meta)
    expect(json).toContain('\n  "project": {\n    "name": "Thesis",\n    "deliveryDate": null\n  },')
    expect(JSON.parse(json).tasks).toEqual([])
  })
})

describe('exportFilename', () => {
  it('names the file after the project, the date and the format', () => {
    expect(exportFilename('Thesis', format('markdown'), '2026-11-02')).toBe('thesis-tasks-2026-11-02.md')
    expect(FORMATS.map((f) => exportFilename('Thesis', f, '2026-11-02').split('.').pop())).toEqual(['md', 'txt', 'csv', 'json'])
  })

  it('makes a slug of the name, dropping accents and symbols', () => {
    expect(slug('Final Year Project (SUTD) — v2!')).toBe('final-year-project-sutd-v2')
    expect(slug('Café crème')).toBe('cafe-creme')
    expect(slug('  --a--b--  ')).toBe('a-b')
    expect(slug('x'.repeat(80))).toHaveLength(60)
  })

  it('falls back to "project" when nothing of the name is left', () => {
    expect(['', '   ', '!!!', '論文', '🚀'].map(slug)).toEqual(Array(5).fill('project'))
    expect(exportFilename('***', format('json'), '2026-11-02')).toBe('project-tasks-2026-11-02.json')
  })
})

describe('FORMATS', () => {
  it('describes each format with its extension and a UTF-8 MIME type', () => {
    expect(FORMATS.map((f) => [f.id, f.label, f.extension, f.mime])).toEqual([
      ['markdown', 'Markdown', 'md', 'text/markdown;charset=utf-8'],
      ['text', 'Plain text', 'txt', 'text/plain;charset=utf-8'],
      ['csv', 'CSV', 'csv', 'text/csv;charset=utf-8'],
      ['json', 'JSON', 'json', 'application/json;charset=utf-8'],
    ])
    expect(FORMATS.every((f) => f.description.length > 0)).toBe(true)
  })
})
