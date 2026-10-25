/// <reference types="cypress" />
// Commands that set up data through the real API, so each test starts from a known state.
// The e2e server keeps its data in .wrangler/e2e-state, separate from `pnpm dev`.
import type { Project as ProjectData } from '../../src/types/project'
import type { Task as TaskData } from '../../src/types/task'

declare global {
  namespace Cypress {
    interface Chainable {
      // Deletes every project and task
      resetData(): Chainable<void>
      // Saves the tasks, then the projects (projects can only list tasks that exist)
      seed(data: { tasks?: TaskData[]; projects?: ProjectData[] }): Chainable<void>
    }
  }
}

const apiPath = (resource: string, id: string) => `/api/${resource}/${encodeURIComponent(id)}`

Cypress.Commands.add('resetData', () => {
  for (const resource of ['projects', 'tasks']) {
    cy.request<{ id: string }[]>(`/api/${resource}`).then(({ body }) => {
      for (const item of body) cy.request('DELETE', apiPath(resource, item.id))
    })
  }
})

Cypress.Commands.add('seed', ({ tasks = [], projects = [] }) => {
  for (const task of tasks) cy.request('PUT', apiPath('tasks', task.id), task)
  for (const project of projects) cy.request('PUT', apiPath('projects', project.id), project)
})

export {}
