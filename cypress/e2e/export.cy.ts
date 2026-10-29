import { daysFromToday, project, task } from '../support/factories'

const preview = () => cy.get('#export-preview')
const chooseFormat = (label: string) => cy.contains('.export-dialog .format', label).click()

describe('Exporting a project', () => {
  beforeEach(() => {
    cy.viewport(1280, 800)
    cy.resetData()
    cy.seed({
      tasks: [
        task('t1', { name: 'Write report', dueDate: '2026-11-02', description: 'Chapters 1 to 3' }),
        task('t2', { name: 'Review slides', completed: true }),
      ],
      projects: [project('p', { name: 'Final Thesis', deliveryDate: '2026-12-01', taskIds: ['t1', 't2'] })],
    })
  })

  it('previews the tasks in each format, with completed ones only when asked', () => {
    cy.visit('/projects/p')
    cy.contains('.page-header button', 'Export').click()
    cy.get('.export-dialog').should('be.visible')

    preview().should(
      'have.value',
      '# Final Thesis\n\nDelivery date: 2026-12-01\n\n- [ ] Write report · Due 2026-11-02 · Priority: medium\n\n  Chapters 1 to 3\n',
    )

    chooseFormat('Plain text')
    preview().should('have.value', 'Final Thesis\nDelivery date: 2026-12-01\n\n[ ] Write report · Due 2026-11-02 · Priority: medium\n    Chapters 1 to 3\n')

    cy.contains('label', 'Include completed tasks').click()
    preview().invoke('val').should('contain', '[done] Review slides · No due date · Priority: medium')

    chooseFormat('CSV')
    preview()
      .invoke('val')
      .should('match', /^project,project_delivery_date,task,due_date,priority,completed,description\n/)
      .and('contain', 'Final Thesis,2026-12-01,Write report,2026-11-02,medium,false,Chapters 1 to 3')
      .and('contain', 'Final Thesis,2026-12-01,Review slides,,medium,true,')

    chooseFormat('JSON')
    preview()
      .invoke('val')
      .then((json) => {
        const parsed = JSON.parse(String(json))
        expect(parsed).to.include({ format: 'pam-project-export', version: 1 })
        expect(parsed.project).to.deep.equal({ name: 'Final Thesis', deliveryDate: '2026-12-01' })
        expect(parsed.tasks.map((t: { name: string }) => t.name)).to.deep.equal(['Write report', 'Review slides'])
      })
  })

  it('copies the export and downloads it as a file, changing nothing', () => {
    cy.visit('/projects/p')
    cy.window().then((win) => cy.stub(win.navigator.clipboard, 'writeText').resolves().as('copy'))
    cy.contains('.page-header button', 'Export').click()
    chooseFormat('CSV')

    cy.contains('.export-dialog button', 'Copy').click()
    cy.get('@copy').should('have.been.calledWithMatch', /^project,project_delivery_date,/)
    cy.get('.export-dialog [role="status"]').should('have.text', 'Copied')

    cy.contains('.export-dialog button', 'Download').click()
    cy.readFile(`cypress/downloads/final-thesis-tasks-${daysFromToday(0)}.csv`).should('contain', 'Write report')

    cy.request('/api/tasks').its('body').should('have.length', 2)
    cy.request('/api/projects').its('body.0.taskIds').should('deep.equal', ['t1', 't2'])
  })

  it('fits a phone screen and closes on Escape, back to the Export button', () => {
    cy.viewport(375, 740)
    cy.visit('/projects/p')
    cy.contains('.page-header button', 'Edit').should('be.visible')
    cy.contains('.page-header button', 'Export').should('be.visible').click()

    cy.get('.export-dialog article').then(($panel) => {
      const { left, right } = $panel[0]!.getBoundingClientRect()
      expect(left).to.be.at.least(0)
      expect(right).to.be.at.most(375)
    })
    cy.document().its('documentElement.scrollWidth').should('be.at.most', 375)
    cy.contains('.export-dialog button', 'Download').scrollIntoView().should('be.visible')

    cy.focused().type('{esc}')
    cy.get('.export-dialog article').should('not.exist')
    cy.focused().should('have.text', 'Export')
  })
})
