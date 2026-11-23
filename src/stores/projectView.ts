// How the dashboard's list of live projects is sorted and filtered. The choices are kept in
// this browser's localStorage, so they survive a reload.
import { computed, ref, watch } from 'vue'
import { acceptHMRUpdate, defineStore } from 'pinia'
import { localToday } from '@/types/calendar'
import { forecast, PACES, type ProjectForecast } from '@/types/forecast'
import { completionStatus, type Project } from '@/types/project'
import { NO_TAG } from '@/types/tag'
import { PRIORITIES, type Priority } from '@/types/task'
import { useProjectList } from './projectList'
import { useSettings } from './settings'
import { useTagList } from './tagList'
import { useTaskList } from './taskList'

export const SORTS = {
  'delivery-date': 'Delivery date (soonest first)',
  'urgency-desc': 'Urgency (most urgent first)',
  'urgency-asc': 'Urgency (least urgent first)',
  'percent-complete': '% complete (most complete first)',
  pace: 'Pace (behind first)',
} as const
export type SortKey = keyof typeof SORTS

// Stands for "projects with no tags" in the tag filter
export { NO_TAG } from '@/types/tag'

const STORAGE_KEY = 'pam.projectView'

interface Saved {
  sort: SortKey
  tagIds: string[]
  priorities: Priority[]
}

// Falls back to the defaults for anything missing or no longer valid, or if storage is blocked
function load(): Saved {
  const saved: Saved = { sort: 'delivery-date', tagIds: [], priorities: [] }
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (Object.keys(SORTS).includes(stored.sort)) saved.sort = stored.sort
    if (Array.isArray(stored.tagIds)) saved.tagIds = stored.tagIds.filter((id: unknown) => typeof id === 'string')
    if (Array.isArray(stored.priorities)) saved.priorities = stored.priorities.filter((p: Priority) => PRIORITIES.includes(p))
  } catch {
    // Use the defaults
  }
  return saved
}

export const useProjectView = defineStore('projectView', () => {
  const projectList = useProjectList()
  const taskList = useTaskList()
  const tagList = useTagList()
  const settingsStore = useSettings()

  const saved = load()
  const sort = ref<SortKey>(saved.sort)
  const tagIds = ref<string[]>(saved.tagIds) // tag ids, or NO_TAG; empty means every tag
  const priorities = ref<Priority[]>(saved.priorities) // empty means every priority

  watch(
    [sort, tagIds, priorities],
    () => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ sort: sort.value, tagIds: tagIds.value, priorities: priorities.value }),
        )
      } catch {
        // Not remembered, but the list still works
      }
    },
    { deep: true },
  )

  // Ignores tags that have since been deleted, so a remembered filter can't hide everything
  const activeTagIds = computed(() =>
    tagIds.value.filter((id) => id === NO_TAG || tagList.tags.some((t) => t.id === id)),
  )
  const filterCount = computed(() => activeTagIds.value.length + priorities.value.length)

  const percentComplete = (project: Project) => {
    const { completed, total } = completionStatus(project, taskList.tasks)
    return total === 0 ? 0 : completed / total
  }
  const urgency = (project: Project) => PRIORITIES.indexOf(project.priority)

  // The workload forecast, for the pace sort, the forecast strip and the pace badges on the
  // dashboard's tiles. Worked out in the browser from what's loaded, never stored.
  const workload = computed(() =>
    forecast(taskList.tasks, projectList.projects, settingsStore.settings, localToday()),
  )
  const paceOf = (project: Project): ProjectForecast | null =>
    workload.value.projects.find((p) => p.projectId === project.id) ?? null
  // Behind first, then tight, then on pace; projects without a pace (no delivery date or no
  // open work) go last
  const paceRank = (project: Project) => {
    const pace = paceOf(project)?.pace
    return pace ? PACES.length - 1 - PACES.indexOf(pace) : PACES.length
  }

  // Sorting is stable and starts from liveProjects' delivery date order, so projects that tie
  // stay soonest first
  const compare: Record<SortKey, (a: Project, b: Project) => number> = {
    'delivery-date': () => 0,
    'urgency-desc': (a, b) => urgency(b) - urgency(a),
    'urgency-asc': (a, b) => urgency(a) - urgency(b),
    'percent-complete': (a, b) => percentComplete(b) - percentComplete(a),
    pace: (a, b) => paceRank(a) - paceRank(b),
  }

  const hasActiveTag = (project: Project) =>
    project.tagIds.length === 0
      ? activeTagIds.value.includes(NO_TAG)
      : project.tagIds.some((id) => activeTagIds.value.includes(id))

  const visibleProjects = computed(() =>
    projectList.liveProjects
      .filter((p) => activeTagIds.value.length === 0 || hasActiveTag(p))
      .filter((p) => priorities.value.length === 0 || priorities.value.includes(p.priority))
      .sort(compare[sort.value]),
  )

  function toggleTag(id: string) {
    tagIds.value = tagIds.value.includes(id) ? tagIds.value.filter((t) => t !== id) : [...tagIds.value, id]
  }

  function togglePriority(priority: Priority) {
    priorities.value = priorities.value.includes(priority)
      ? priorities.value.filter((p) => p !== priority)
      : [...priorities.value, priority]
  }

  function clearFilters() {
    tagIds.value = []
    priorities.value = []
  }

  return {
    sort,
    tagIds,
    priorities,
    activeTagIds,
    filterCount,
    visibleProjects,
    workload,
    paceOf,
    toggleTag,
    togglePriority,
    clearFilters,
  }
})

// Lets Vite hot-swap this store when the file changes, instead of keeping the old one
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useProjectView, import.meta.hot))
}
