// Exporting one project's tasks to share: a copy made from the loaded data, never a change to
// it. exportRows picks what goes out, and each format in FORMATS turns that into text. Adding a
// format is one entry in FORMATS plus its function.
import type { Project } from './project'
import type { Priority, Task } from './task'

// What an export holds. Relations, and the project's description, tags, links and priority,
// are left out.
export interface ExportTask {
  id: string
  name: string
  dueDate: string | null
  priority: Priority
  completed: boolean
  description: string
}

export interface ExportData {
  project: { name: string; deliveryDate: string | null }
  tasks: ExportTask[] // in the project's order
}

export interface ExportMeta {
  exportedAt: string // ISO datetime, for the JSON
}

export interface ExportOptions {
  includeCompleted: boolean
}

// The project's tasks in its own order, leaving out ids with no task and, unless asked for,
// completed tasks
export function exportRows(project: Project, tasks: Task[], { includeCompleted }: ExportOptions): ExportData {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  return {
    project: { name: project.name, deliveryDate: project.deliveryDate },
    tasks: project.taskIds
      .map((id) => byId.get(id))
      .filter((t): t is Task => t !== undefined && (includeCompleted || !t.completed))
      .map((t) => ({
        id: t.id,
        name: t.name,
        dueDate: t.dueDate,
        priority: t.priority,
        completed: t.completed,
        description: t.description,
      })),
  }
}

// Readable formats

const NO_TASKS = 'No tasks'
const deliveryLine = (date: string | null) => (date ? `Delivery date: ${date}` : 'No delivery date')
const taskDetails = (task: ExportTask) =>
  `${task.name} · ${task.dueDate ? `Due ${task.dueDate}` : 'No due date'} · Priority: ${task.priority}`

// Each line of the description with `indent` in front, leaving blank lines empty
const indented = (text: string, indent: string) =>
  text
    .split(/\r\n|\r|\n/)
    .map((line) => (line.trim() ? indent + line : ''))
    .join('\n')

// A heading, the delivery date, then a checklist. A description goes under its task, indented
// so it stays part of that list item.
export function toMarkdown(data: ExportData, _meta: ExportMeta): string {
  const lines = [`# ${data.project.name}`, '', deliveryLine(data.project.deliveryDate), '']
  if (data.tasks.length === 0) lines.push(NO_TASKS)
  for (const task of data.tasks) {
    lines.push(`- [${task.completed ? 'x' : ' '}] ${taskDetails(task)}`)
    if (task.description.trim()) lines.push('', indented(task.description.trim(), '  '), '')
  }
  return lines.join('\n').replace(/\n+$/, '') + '\n'
}

// The same as the Markdown, with [done] and [ ] in place of its syntax
export function toPlainText(data: ExportData, _meta: ExportMeta): string {
  const lines = [data.project.name, deliveryLine(data.project.deliveryDate), '']
  if (data.tasks.length === 0) lines.push(NO_TASKS)
  for (const task of data.tasks) {
    lines.push(`${task.completed ? '[done]' : '[ ]'} ${taskDetails(task)}`)
    if (task.description.trim()) lines.push(indented(task.description.trim(), '    '))
  }
  return lines.join('\n') + '\n'
}

// CSV

// The UTF-8 byte order mark a CSV starts with
export const CSV_BOM = '\uFEFF'

const CSV_COLUMNS = ['project', 'project_delivery_date', 'task', 'due_date', 'priority', 'completed', 'description']

// A spreadsheet runs a cell starting with one of these as a formula
const FORMULA_START = /^[=+\-@\t\r]/

// RFC 4180: quoted if it holds a comma, quote or line break, with quotes doubled. A value that a
// spreadsheet would read as a formula gets a ' in front, which shows it as text.
export function csvField(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

// A UTF-8 byte order mark first, so Excel reads non-ASCII text correctly, then a header and a
// row per task, with CRLF line endings. A project with no tasks gets one row with only the
// project's columns filled.
export function toCsv(data: ExportData, _meta: ExportMeta): string {
  const { name, deliveryDate } = data.project
  const rows = data.tasks.length
    ? data.tasks.map((t) => [name, deliveryDate ?? '', t.name, t.dueDate ?? '', t.priority, String(t.completed), t.description])
    : [[name, deliveryDate ?? '', '', '', '', '', '']]
  return CSV_BOM + [CSV_COLUMNS, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n'
}

// JSON

export const EXPORT_FORMAT = 'pam-project-export'
export const EXPORT_VERSION = 1

// The structure a future Pam import would read, pretty-printed
export function toJson(data: ExportData, meta: ExportMeta): string {
  const document = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: meta.exportedAt,
    project: { name: data.project.name, deliveryDate: data.project.deliveryDate },
    tasks: data.tasks.map((t) => ({
      id: t.id,
      name: t.name,
      dueDate: t.dueDate,
      priority: t.priority,
      completed: t.completed,
      description: t.description,
    })),
  }
  return JSON.stringify(document, null, 2) + '\n'
}

// Formats, in the order they're offered

export interface ExportFormat {
  id: 'markdown' | 'text' | 'csv' | 'json'
  label: string
  description: string
  extension: string
  mime: string
  render: (data: ExportData, meta: ExportMeta) => string
}

export const FORMATS: ExportFormat[] = [
  {
    id: 'markdown',
    label: 'Markdown',
    description: 'Most readable; good for notes apps, GitHub, chat apps that render Markdown.',
    extension: 'md',
    mime: 'text/markdown;charset=utf-8',
    render: toMarkdown,
  },
  {
    id: 'text',
    label: 'Plain text',
    description: 'Readable anywhere, no formatting symbols.',
    extension: 'txt',
    mime: 'text/plain;charset=utf-8',
    render: toPlainText,
  },
  {
    id: 'csv',
    label: 'CSV',
    description: 'Open in Excel, Google Sheets or Numbers.',
    extension: 'csv',
    mime: 'text/csv;charset=utf-8',
    render: toCsv,
  },
  {
    id: 'json',
    label: 'JSON',
    description: 'Structured data for other tools; the format a future Pam import would use.',
    extension: 'json',
    mime: 'application/json;charset=utf-8',
    render: toJson,
  },
]

// "Thesis (Final)" -> "thesis-final", with accents dropped; "project" if nothing is left
export function slug(name: string) {
  const slugged = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return slugged || 'project'
}

// e.g. "thesis-tasks-2026-11-02.md", for the local date the export was made
export const exportFilename = (projectName: string, format: ExportFormat, date: string) =>
  `${slug(projectName)}-tasks-${date}.${format.extension}`
