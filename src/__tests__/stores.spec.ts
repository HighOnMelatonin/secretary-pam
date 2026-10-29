import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useProjectList } from '../stores/projectList'
import { NO_TAG, useProjectView } from '../stores/projectView'
import { useTagList } from '../stores/tagList'
import { useTaskList } from '../stores/taskList'
import { createEmptyProject, type Project } from '../types/project'
import { ARCHIVE_TAG_ID } from '../types/tag'
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
  localStorage.clear()
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

  describe('liveProjects and archivedProjects', () => {
    it('splits the projects by the Archive tag, whether or not their tasks are done', () => {
      const taskList = useTaskList()
      taskList.tasks = [task('done', { completed: true }), task('open')]
      const store = useProjectList()
      store.projects = [
        project('empty'),
        project('finished', { taskIds: ['done'] }),
        project('archived', { taskIds: ['done'], tagIds: ['work', ARCHIVE_TAG_ID] }),
        project('shelved', { taskIds: ['open'], tagIds: [ARCHIVE_TAG_ID] }),
      ]

      expect(store.liveProjects.map((p) => p.id)).toEqual(['empty', 'finished'])
      expect(store.archivedProjects.map((p) => p.id)).toEqual(['archived', 'shelved'])
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

  })

  describe('archivingCompleted', () => {
    it('archives the projects the change completes, keeping their other tags', async () => {
      const api = fakeApi()
      const taskList = useTaskList()
      taskList.tasks = [task('t'), task('u')]
      const store = useProjectList()
      store.projects = [
        project('p', { taskIds: ['t'], tagIds: ['work'] }),
        project('q', { taskIds: ['t', 'u'] }),
        project('r'),
      ]

      await store.archivingCompleted(() => taskList.saveTask(task('t', { completed: true })))

      expect(api.requests).toEqual(['PUT /api/tasks/t', 'PUT /api/projects/p'])
      expect(store.projects.map((p) => p.tagIds)).toEqual([['work', ARCHIVE_TAG_ID], [], []])
      expect(store.archivedProjects.map((p) => p.id)).toEqual(['p'])
    })

    it('leaves a completed project that was taken out of the archive alone', async () => {
      const api = fakeApi()
      const taskList = useTaskList()
      taskList.tasks = [task('t', { completed: true })]
      const store = useProjectList()
      store.projects = [project('p', { taskIds: ['t'] })]

      await store.archivingCompleted(() => taskList.saveTask(task('t', { name: 'Renamed', completed: true })))

      expect(api.requests).toEqual(['PUT /api/tasks/t'])
      expect(store.projects[0]!.tagIds).toEqual([])
    })

    it('archives nothing when the change fails', async () => {
      const api = fakeApi()
      api.failWith = 'D1 is down'
      const taskList = useTaskList()
      taskList.tasks = [task('t')]
      const store = useProjectList()
      store.projects = [project('p', { taskIds: ['t'] })]

      await expect(store.archivingCompleted(() => taskList.saveTask(task('t', { completed: true })))).rejects.toThrow()
      expect(store.projects[0]!.tagIds).toEqual([])
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
    fakeApi({ tags: [{ id: 'w', name: 'Work', color: '#343ca6' }] })
    const store = useTagList()
    await store.load()
    expect(store.tags).toEqual([{ id: 'w', name: 'Work', color: '#343ca6' }])
  })

  it('saves a tag, keeping the list in name order', async () => {
    const api = fakeApi()
    const store = useTagList()
    await store.saveTag({ id: 'w', name: 'Work', color: '#343ca6' })
    await store.saveTag({ id: 's', name: 'school', color: '#343ca6' })
    await store.saveTag({ id: 'w', name: 'Apprenticeship', color: '#343ca6' })

    expect(api.requests).toEqual(['PUT /api/tags/w', 'PUT /api/tags/s', 'PUT /api/tags/w'])
    expect(store.tags.map((t) => t.name)).toEqual(['Apprenticeship', 'school'])
  })

  it('deletes a tag and clears it from the loaded projects', async () => {
    const api = fakeApi({ tags: [{ id: 'w', name: 'Work', color: '#343ca6' }] })
    const store = useTagList()
    await store.load()
    const projectList = useProjectList()
    projectList.projects = [project('p', { tagIds: ['other', 'w'] }), project('q', { tagIds: ['other'] })]

    await store.deleteTag('w')

    expect(api.requests).toContain('DELETE /api/tags/w')
    expect(store.tags).toEqual([])
    expect(projectList.projects.map((p) => p.tagIds)).toEqual([['other'], ['other']])
  })

  it('keeps the tag when the API fails to delete it', async () => {
    const api = fakeApi({ tags: [{ id: 'w', name: 'Work', color: '#343ca6' }] })
    const store = useTagList()
    await store.load()
    api.failWith = 'D1 is down'

    await expect(store.deleteTag('w')).rejects.toThrow('D1 is down')
    expect(store.tags).toEqual([{ id: 'w', name: 'Work', color: '#343ca6' }])
  })
})

describe('projectView', () => {
  // Live projects in delivery date order: a (Jan), b (Feb), c (Mar), d (no date)
  function setUp() {
    useTaskList().tasks = [task('done', { completed: true }), task('open1'), task('open2')]
    useTagList().tags = [
      { id: 'work', name: 'Work', color: '#343ca6' },
      { id: 'school', name: 'School', color: '#343ca6' },
    ]
    useProjectList().projects = [
      project('d', { priority: 'urgent', tagIds: ['school'] }),
      project('c', { deliveryDate: '2027-03-01', priority: 'low', taskIds: ['done', 'open1'] }),
      project('b', { deliveryDate: '2027-02-01', priority: 'urgent', tagIds: ['work', 'school'], taskIds: ['open1', 'open2'] }),
      project('a', { deliveryDate: '2027-01-01', priority: 'medium', tagIds: ['work'], taskIds: ['done', 'open1', 'open2'] }),
    ]
    return useProjectView()
  }
  const ids = (view: ReturnType<typeof useProjectView>) => view.visibleProjects.map((p) => p.id)

  it('starts with every live project, soonest delivery first', () => {
    expect(ids(setUp())).toEqual(['a', 'b', 'c', 'd'])
  })

  it.each<[string, string[]]>([
    ['urgency-desc', ['b', 'd', 'a', 'c']],
    ['urgency-asc', ['c', 'a', 'b', 'd']],
    ['percent-complete', ['c', 'a', 'b', 'd']],
  ])('sorts by %s, keeping delivery date order for ties', (sort, expected) => {
    const view = setUp()
    view.sort = sort as typeof view.sort
    expect(ids(view)).toEqual(expected)
  })

  it('filters by any of the chosen tags, including no tag', () => {
    const view = setUp()
    view.toggleTag('school')
    expect(ids(view)).toEqual(['b', 'd'])
    view.toggleTag(NO_TAG)
    expect(ids(view)).toEqual(['b', 'c', 'd'])
    view.toggleTag('school')
    expect(ids(view)).toEqual(['c'])
  })

  it('filters by any of the chosen urgencies, together with the tag filter', () => {
    const view = setUp()
    view.togglePriority('urgent')
    view.togglePriority('low')
    expect(ids(view)).toEqual(['b', 'c', 'd'])

    view.toggleTag('work')
    expect(ids(view)).toEqual(['b'])
    expect(view.filterCount).toBe(3)

    view.clearFilters()
    expect(ids(view)).toEqual(['a', 'b', 'c', 'd'])
    expect(view.filterCount).toBe(0)
  })

  it('ignores a filtered tag that has been deleted', () => {
    const view = setUp()
    view.toggleTag('school')
    useTagList().tags = [{ id: 'work', name: 'Work', color: '#343ca6' }]
    expect(ids(view)).toEqual(['a', 'b', 'c', 'd'])
    expect(view.filterCount).toBe(0)
  })

  it('remembers the choices for next time, dropping any that are no longer valid', async () => {
    const view = setUp()
    view.sort = 'urgency-asc'
    view.toggleTag('work')
    view.togglePriority('high')
    await nextTick()

    setActivePinia(createPinia())
    const next = useProjectView()
    expect(next.sort).toBe('urgency-asc')
    expect(next.tagIds).toEqual(['work'])
    expect(next.priorities).toEqual(['high'])

    localStorage.setItem('pam.projectView', JSON.stringify({ sort: 'by-colour', tagIds: [3], priorities: ['asap', 'low'] }))
    setActivePinia(createPinia())
    expect(useProjectView().$state).toMatchObject({ sort: 'delivery-date', tagIds: [], priorities: ['low'] })
  })
})
