/// <reference types="cypress" />
// Commands that set up data through the real API, so each test starts from a known state.
// The e2e server keeps its data in .wrangler/e2e-state, separate from `pnpm dev`. Tests run as
// the account below, which is created the first time it is needed.
import type { Project as ProjectData } from '../../src/types/project'
import type { Tag as TagData } from '../../src/types/tag'
import type { Task as TaskData } from '../../src/types/task'
import { tag } from './factories'

declare global {
  namespace Cypress {
    interface Chainable {
      // Signs in to the test account (creating it if needed), then deletes its every project, task
      // and tag, including the starting tags
      resetData(): Chainable<void>
      // Signs the browser in to the test account, creating it if it doesn't exist yet
      signIn(): Chainable<void>
      // Saves the tags and tasks, then the projects (projects can only refer to ones that exist)
      seed(data: { tags?: TagData[]; tasks?: TaskData[]; projects?: ProjectData[] }): Chainable<void>
      // Opens the hidden taskbar on the left from its strip and clicks one of its buttons
      taskbar(action: 'Tags' | 'Add task' | 'Add project'): Chainable<void>
    }
  }
}

export const TEST_ACCOUNT = { email: 'e2e@example.com', password: 'e2e test password' }

const apiPath = (resource: string, id: string) => `/api/${resource}/${encodeURIComponent(id)}`

// The session cookie from the response is kept by the browser, so later requests and visits are
// signed in
Cypress.Commands.add('signIn', () => {
  cy.request({ method: 'POST', url: '/api/auth/login', body: TEST_ACCOUNT, failOnStatusCode: false }).then(({ status }) => {
    if (status !== 200) cy.request('POST', '/api/auth/signup', TEST_ACCOUNT)
  })
})

Cypress.Commands.add('resetData', () => {
  cy.signIn()
  for (const resource of ['projects', 'tasks', 'tags']) {
    cy.request<{ id: string }[]>(`/api/${resource}`).then(({ body }) => {
      for (const item of body) {
        // The built-in Archive tag can't be deleted, so it's put back to its own name and colour instead
        if (resource === 'tags' && item.id === 'archive') cy.request('PUT', apiPath('tags', 'archive'), tag('archive', 'Archive'))
        else cy.request('DELETE', apiPath(resource, item.id))
      }
    })
  }
})

Cypress.Commands.add('taskbar', (action) => {
  cy.get('button[aria-label="Show actions"]').click()
  cy.contains('nav button', action).click()
})

Cypress.Commands.add('seed',({ tags = [], tasks = [], projects = [] }) => {
  for (const tag of tags) cy.request('PUT', apiPath('tags', tag.id), tag)
  for (const task of tasks) cy.request('PUT', apiPath('tasks', task.id), task)
  for (const project of projects) cy.request('PUT', apiPath('projects', project.id), project)
})

export {}
