import { project } from '../support/factories'

const field = (label: string) => cy.contains('label', label).find('input, select, textarea')

describe('Errors', () => {
  beforeEach(() => {
    cy.resetData()
  })

  it('tells the user when projects cannot be loaded', () => {
    cy.intercept('GET', '/api/projects', { statusCode: 500, body: { error: 'D1 is down' } })
    cy.visit('/')

    cy.get('[role="alert"]').should('have.text', "Couldn't load your projects: D1 is down")
  })

  it('keeps what was typed when a save fails, and saves on retry', () => {
    // Only the first save fails
    cy.intercept({ method: 'PUT', url: '/api/projects/*', times: 1 }, { statusCode: 500, body: { error: 'D1 is down' } })
    cy.visit('/')

    cy.contains('button', 'Create a project').click()
    field('Project name').type('Thesis')
    field('Description').type('Final year project')
    cy.contains('button', /^Add$/).click()

    cy.get('[role="alert"]').should('have.text', 'Couldn\'t save "Thesis": D1 is down')
    field('Project name').should('have.value', 'Thesis')
    field('Description').should('have.value', 'Final year project')

    cy.contains('button', 'Save').click()
    cy.get('[role="alert"]').should('not.exist')
    cy.contains('.project-tile', 'Thesis')
    cy.request('/api/projects').its('body').should('have.length', 1)
  })

  it('shows the error message the API returns', () => {
    cy.seed({ projects: [project('p', { name: 'Thesis' })] })
    // A real validation error from the Worker, for a body the form itself would never send
    cy.intercept('PUT', '/api/projects/p', (req) => {
      req.body = { ...req.body, priority: 'asap' }
    })
    cy.visit('/')

    cy.contains('.project-tile', 'Thesis').contains('button', 'Edit').click()
    cy.contains('button', 'Save').click()

    cy.get('[role="alert"]').should('contain', 'priority must be one of low, medium, high, urgent')
  })
})
