import { project, tag, task } from '../support/factories'

const tile = (name: string) => cy.contains('.project-tile', name)

// A phone-sized screen, where the actions are behind the + button instead of the left bar
describe('On a phone', () => {
  beforeEach(() => {
    cy.viewport(375, 740)
    cy.resetData()
  })

  it('opens the actions from the + button, and back closes the form', () => {
    cy.seed({ projects: [project('p', { name: 'Thesis' })] })
    cy.visit('/')

    cy.get('button[aria-label="Show actions"]').should('not.be.visible')
    cy.get('button.fab').click()
    cy.contains('.fab-actions button', 'Add task').click()
    cy.location('pathname').should('eq', '/tasks/new')
    cy.get('button.fab').should('not.exist')

    cy.go('back')
    cy.location('pathname').should('eq', '/')
    tile('Thesis').should('be.visible')
  })

  it('keeps Save in view at the bottom of a long form', () => {
    cy.seed({
      tags: [tag('school', 'School (SUTD)')],
      tasks: [task('a'), task('b'), task('c')],
      projects: [project('p', { name: 'Thesis', taskIds: ['a', 'b', 'c'], links: [{ label: 'Repo', url: 'https://a' }] })],
    })
    cy.visit('/')

    tile('Thesis').contains('button', 'Edit').click()
    cy.contains('button', 'Save').should(($save) => {
      const { bottom } = $save[0]!.getBoundingClientRect()
      expect(bottom).to.be.at.most(740)
    })
    cy.contains('label', 'Tag').find('select').select('School (SUTD)')
    cy.contains('button', 'Save').click()
    tile('Thesis').find('.project-tag').should('have.text', 'School (SUTD)')
  })

  it('opens a form from its link, as after a refresh', () => {
    cy.seed({ projects: [project('p', { name: 'Thesis' })] })
    cy.visit('/projects/p/edit')

    cy.contains('label', 'Project name').find('input').should('have.value', 'Thesis')
    cy.contains('button', 'Cancel').click()
    cy.location('pathname').should('eq', '/')
  })
})
