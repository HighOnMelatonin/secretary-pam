<script setup lang="ts">
// Main page: lists live projects, or prompts the user to create one. Shown for every route;
// the route says which form, if any, is open in place of the list (see router/index.ts).
import { onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router'
import ProjectForm from './project.vue'
import TaskForm from './task.vue'
import TagManager from './tags.vue'
import Taskbar from './taskbar.vue'
import ProjectTile from './projectTile.vue'
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
const { projects, liveProjects } = storeToRefs(projectList)
// The live projects with the sort and filters from ListControls applied
const projectView = useProjectView()
const { visibleProjects } = storeToRefs(projectView)
const { tasks } = storeToRefs(taskList)
const { tags } = storeToRefs(tagList)

const tagOf = (project: Project) => tags.value.find((t) => t.id === project.tagId)

// Which form is open: none, a new/existing project, a new/existing task, or the tag list
type Editor =
  | { kind: 'project'; project?: Project }
  | { kind: 'task'; task?: Task; projectIds?: string[] }
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

// Whether the open form was opened from the dashboard, so closing it can go back in history
// rather than adding the dashboard again (which would make back reopen the form)
let openedFromDashboard = false

// Opens a form; switching from one form to another replaces it, so back always leads to the list
function open(to: RouteLocationRaw) {
  if (editor.value) return router.replace(to)
  openedFromDashboard = true
  return router.push(to)
}

function close() {
  if (openedFromDashboard) return router.back()
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

// Follows the route once the data has loaded, since an edit link needs its project or task.
// A link to one that doesn't exist goes back to the list.
watch(
  [() => route.fullPath, loading],
  () => {
    if (loading.value) return
    if (route.name === 'dashboard') openedFromDashboard = false
    editor.value = editorForRoute()
    if (route.name !== 'dashboard' && !editor.value) router.replace({ name: 'dashboard' })
  },
  { immediate: true },
)

// On failure the form is reopened with the unsaved project/task so no input is lost
async function onSaveProject(project: Project) {
  error.value = null
  try {
    await projectList.saveProject(project)
    await close()
  } catch (e) {
    error.value = `Couldn't save "${project.name}": ${messageOf(e)}`
    editor.value = { kind: 'project', project }
  }
}

async function onSaveTask(task: Task, projectIds: string[]) {
  error.value = null
  try {
    await taskList.saveTask(task)
    await projectList.assignTask(task.id, projectIds)
    await close()
  } catch (e) {
    error.value = `Couldn't save "${task.name}": ${messageOf(e)}`
    editor.value = { kind: 'task', task, projectIds }
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
      @save="onSaveProject"
      @cancel="close"
    />
    <TaskForm
      v-else-if="editor?.kind === 'task'"
      :task="editor.task"
      :available-tasks="tasks"
      :projects="projects"
      :project-ids="editor.projectIds"
      @save="onSaveTask"
      @cancel="close"
    />
    <TagManager v-else-if="editor?.kind === 'tags'" @close="close" />

    <template v-else-if="projects.length === 0">
      <article class="empty">
        <h2>No projects yet</h2>
        <p>Create a project to start tracking its tasks and deliverables.</p>
        <button @click="open({ name: 'new-project' })">Create a project</button>
      </article>
    </template>

    <template v-else>
      <h2 class="heading">Live projects</h2>

      <p v-if="liveProjects.length === 0">
        All projects are completed. <a :href="router.resolve({ name: 'new-project' }).href" @click.prevent="open({ name: 'new-project' })">
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
          :tag="tagOf(project)"
          @edit="open({ name: 'edit-project', params: { id: $event.id } })"
          @edit-task="open({ name: 'edit-task', params: { id: $event.id } })"
        />
      </div>
    </template>
  </section>
</template>

<style scoped>
.heading {
  margin: 0;
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
</style>
