import { project, task } from '../support/factories'

const field = (label: string) => cy.contains('label', label).find('input, select, textarea')
const tile = (name: string) => cy.contains('.project-tile', name)
const fieldset = (legend: string) => cy.contains('legend', legend).parent('fieldset')

describe('Tasks', () => {
  beforeEach(() => {
    cy.resetData()
  })

  it('creates a task and assigns it to a project from the task form', () => {
    cy.seed({ projects: [project('p', { name: 'Thesis' })] })
    cy.visit('/')

    cy.taskbar('Add task')
    field('Task name').type('Write report')
    field('Due date').type('2026-12-14')
    fieldset('Projects').find('select').select('Thesis')
    fieldset('Projects').contains('button', 'Assign').click()
    fieldset('Projects').contains('li', 'Thesis')
    cy.contains('button', /^Add$/).click()

    tile('Thesis').contains('0 of 1 tasks completed')
    tile('Thesis').find('.meta').click()
    tile('Thesis').find('.preview').contains('li', 'Write report').should('contain', 'Due 2026-12-14')

    cy.request('/api/projects').its('body.0.taskIds').should('have.length', 1)
  })

  it('adds an existing task to a project from the project form', () => {
    cy.seed({ tasks: [task('t', { name: 'Book room' })], projects: [project('p', { name: 'Thesis' })] })
    cy.visit('/')

    tile('Thesis').contains('button', 'Edit').click()
    fieldset('Tasks').find('select').select('Book room')
    fieldset('Tasks').contains('button', 'Add task').click()
    cy.contains('button', 'Save').click()

    tile('Thesis').contains('0 of 1 tasks completed')
    cy.request('/api/projects').its('body.0.taskIds').should('deep.equal', ['t'])
  })

  it('relates a new task to an existing one', () => {
    cy.seed({ tasks: [task('a', { name: 'Collect data' })], projects: [project('p')] })
    cy.visit('/')

    cy.taskbar('Add task')
    field('Task name').type('Analyse data')
    fieldset('Related tasks').find('select').first().select('blocked by')
    fieldset('Related tasks').find('select').last().select('Collect data')
    fieldset('Related tasks').contains('button', 'Link').click()
    fieldset('Related tasks').contains('li', 'blocked by: Collect data')
    cy.contains('button', /^Add$/).click()
    cy.get('form').should('not.exist') // the form closes once the save succeeds

    cy.request('/api/tasks')
      .its('body')
      .should((tasks: { name: string; relations: unknown[] }[]) => {
        expect(tasks.find((t) => t.name === 'Analyse data')!.relations).to.deep.equal([{ taskId: 'a', type: 'blocked_by' }])
      })
  })

  it('moves a project out of the live list once all its tasks are done', () => {
    cy.seed({ tasks: [task('t')], projects: [project('p', { name: 'Thesis', taskIds: ['t'] })] })
    cy.visit('/')
    tile('Thesis').should('be.visible')

    // There is no task editor on the dashboard yet, so the task is completed through the API
    cy.seed({ tasks: [task('t', { completed: true })] })
    cy.reload()

    cy.contains('All projects are completed.')
    cy.get('.project-tile').should('not.exist')
  })

  it('removes a deleted task from its project', () => {
    cy.seed({ tasks: [task('t1'), task('t2')], projects: [project('p', { name: 'Thesis', taskIds: ['t1', 't2'] })] })
    cy.visit('/')
    tile('Thesis').contains('0 of 2 tasks completed')

    cy.request('DELETE', '/api/tasks/t1')
    cy.reload()

    tile('Thesis').contains('0 of 1 tasks completed')
  })

  it("edits a task from its project's tile", () => {
    // A second task keeps the project live once the first is completed
    cy.seed({
      tasks: [task('t', { name: 'Write report' }), task('u', { name: 'Review slides' })],
      projects: [project('p', { name: 'Thesis', taskIds: ['t', 'u'] })],
    })
    cy.visit('/')

    tile('Thesis').find('.tile-toggle').click()
    cy.get('button[aria-label="Edit task Write report"]').click()
    cy.location('pathname').should('eq', '/tasks/t/edit')
    field('Task name').should('have.value', 'Write report').clear().type('Write final report')
    field('Completed').check()
    cy.contains('button', 'Save').click()

    cy.location('pathname').should('eq', '/')
    tile('Thesis').contains('1 of 2 tasks completed')
    cy.reload()
    tile('Thesis').find('.tile-toggle').click()
    tile('Thesis').contains('.task', 'Write final report').should('have.class', 'done')
  })
})
