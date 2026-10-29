import { daysFromToday, project, tag, task } from '../support/factories'

// "November 2026", as the calendar names the month a date is in
const monthName = (date: string) =>
  new Date(`${date}T00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

describe('Calendar', () => {
  beforeEach(() => {
    cy.viewport(1280, 800)
    cy.resetData()
  })

  it('opens from the header, on this month, and the header leads back to the projects', () => {
    cy.seed({ tasks: [task('soon', { name: 'Review slides', dueDate: daysFromToday(0) })] })
    cy.visit('/')

    cy.contains('.app-nav a', 'Calendar').click()
    cy.location('pathname').should('eq', '/calendar')
    cy.get('#calendar-heading').should('have.text', monthName(daysFromToday(0)))
    cy.get(`[data-date="${daysFromToday(0)}"]`).should('have.class', 'today').contains('.item-chip', 'Review slides')

    cy.contains('.app-nav a', 'Projects').click()
    cy.location('pathname').should('eq', '/')
    cy.contains('h2', 'Upcoming')
  })

  it('moves between months, keeping the month in the URL', () => {
    // Years away, so Today (disabled on this month) always has somewhere to go back to
    cy.visit('/calendar?month=2040-12')
    cy.get('#calendar-heading').should('have.text', 'December 2040')

    cy.get('button[aria-label="Next month"]').click()
    cy.location('search').should('eq', '?month=2041-01')
    cy.get('#calendar-heading').should('have.text', 'January 2041')

    cy.get('button[aria-label="Previous month"]').click()
    cy.get('button[aria-label="Previous month"]').click()
    cy.location('search').should('eq', '?month=2040-11')

    cy.contains('button', 'Today').click()
    cy.location('search').should('eq', `?month=${daysFromToday(0).slice(0, 7)}`)
  })

  it('shows tasks in their tag colour and delivery dates as flags, each linking to its page', () => {
    cy.seed({
      tags: [tag('work', 'Work', '#f5d76e')],
      tasks: [task('report', { name: 'Write report', dueDate: '2027-03-15' })],
      projects: [project('thesis', { name: 'Thesis', tagIds: ['work'], taskIds: ['report'], deliveryDate: '2027-03-20' })],
    })
    cy.visit('/calendar?month=2027-03')

    cy.get('[data-date="2027-03-20"]').contains('.item-chip.flag', 'Thesis')
    cy.get('[data-date="2027-03-15"]')
      .contains('.item-chip', 'Write report')
      .should('have.css', 'background-color', 'rgb(245, 215, 110)')
      .and('have.css', 'color', 'rgb(32, 64, 48)') // forest green, readable on the light yellow
      .click()
    cy.location('pathname').should('eq', '/tasks/report')
    cy.go('back')
    cy.location('search').should('eq', '?month=2027-03')
  })

  it('returns to the same month after editing a task from it and cancelling', () => {
    cy.seed({ tasks: [task('plan', { name: 'Plan chapters' })] })
    cy.visit('/calendar?month=2027-03')

    cy.contains('.undated-tray summary', 'No due date (1)').click()
    cy.get('button[aria-label="Edit task Plan chapters"]').click()
    cy.location('pathname').should('eq', '/tasks/plan/edit')
    cy.contains('button', 'Cancel').click()

    cy.location('pathname').should('eq', '/calendar')
    cy.location('search').should('eq', '?month=2027-03')
    cy.get('#calendar-heading').should('have.text', 'March 2027')
  })

  it('shows a compact grid on a phone, listing the tapped day', () => {
    cy.viewport(375, 740)
    cy.seed({ tasks: [task('report', { name: 'Write report', dueDate: '2027-03-15' })] })
    cy.visit('/calendar?month=2027-03')

    cy.get('.calendar-grid').should('have.class', 'compact')
    cy.get('.item-chip').should('not.exist')
    cy.get('[data-date="2027-03-15"] .dot').should('have.length', 1)

    cy.get('[data-date="2027-03-15"] button').click()
    cy.get('.selected-day').should('contain', 'Monday 15 March').and('contain', 'Write report')

    cy.get('.selected-day button[aria-label="Edit task Write report"]').click()
    cy.contains('button', 'Cancel').click()
    cy.location('search').should('eq', '?month=2027-03')
  })
})
