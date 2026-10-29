import { project, tag } from '../support/factories'

const field = (label: string) => cy.contains('label', label).find('input, select, textarea')
const tile = (name: string) => cy.contains('.project-tile', name)
const tagRow = (name: string) => cy.get(`input[aria-label="Name of ${name}"]`).closest('li')

describe('Tags', () => {
  beforeEach(() => {
    cy.resetData()
  })

  it('adds a tag, gives it to a project, and keeps both after a reload', () => {
    cy.seed({ projects: [project('p', { name: 'Thesis' })] })
    cy.visit('/')

    cy.taskbar('Tags')
    tagRow('Archive').should('contain', 'Built in').and('not.contain', 'Delete')
    cy.get('input[aria-label="New tag name"]').type('School (SUTD){enter}')
    tagRow('School (SUTD)').should('contain', 'Used by 0 projects')
    cy.get('input[aria-label="New tag name"]').should('have.value', '')
    cy.contains('button', 'Done').click()

    tile('Thesis').contains('button', 'Edit').click()
    field('School (SUTD)').check()
    cy.contains('button', 'Save').click()
    tile('Thesis').find('.project-tag').should('have.text', 'School (SUTD)')

    cy.reload()
    tile('Thesis').find('.project-tag').should('have.text', 'School (SUTD)')
  })

  it('renames a tag everywhere it is used', () => {
    cy.seed({
      tags: [tag('work', 'Work')],
      projects: [project('a', { name: 'Report', tagIds: ['work'] }), project('b', { name: 'Slides', tagIds: ['work'] })],
    })
    cy.visit('/')

    cy.taskbar('Tags')
    tagRow('Work').should('contain', 'Used by 2 projects')
    tagRow('Work').find('input').clear().type('Internship')
    tagRow('Work').contains('button', 'Rename').click()
    cy.contains('button', 'Done').click()

    tile('Report').find('.project-tag').should('have.text', 'Internship')
    tile('Slides').find('.project-tag').should('have.text', 'Internship')
  })

  it('gives a tag any colour, which its badges keep after a reload', () => {
    const badge = () => tile('Report').find('.project-tag')
    cy.seed({ tags: [tag('work', 'Work')], projects: [project('p', { name: 'Report', tagIds: ['work'] })] })
    cy.visit('/')
    badge().should('have.css', 'background-color', 'rgb(52, 60, 166)') // indigo, the default

    cy.taskbar('Tags')
    tagRow('Work').find('.color-swatch').should('have.text', '#343ca6')
    // The browser's own picker can't be driven, so the colour is set the way the picker sets it
    tagRow('Work').find('input[type="color"]').invoke('val', '#f5d76e').trigger('input').trigger('change')
    tagRow('Work').find('.color-swatch').should('have.text', '#f5d76e')
    cy.request('/api/tags').its('body').should('deep.include', { id: 'work', name: 'Work', color: '#f5d76e' })
    cy.contains('button', 'Done').click()
    // A light colour gets forest green text
    badge().should('have.css', 'background-color', 'rgb(245, 215, 110)').and('have.css', 'color', 'rgb(32, 64, 48)')

    cy.reload()
    badge().should('have.css', 'background-color', 'rgb(245, 215, 110)')
  })

  it('refuses a name another tag already has', () => {
    cy.seed({ tags: [tag('work', 'Work'), tag('personal', 'Personal')], projects: [project('p')] })
    cy.visit('/')

    cy.taskbar('Tags')
    cy.get('input[aria-label="New tag name"]').type('work{enter}')

    cy.get('[role="alert"]').should('have.text', 'Couldn\'t add "work": There is already a tag with that name')
    cy.get('input[aria-label="New tag name"]').should('have.value', 'work')
  })

  it('deletes a tag after confirming, removing it from its project', () => {
    cy.seed({
      tags: [tag('work', 'Work'), tag('personal', 'Personal')],
      projects: [project('p', { name: 'Report', tagIds: ['work', 'personal'] })],
    })
    cy.visit('/')
    cy.on('window:confirm', (message) => {
      expect(message).to.eq('Delete "Work"? It will be removed from 1 project.')
      return true
    })

    cy.taskbar('Tags')
    tagRow('Work').contains('button', 'Delete').click()
    cy.get('input[aria-label="Name of Work"]').should('not.exist')
    cy.contains('button', 'Done').click()

    tile('Report').find('.project-tag').should('have.text', 'Personal')
    cy.request('/api/projects').its('body.0.tagIds').should('deep.equal', ['personal'])
  })
})
