<script setup lang="ts">
// Main page: lists live projects, or prompts the user to create one
import { onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import ProjectForm from './project.vue'
import TaskForm from './task.vue'
import TagManager from './tags.vue'
import ProjectTile from './projectTile.vue'
import { useProjectList } from '@/stores/projectList'
import { useTagList } from '@/stores/tagList'
import { useTaskList } from '@/stores/taskList'
import type { Project } from '@/types/project'
import type { Task } from '@/types/task'

const projectList = useProjectList()
const taskList = useTaskList()
const tagList = useTagList()
const { projects, liveProjects } = storeToRefs(projectList)
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

// On failure the form is reopened with the unsaved project/task so no input is lost
async function onSaveProject(project: Project) {
  error.value = null
  try {
    await projectList.saveProject(project)
    editor.value = null
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
    editor.value = null
  } catch (e) {
    error.value = `Couldn't save "${task.name}": ${messageOf(e)}`
    editor.value = { kind: 'task', task, projectIds }
  }
}
</script>

<template>
  <section>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <p v-if="loading" aria-busy="true">Loading your projects…</p>

    <p v-else-if="loadFailed">Reload the page to try again.</p>

    <ProjectForm
      v-else-if="editor?.kind === 'project'"
      :project="editor.project"
      :tasks="tasks"
      :tags="tags"
      @save="onSaveProject"
      @cancel="editor = null"
    />
    <TaskForm
      v-else-if="editor?.kind === 'task'"
      :task="editor.task"
      :available-tasks="tasks"
      :projects="projects"
      :project-ids="editor.projectIds"
      @save="onSaveTask"
      @cancel="editor = null"
    />
    <TagManager v-else-if="editor?.kind === 'tags'" @close="editor = null" />

    <template v-else-if="projects.length === 0">
      <article class="empty">
        <h2>No projects yet</h2>
        <p>Create a project to start tracking its tasks and deliverables.</p>
        <button @click="editor = { kind: 'project' }">Create a project</button>
      </article>
    </template>

    <template v-else>
      <header class="toolbar">
        <h2>Live projects</h2>
        <div class="actions">
          <button class="secondary" @click="editor = { kind: 'tags' }">Tags</button>
          <button class="secondary" @click="editor = { kind: 'task' }">New task</button>
          <button @click="editor = { kind: 'project' }">New project</button>
        </div>
      </header>

      <p v-if="liveProjects.length === 0">
        All projects are completed. <a href="#" @click.prevent="editor = { kind: 'project' }">Create a new one?</a>
      </p>

      <div class="project-grid">
        <ProjectTile
          v-for="project in liveProjects"
          :key="project.id"
          :project="project"
          :tasks="tasks"
          :tag="tagOf(project)"
          @edit="editor = { kind: 'project', project: $event }"
        />
      </div>
    </template>
  </section>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.toolbar h2 {
  margin: 0;
}

.toolbar button {
  width: auto;
  margin: 0;
}

.actions {
  display: flex;
  gap: 0.5rem;
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
