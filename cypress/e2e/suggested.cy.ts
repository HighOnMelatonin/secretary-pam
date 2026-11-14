import { daysFromToday, project, task } from '../support/factories'

// The Suggested view of Upcoming, its quick actions, and the settings page, on a wide screen and
// on a phone. Settings are reset to the defaults before each test (cy.resetData).
const suggested = () => cy.get('section.upcoming')
const row = (name: string) => suggested().contains('li.task', name)
// Nothing on the page is wider than the screen, so it never scrolls sideways
const fitsTheScreen = () =>
  cy.document().should((doc) => {
    expect(doc.documentElement.scrollWidth).to.be.at.most(doc.documentElement.clientWidth)
  })

for (const [screen, width, height] of [
  ['a wide screen', 1280, 800],
  ['a phone', 375, 740],
] as const) {
  describe(`Suggested on ${screen}`, () => {
    beforeEach(() => {
      cy.viewport(width, height)
      cy.resetData()
      cy.seed({
        tasks: [
          task('late', { name: 'Late report', dueDate: daysFromToday(-2) }),
          task('draft', { name: 'Draft chapter', priority: 'high', effortMinutes: 90 }),
          task('later', { name: 'Book room', startDate: daysFromToday(3) }),
        ],
        projects: [project('p', { name: 'Thesis', deliveryDate: daysFromToday(60), taskIds: ['draft'] })],
      })
      cy.visit('/')
      suggested().contains('button', 'Suggested').click()
    })

    it('shows the workload brief, the next seven days and the pace of each project, within the screen', () => {
      cy.get('section.workload').should('be.visible').find('.brief').should('contain', 'of open work')
      cy.get('section.workload .strip li').should('have.length', 7).each(($day) => {
        expect($day[0]!.getBoundingClientRect().right).to.be.at.most(width)
      })
      cy.contains('.project-tile', 'Thesis').find('.tag.pace').should('be.visible')
      fitsTheScreen()
    })

    it('ranks the tasks with a reason each, and remembers the view', () => {
      suggested().contains('.group', 'Overdue').should('contain', 'Late report').and('contain', 'Was due 2 days ago')
      suggested().contains('.group', 'Do next').should('contain', 'Draft chapter')
      suggested().should('contain', 'Hidden: 1 not started yet.')
      fitsTheScreen()

      cy.reload()
      suggested().contains('button', 'Suggested').should('have.attr', 'aria-pressed', 'true')
    })

    it('pins a task to today, edits its estimate and greys out Not today on an overdue task', () => {
      row('Late report').contains('button', 'Not today').should('be.disabled')
      row('Late report').should('contain', "It's overdue, so it can't wait until tomorrow")

      row('Draft chapter').contains('button', 'Do today').click()
      suggested().contains('.group', 'Do nowww').should('contain', 'Draft chapter')
      row('Draft chapter').should('contain', 'Pinned to today')

      row('Draft chapter').contains('button', 'Estimate: 1.5 h').click()
      row('Draft chapter').find('input').clear().type('3{enter}')
      row('Draft chapter').contains('button', 'Estimate: 3 h').should('be.visible')
      fitsTheScreen()

      // Saved, so still there after a reload
      cy.reload()
      row('Draft chapter').should('contain', 'Pinned to today').contains('button', 'Estimate: 3 h')
    })
  })

  describe(`Settings on ${screen}`, () => {
    beforeEach(() => {
      cy.viewport(width, height)
      cy.resetData()
      // No dates, so the order doesn't depend on the day the tests run. Balanced puts the task in
      // the high-priority project first; Blockers-first weighs what Unblocker unblocks twice as much,
      // which puts it first.
      cy.seed({
        tasks: [
          task('blocked', { name: 'Blocked' }),
          task('unblocker', { name: 'Unblocker', priority: 'low', effortMinutes: 360, relations: [{ taskId: 'blocked', type: 'blocks' }] }),
          task('big', { name: 'In a big project', priority: 'low' }),
        ],
        projects: [project('p', { name: 'Big project', priority: 'high', taskIds: ['big'] })],
      })
    })

    it('previews a preset, then applies it', () => {
      cy.visit('/')
      cy.contains('.account a', 'Settings').click()
      cy.location('pathname').should('eq', '/settings')
      cy.contains('label', 'Blockers-first').find('input').check()
      cy.get('.preview-list li').should('have.length', 2)
      cy.get('.preview-list li').first().should('contain', 'Unblocker').and('contain', 'up 1')
      cy.get('.preview-list li').last().should('contain', 'In a big project').and('contain', 'down 1')
      fitsTheScreen()
      cy.contains('button', 'Apply').should('be.visible').click()

      cy.location('pathname').should('eq', '/')
      cy.request('/api/settings').its('body').should('include', { preset: 'blockers', wU: 1, k: 2, horizonDays: 2 })
      suggested().contains('button', 'Suggested').click()
      suggested().find('.task-name').first().should('have.text', 'Unblocker')
    })

    it('discards changes on Cancel', () => {
      cy.visit('/settings')
      cy.get('.days input').first().clear().type('4')
      cy.contains('button', 'Cancel').click()
      cy.location('pathname').should('eq', '/')
      cy.request('/api/settings').its('body.capacityMinutes.mon').should('eq', 480)
    })
  })
}
