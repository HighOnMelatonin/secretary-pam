<script setup lang="ts">
// Main page: lists live projects, with archived ones in a section below, or prompts the user to
// create one. Shown for every route;
// the route says which form or details page, if any, is open in place of the list (see
// router/index.ts).
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router'
import ProjectForm from './project.vue'
import TaskForm from './task.vue'
import TagManager from './tags.vue'
import Taskbar from './taskbar.vue'
import UpcomingPanel from './upcomingPanel.vue'
import ProjectTile from './projectTile.vue'
import ProjectDetails from './projectDetails.vue'
import TaskDetails from './taskDetails.vue'
import ListControls from './listControls.vue'
import { useProjectView } from '@/stores/projectView'
import { useProjectList } from '@/stores/projectList'
import { useTagList } from '@/stores/tagList'
import { useTaskList } from '@/stores/taskList'
import type { Project } from '@/types/project'
import type { Task } from '@/types/task'

const projectList = useProjectList()
const taskList = useTaskList()
const tagList = useTagList()
const { projects, liveProjects, archivedProjects } = storeToRefs(projectList)
// The live projects with the sort and filters from ListControls applied
const projectView = useProjectView()
const { visibleProjects } = storeToRefs(projectView)
const { tasks } = storeToRefs(taskList)
const { tags } = storeToRefs(tagList)

// The project's tags, in the order it lists them
const tagsOf = (project: Project) =>
  project.tagIds.map((id) => tags.value.find((t) => t.id === id)).filter((t) => t !== undefined)

// Ids of the expanded tiles, kept here so Expand all can reach every tile and so tiles stay
// open after a visit to a project's page
const expandedIds = ref(new Set<string>())
const allExpanded = computed(
  () => visibleProjects.value.length > 0 && visibleProjects.value.every((p) => expandedIds.value.has(p.id)),
)

function setExpanded(id: string, expanded: boolean) {
  const ids = new Set(expandedIds.value)
  if (expanded) ids.add(id)
  else ids.delete(id)
  expandedIds.value = ids
}

function toggleAll() {
  expandedIds.value = allExpanded.value ? new Set() : new Set(visibleProjects.value.map((p) => p.id))
}

// Which form is open: none, a new/existing project, a new/existing task, or the tag list. The
// optional fields carry a form's unsaved changes when it's reopened after a failed save.
type Editor =
  | { kind: 'project'; project?: Project; taskDueDates?: Record<string, string> }
  | { kind: 'task'; task?: Task; projectIds?: string[]; deadlines?: Record<string, string> }
  | { kind: 'tags' }
  | null
const editor = ref<Editor>(null)

const route = useRoute()
const router = useRouter()

function editorForRoute(): Editor {
  switch (route.name) {
    case 'new-project':
      return { kind: 'project' }
    case 'edit-project': {
      const project = projects.value.find((p) => p.id === route.params.id)
      return project ? { kind: 'project', project } : null
    }
    case 'new-task':
      return { kind: 'task' }
    case 'edit-task': {
      const task = tasks.value.find((t) => t.id === route.params.id)
      return task ? { kind: 'task', task } : null
    }
    case 'tags':
      return { kind: 'tags' }
    default:
      return null
  }
}

// Which details page is open: a project's or a task's. Follows the stores, so a page shows
// changes saved from its forms.
type Page = { kind: 'project'; project: Project } | { kind: 'task'; task: Task } | null
const page = computed<Page>(() => {
  if (route.name === 'project') {
    const project = projects.value.find((p) => p.id === route.params.id)
    return project ? { kind: 'project', project } : null
  }
  if (route.name === 'task') {
    const task = tasks.value.find((t) => t.id === route.params.id)
    return task ? { kind: 'task', task } : null
  }
  return null
})

// Whether the open form was opened from within the app (the list or a details page), so
// closing it can go back in history to that page rather than adding the dashboard again
// (which would make back reopen the form)
let openedInApp = false

// Opens a form; switching from one form to another replaces it, so back always leads to the
// page the first form was opened from
function open(to: RouteLocationRaw) {
  if (editor.value) return router.replace(to)
  openedInApp = true
  return router.push(to)
}

function close() {
  if (openedInApp) return router.back()
  return router.replace({ name: 'dashboard' })
}

const loading = ref(true)
// Set when projects or tasks couldn't be loaded, so an empty list isn't shown as "no projects"
const loadFailed = ref(false)
const error = ref<string | null>(null)

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

onMounted(async () => {
  try {
    await Promise.all([projectList.load(), taskList.load(), tagList.load()])
  } catch (e) {
    loadFailed.value = true
    error.value = `Couldn't load your projects: ${messageOf(e)}`
  } finally {
    loading.value = false
  }
})

// Follows the route once the data has loaded, since an edit link or details page needs its
// project or task. A link to one that doesn't exist goes back to the list.
watch(
  [() => route.fullPath, loading],
  () => {
    if (loading.value) return
    editor.value = editorForRoute()
    if (!editor.value) openedInApp = false
    if (route.name !== 'dashboard' && !editor.value && !page.value) router.replace({ name: 'dashboard' })
  },
  { immediate: true },
)

// On failure the form is reopened with the unsaved project/task so no input is lost
// along with the due dates or deadlines it moved to fix date clashes
async function onSaveProject(project: Project, taskDueDates: Record<string, string>) {
  error.value = null
  try {
    await projectList.archivingCompleted(async () => {
      await taskList.setDueDates(taskDueDates)
      await projectList.saveProject(project)
    })
    await close()
  } catch (e) {
    error.value = `Couldn't save "${project.name}": ${messageOf(e)}`
    editor.value = { kind: 'project', project, taskDueDates }
  }
}

