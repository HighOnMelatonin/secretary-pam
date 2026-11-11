// Importing tasks into a project from a JSON export (the pam-project-export format that toJson in
// export.ts writes). parseImport reads and checks the text, planImport sorts its tasks into new
// ones and duplicates of the project's tasks, and tasksToSave turns the user's choice for each
// duplicate into the tasks to send. Pure functions: nothing here saves anything.
import { EXPORT_FORMAT, EXPORT_VERSION, type ExportTask } from './export'
import { MAX_DESCRIPTION_LENGTH, MAX_ID_LENGTH, MAX_LIST_LENGTH, MAX_NAME_LENGTH } from './limits'
import { resolveTasks, type Project } from './project'
import { PRIORITIES, type Task } from './task'

// A task as read from the file. Fields an export always has may be left out of a file written by
// hand, and get a new task's defaults; id is null when it's left out.
export type ImportTask = Omit<ExportTask, 'id'> & { id: string | null }

export interface ImportFile {
  project: { name: string } | null // the project it was exported from, if the file says
  tasks: ImportTask[]
}

// Why the text can't be imported, in words for the user
export class ImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportError'
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function parseImport(text: string): ImportFile {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new ImportError("This isn't valid JSON. Import reads the JSON that Export makes.")
  }
  if (!isObject(data) || data.format !== EXPORT_FORMAT) {
    throw new ImportError(`This isn't a Pam project export: its "format" should be "${EXPORT_FORMAT}".`)
  }
  if (typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < 1) {
    throw new ImportError('The export\'s "version" should be a whole number.')
  }
  if (data.version > EXPORT_VERSION) {
    throw new ImportError(`This export is from a newer version of Pam (version ${data.version}); this one reads version ${EXPORT_VERSION}.`)
  }
  if (!Array.isArray(data.tasks)) throw new ImportError('The export has no "tasks" list.')
  if (data.tasks.length > MAX_LIST_LENGTH) {
    throw new ImportError(`The export has ${data.tasks.length} tasks; a project can have at most ${MAX_LIST_LENGTH}.`)
  }

  const tasks = data.tasks.map(parseTask)
  const firstWithId = new Map<string, number>()
  tasks.forEach((task, i) => {
    if (task.id === null) return
    const first = firstWithId.get(task.id)
    if (first !== undefined) throw new ImportError(`Tasks ${first + 1} and ${i + 1} have the same id, "${task.id}".`)
    firstWithId.set(task.id, i)
  })

  const project = isObject(data.project) && typeof data.project.name === 'string' ? { name: data.project.name } : null
  return { project, tasks }
}

function parseTask(value: unknown, i: number): ImportTask {
  const problem = (message: string) => new ImportError(`Task ${i + 1}: ${message}`)
  if (!isObject(value)) throw problem('should be an object with a name, due date, priority and so on.')
  const { id = null, name, description = '', dueDate = null, priority = 'medium', completed = false } = value

  if (typeof name !== 'string' || !name.trim()) throw problem('needs a name.')
  const called = (message: string) => problem(`"${name}" ${message}`)
  if (name.length > MAX_NAME_LENGTH) throw called(`has a name longer than ${MAX_NAME_LENGTH} characters.`)
  if (id !== null && (typeof id !== 'string' || !id || id.length > MAX_ID_LENGTH)) {
    throw called(`has an id that isn't a string of 1 to ${MAX_ID_LENGTH} characters.`)
  }
  if (typeof description !== 'string') throw called('has a description that isn\'t text.')
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw called(`has a description longer than ${MAX_DESCRIPTION_LENGTH} characters.`)
  }
  if (dueDate !== null && (typeof dueDate !== 'string' || !DATE.test(dueDate))) {
    throw called('has a due date that isn\'t null or a YYYY-MM-DD date.')
  }
  if (!(PRIORITIES as readonly unknown[]).includes(priority)) {
    throw called(`has a priority that isn't one of ${PRIORITIES.join(', ')}.`)
  }
  if (typeof completed !== 'boolean') throw called('has "completed" that isn\'t true or false.')

  return { id, name, description, dueDate, priority: priority as Task['priority'], completed }
}

// Duplicates

// The fields an import can change, in the order they're compared
export const IMPORT_FIELDS = ['name', 'dueDate', 'priority', 'completed', 'description'] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]

export interface Duplicate {
  current: Task // the project's task, as it is
  imported: Task // the same task with the file's values: its id, relations and Google account stay
  matchedBy: 'id' | 'name'
  differences: ImportField[] // never empty: an identical task isn't a duplicate to choose between
}

export interface ImportPlan {
  added: Task[] // new tasks, in the file's order
  duplicates: Duplicate[] // in the file's order
  unchanged: Task[] // the project's tasks the file has exactly as they are, which are left alone
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

// Sorts the file's tasks against the project's. A file task is a duplicate of the project's task
// with the same id, or failing that of the first one with the same name (ignoring case and the
// spaces around it), with each project task matched once at most. Ids are matched first, so a
// name can't take a task that another file task names by id. Any other file task is new; it keeps
// its id unless a task outside this project already has it (as when importing one project's
// export into another), in which case it is a separate copy with an id from newId.
export function planImport(
  project: Project,
  tasks: Task[],
  file: ImportFile,
  newId: () => string = () => crypto.randomUUID(),
): ImportPlan {
  const own = resolveTasks(project, tasks)
  const matched = new Map<number, { task: Task; by: 'id' | 'name' }>()
  const taken = new Set<string>()
  const match = (i: number, task: Task | undefined, by: 'id' | 'name') => {
    if (!task) return
    matched.set(i, { task, by })
    taken.add(task.id)
  }

  file.tasks.forEach((t, i) => match(i, own.find((o) => o.id === t.id), 'id'))
  file.tasks.forEach((t, i) => {
    if (!matched.has(i)) match(i, own.find((o) => !taken.has(o.id) && sameName(o.name, t.name)), 'name')
  })

  const usedIds = new Set(tasks.map((t) => t.id))
  const plan: ImportPlan = { added: [], duplicates: [], unchanged: [] }
  file.tasks.forEach((t, i) => {
    const fields = { name: t.name, description: t.description, dueDate: t.dueDate, priority: t.priority, completed: t.completed }
    const found = matched.get(i)
    if (!found) {
      const id = t.id !== null && !usedIds.has(t.id) ? t.id : newId()
      usedIds.add(id)
      plan.added.push({ id, relations: [], ...fields })
      return
    }
    const imported = { ...found.task, ...fields }
    const differences = IMPORT_FIELDS.filter((field) => imported[field] !== found.task[field])
    if (differences.length) plan.duplicates.push({ current: found.task, imported, matchedBy: found.by, differences })
    else plan.unchanged.push(found.task)
  })

  const total = project.taskIds.length + plan.added.length
  if (total > MAX_LIST_LENGTH) {
    throw new ImportError(`This would give the project ${total} tasks; a project can have at most ${MAX_LIST_LENGTH}.`)
  }
  return plan
}

export type Choice = 'current' | 'imported'

// The new tasks, then the duplicates whose imported version was chosen. Keeping the current one
// leaves that task out, since it's already in the project as it is.
export const tasksToSave = (plan: ImportPlan, choices: Record<string, Choice>): Task[] => [
  ...plan.added,
  ...plan.duplicates.filter((d) => choices[d.current.id] === 'imported').map((d) => d.imported),
]
