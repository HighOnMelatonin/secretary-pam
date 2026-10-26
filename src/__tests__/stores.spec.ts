import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProjectList } from '../stores/projectList'
import { useTagList } from '../stores/tagList'
import { useTaskList } from '../stores/taskList'
import { createEmptyProject, type Project } from '../types/project'
import { createEmptyTask, type Task } from '../types/task'
import { fakeApi } from './fakeApi'

const task = (id: string, fields: Partial<Task> = {}): Task => ({ ...createEmptyTask(), id, name: id, ...fields })
const project = (id: string, fields: Partial<Project> = {}): Project => ({
  ...createEmptyProject(),
  id,
  name: id,
  ...fields,
})

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('taskList', () => {
  it('loads tasks from the API', async () => {
    fakeApi({ tasks: [task('a'), task('b')] })
    const store = useTaskList()
    await store.load()
    expect(store.tasks.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('adds a new task after the API saves it', async () => {
    const api = fakeApi()
    const store = useTaskList()
    await store.saveTask(task('a'))

    expect(api.requests).toEqual(['PUT /api/tasks/a'])
    expect(store.tasks).toEqual([task('a')])
  })

  it('replaces an existing task in place', async () => {
    fakeApi({ tasks: [task('a'), task('b')] })
    const store = useTaskList()
    await store.load()
    await store.saveTask(task('a', { name: 'Renamed' }))

    expect(store.tasks.map((t) => t.name)).toEqual(['Renamed', 'b'])
  })

  it('leaves the list unchanged and rethrows when the API fails', async () => {
    const api = fakeApi({ tasks: [task('a')] })
    const store = useTaskList()
    await store.load()
    api.failWith = 'D1 is down'

    await expect(store.saveTask(task('a', { name: 'Renamed' }))).rejects.toThrow('D1 is down')
    expect(store.tasks).toEqual([task('a')])
  })
})

describe('projectList', () => {
  it('loads projects from the API', async () => {
    fakeApi({ projects: [project('p')] })
    const store = useProjectList()
    await store.load()
    expect(store.projects).toEqual([project('p')])
  })

  it('saves a project through the API, adding or replacing it', async () => {
    const api = fakeApi()
    const store = useProjectList()
    await store.saveProject(project('p'))
    await store.saveProject(project('p', { name: 'Renamed' }))

    expect(api.requests).toEqual(['PUT /api/projects/p', 'PUT /api/projects/p'])
    expect(store.projects).toEqual([project('p', { name: 'Renamed' })])
  })

  describe('liveProjects', () => {
    it('keeps projects with no tasks or unfinished tasks, and drops finished ones', () => {
      const taskList = useTaskList()
      taskList.tasks = [task('done', { completed: true }), task('open')]
      const store = useProjectList()
      store.projects = [
        project('empty'),
        project('finished', { taskIds: ['done'] }),
        project('in progress', { taskIds: ['done', 'open'] }),
      ]

      expect(store.liveProjects.map((p) => p.id)).toEqual(['empty', 'in progress'])
    })

    it('sorts by delivery date, soonest first, with undated projects last', () => {
      const store = useProjectList()
      store.projects = [
        project('none'),
        project('late', { deliveryDate: '2027-03-01' }),
        project('soon', { deliveryDate: '2026-11-01' }),
      ]

      expect(store.liveProjects.map((p) => p.id)).toEqual(['soon', 'late', 'none'])
    })

    it('updates when a task is completed', () => {
      const taskList = useTaskList()
      taskList.tasks = [task('t')]
      const store = useProjectList()
      store.projects = [project('p', { taskIds: ['t'] })]
      expect(store.liveProjects).toHaveLength(1)

      taskList.tasks = [task('t', { completed: true })]
      expect(store.liveProjects).toHaveLength(0)
    })
  })

  describe('assignTask', () => {
    it('saves only the projects whose membership changes', async () => {
      const api = fakeApi()
      const store = useProjectList()
      store.projects = [project('p1', { taskIds: ['t1'] }), project('p2'), project('p3')]

      await store.assignTask('t1', ['p2'])

      expect([...api.requests].sort()).toEqual(['PUT /api/projects/p1', 'PUT /api/projects/p2'])
      expect(store.projects.map((p) => p.taskIds)).toEqual([[], ['t1'], []])
    })

    it("adds the task after the project's existing tasks", async () => {
      fakeApi()
      const store = useProjectList()
      store.projects = [project('p', { taskIds: ['a', 'b'] })]

      await store.assignTask('c', ['p'])

      expect(store.projects[0]!.taskIds).toEqual(['a', 'b', 'c'])
    })

    it('sends nothing when the assignment is unchanged', async () => {
      const api = fakeApi()
      const store = useProjectList()
      store.projects = [project('p1', { taskIds: ['t'] }), project('p2')]

      await store.assignTask('t', ['p1'])

      expect(api.requests).toEqual([])
    })
  })
})

describe('tagList', () => {
  it('loads tags from the API', async () => {
    fakeApi({ tags: [{ id: 'w', name: 'Work' }] })
    const store = useTagList()
    await store.load()
    expect(store.tags).toEqual([{ id: 'w', name: 'Work' }])
  })

  it('saves a tag, keeping the list in name order', async () => {
    const api = fakeApi()
    const store = useTagList()
    await store.saveTag({ id: 'w', name: 'Work' })
    await store.saveTag({ id: 's', name: 'school' })
    await store.saveTag({ id: 'w', name: 'Apprenticeship' })

    expect(api.requests).toEqual(['PUT /api/tags/w', 'PUT /api/tags/s', 'PUT /api/tags/w'])
    expect(store.tags.map((t) => t.name)).toEqual(['Apprenticeship', 'school'])
  })

  it('deletes a tag and clears it from the loaded projects', async () => {
    const api = fakeApi({ tags: [{ id: 'w', name: 'Work' }] })
    const store = useTagList()
    await store.load()
    const projectList = useProjectList()
    projectList.projects = [project('p', { tagId: 'w' }), project('q', { tagId: 'other' })]

    await store.deleteTag('w')

    expect(api.requests).toContain('DELETE /api/tags/w')
    expect(store.tags).toEqual([])
    expect(projectList.projects.map((p) => p.tagId)).toEqual([null, 'other'])
  })

  it('keeps the tag when the API fails to delete it', async () => {
    const api = fakeApi({ tags: [{ id: 'w', name: 'Work' }] })
    const store = useTagList()
    await store.load()
    api.failWith = 'D1 is down'

    await expect(store.deleteTag('w')).rejects.toThrow('D1 is down')
    expect(store.tags).toEqual([{ id: 'w', name: 'Work' }])
  })
})
