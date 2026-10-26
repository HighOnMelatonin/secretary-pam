import { project, tag } from '../support/factories'

const tileNames = () => cy.get('.project-tile h3')
const chip = (text: string) => cy.contains('.chip', new RegExp(`^\\s*${text}\\s*$`))

describe('Sorting and filtering projects', () => {
  beforeEach(() => {
    cy.resetData()
    cy.clearLocalStorage()
    cy.seed({
      tags: [tag('school', 'School (SUTD)'), tag('work', 'Work')],
      projects: [
        project('report', { name: 'Report', deliveryDate: '2027-01-01', priority: 'low', tagId: 'work' }),
        project('thesis', { name: 'Thesis', deliveryDate: '2027-02-01', priority: 'urgent', tagId: 'school' }),
        project('gym', { name: 'Gym', priority: 'high' }),
      ],
    })
  })

  it('sorts and filters, and remembers both after a reload', () => {
    cy.visit('/')
    tileNames().should(($names) => expect($names.toArray().map((n) => n.innerText.replace('▸', '').trim())).to.deep.eq(['Report', 'Thesis', 'Gym']))

    cy.contains('label', 'Sort by').find('select').select('Urgency (most urgent first)')
    tileNames().first().should('contain', 'Thesis')

    cy.contains('summary', 'Filter').click()
    chip('School \\(SUTD\\)').click()
    chip('high').click()
    cy.get('.project-tile').should('have.length', 0)
    cy.contains('No projects match these filters.')
    chip('No tag').click()
    cy.get('.project-tile').should('have.length', 1).and('contain', 'Gym')
    cy.contains('summary', 'Filter (3 on)')

    cy.reload()
    cy.contains('label', 'Sort by').find('select').should('have.value', 'urgency-desc')
    cy.get('.project-tile').should('have.length', 1).and('contain', 'Gym')

    cy.contains('summary', 'Filter').click()
    cy.contains('button', 'Clear filters').click()
    cy.get('.project-tile').should('have.length', 3)
  })
})