async function onSaveTask(task: Task, projectIds: string[], deadlines: Record<string, string>) {
  error.value = null
  try {
    await projectList.archivingCompleted(async () => {
      await projectList.setDeliveryDates(deadlines)
      await taskList.saveTask(task)
      await projectList.assignTask(task.id, projectIds)
    })
    await close()
  } catch (e) {
    error.value = `Couldn't save "${task.name}": ${messageOf(e)}`
    editor.value = { kind: 'task', task, projectIds, deadlines }
  }
}

// From a task's check mark; the list keeps the old state if saving fails
async function onToggleTask(task: Task) {
  error.value = null
  try {
    await projectList.archivingCompleted(() => taskList.saveTask({ ...task, completed: !task.completed }))
  } catch (e) {
    error.value = `Couldn't save "${task.name}": ${messageOf(e)}`
  }
}
</script>

<template>
  <section>
    <!-- Fixed to the edge of the screen, over the page, so where it sits here doesn't matter -->
    <Taskbar
      v-if="!loading && !loadFailed"
      :form-open="editor !== null"
      @tags="open({ name: 'tags' })"
      @add-task="open({ name: 'new-task' })"
      @add-project="open({ name: 'new-project' })"
    />

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <p v-if="loading" aria-busy="true">Loading your projects…</p>

    <p v-else-if="loadFailed">Reload the page to try again.</p>

    <ProjectForm
      v-else-if="editor?.kind === 'project'"
      :project="editor.project"
      :tasks="tasks"
      :tags="tags"
      :task-due-dates="editor.taskDueDates"
      @save="onSaveProject"
      @cancel="close"
    />
    <TaskForm
      v-else-if="editor?.kind === 'task'"
      :task="editor.task"
      :available-tasks="tasks"
      :projects="projects"
      :project-ids="editor.projectIds"
      :deadlines="editor.deadlines"
      @save="onSaveTask"
      @cancel="close"
    />
    <TagManager v-else-if="editor?.kind === 'tags'" @close="close" />

    <ProjectDetails
      v-else-if="page?.kind === 'project'"
      :project="page.project"
      :tasks="tasks"
      :tags="tagsOf(page.project)"
      @edit="open({ name: 'edit-project', params: { id: $event.id } })"
      @edit-task="open({ name: 'edit-task', params: { id: $event.id } })"
      @toggle-task="onToggleTask"
    />
    <TaskDetails
      v-else-if="page?.kind === 'task'"
      :task="page.task"
      :tasks="tasks"
      :projects="projects"
      @edit="open({ name: 'edit-task', params: { id: $event.id } })"
    />

    <!-- The list: the upcoming tasks, then the projects -->
    <template v-else>
      <UpcomingPanel
        :tasks="tasks"
        :projects="projects"
        @edit-task="open({ name: 'edit-task', params: { id: $event.id } })"
        @toggle-task="onToggleTask"
      />

      <article v-if="projects.length === 0" class="empty">
        <h2>No projects yet</h2>
        <p>Create a project to start tracking its tasks and deliverables.</p>
        <button @click="open({ name: 'new-project' })">Create a project</button>
      </article>

      <template v-else>
        <div class="list-heading">
          <h2>Live projects</h2>
          <button
            v-if="visibleProjects.length"
            type="button"
            class="secondary outline toggle-all"
            @click="toggleAll"
          >
            {{ allExpanded ? 'Collapse all' : 'Expand all' }}
          </button>
        </div>

        <p v-if="liveProjects.length === 0">
          All projects are archived. <a :href="router.resolve({ name: 'new-project' }).href" @click.prevent="open({ name: 'new-project' })">
            Create a new one?
          </a>
        </p>

        <template v-else>
          <ListControls />
          <p v-if="visibleProjects.length === 0" class="no-match">
            No projects match these filters.
            <button type="button" class="secondary outline" @click="projectView.clearFilters()">Clear filters</button>
          </p>
        </template>

        <div class="project-grid">
          <ProjectTile
            v-for="project in visibleProjects"
            :key="project.id"
            :project="project"
            :tasks="tasks"
            :tags="tagsOf(project)"
            :expanded="expandedIds.has(project.id)"
            @update:expanded="setExpanded(project.id, $event)"
            @edit="open({ name: 'edit-project', params: { id: $event.id } })"
            @edit-task="open({ name: 'edit-task', params: { id: $event.id } })"
            @toggle-task="onToggleTask"
          />
        </div>

        <details v-if="archivedProjects.length" class="archived">
          <summary>Archived projects ({{ archivedProjects.length }})</summary>
          <div class="project-grid">
            <ProjectTile
              v-for="project in archivedProjects"
              :key="project.id"
              :project="project"
              :tasks="tasks"
              :tags="tagsOf(project)"
              :expanded="expandedIds.has(project.id)"
              @update:expanded="setExpanded(project.id, $event)"
              @edit="open({ name: 'edit-project', params: { id: $event.id } })"
              @edit-task="open({ name: 'edit-task', params: { id: $event.id } })"
              @toggle-task="onToggleTask"
            />
          </div>
        </details>
      </template>
    </template>
  </section>
</template>

<style scoped>
.list-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
}

.list-heading h2 {
  margin: 0;
}

.toggle-all {
  width: auto;
  margin: 0;
  padding: 0.3rem 0.9rem;
  font-size: 0.9rem;
}

.no-match {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  margin-top: 1.5rem;
}

.no-match button {
  width: auto;
  margin: 0;
  padding: 0.3rem 0.9rem;
  font-size: 0.9rem;
}

.empty {
  text-align: center;
  padding-block: 3rem;
}

.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr));
  gap: 1rem;
  margin-top: 1.5rem;
}

.archived {
  margin-top: 2.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--pico-muted-border-color);
}

.archived summary {
  color: var(--pico-muted-color);
}
</style>
