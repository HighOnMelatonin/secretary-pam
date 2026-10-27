import { daysFromToday, project, task } from '../support/factories'

const field = (label: string) => cy.contains('label', label).find('input, select, textarea')
const tile = (name: string) => cy.contains('.project-tile', name)

describe('Projects', () => {
  beforeEach(() => {
    cy.resetData()
  })

  it('creates the first project and keeps it after a reload', () => {
    cy.visit('/')
    cy.contains('h2', 'No projects yet')
    cy.contains('button', 'Create a project').click()

    cy.contains('button', /^Add$/).should('be.disabled')
    field('Project name').type('Thesis')
    field('Delivery date').type('2027-01-18')
    field('Priority').select('high')
    field('Description').type('Final year project')
    cy.contains('button', /^Add$/).should('be.enabled').click()

    tile('Thesis').within(() => {
      cy.contains('.tag', 'high')
      cy.contains('Due 2027-01-18')
      cy.contains('Final year project')
      cy.contains('0 of 0 tasks completed')
    })

    cy.reload()
    tile('Thesis').should('be.visible')
  })

  it('edits a project and adds a reference link', () => {
    cy.seed({ projects: [project('p', { name: 'Thesis' })] })
    cy.visit('/')

    tile('Thesis').contains('button', 'Edit').click()
    field('Project name').clear().type('Final thesis')
    cy.get('input[placeholder="Label (e.g. GitHub repo)"]').type('Repo')
    cy.get('input[placeholder="https://"]').type('https://example.com/repo')
    cy.contains('button', 'Add link').click()
    cy.contains('button', 'Save').click()

    cy.reload()
    tile('Final thesis').find('.meta').click()
    tile('Final thesis').contains('a', 'Repo').should('have.attr', 'href', 'https://example.com/repo')
    cy.get('.project-tile').should('have.length', 1)
  })

  it('discards edits on cancel', () => {
    cy.seed({ projects: [project('p', { name: 'Thesis' })] })
    cy.visit('/')

    tile('Thesis').contains('button', 'Edit').click()
    field('Project name').clear().type('Something else')
    cy.contains('button', 'Cancel').click()

    tile('Thesis').should('be.visible')
    cy.request('/api/projects').its('body.0.name').should('eq', 'Thesis')
  })

  it('expands a tile to preview its tasks and links, and collapses it again', () => {
    cy.seed({
      tasks: [task('t1', { name: 'Write report', completed: true }), task('t2', { name: 'Review slides', dueDate: '2026-12-01' })],
      projects: [
        project('p', { name: 'Thesis', taskIds: ['t1', 't2'], links: [{ label: 'Repo', url: 'https://example.com/repo' }] }),
      ],
    })
    cy.visit('/')

    tile('Thesis').within(() => {
      cy.contains('1 of 2 tasks completed')
      cy.get('.preview').should('not.exist')

      cy.get('.meta').click()
      cy.get('.tile-toggle').should('have.attr', 'aria-expanded', 'true')
      cy.get('.preview').within(() => {
        cy.contains('li', 'Write report').should('have.class', 'done')
        cy.contains('li', 'Review slides').should('contain', 'Due 2026-12-01')
        cy.contains('a', 'Repo')
      })

      cy.get('.tile-toggle').click()
      cy.get('.preview').should('not.exist')
    })
  })

  it('expands and collapses every tile at once', () => {
    cy.seed({ projects: [project('a', { name: 'Thesis' }), project('b', { name: 'Internship' })] })
    cy.visit('/')

    cy.contains('button', 'Expand all').click()
    cy.get('.project-tile.expanded').should('have.length', 2)
    cy.contains('button', 'Collapse all').click()
    cy.get('.project-tile.expanded').should('not.exist')
  })

  it("opens a project's page from View more, then a task's page from its link, and back retraces the way", () => {
    cy.seed({
      tasks: [
        task('t1', { name: 'Write report', description: 'Chapters 1 to 3', relations: [{ taskId: 't2', type: 'blocks' }] }),
        task('t2', { name: 'Review slides' }),
      ],
      projects: [project('p', { name: 'Thesis', description: 'Final year project', taskIds: ['t1', 't2'] })],
    })
    cy.visit('/')

    tile('Thesis').contains('a', 'View more').click()
    cy.location('pathname').should('eq', '/projects/p')
    cy.contains('.page-header h2', 'Thesis')
    cy.contains('Final year project')
    cy.contains('.task', 'Write report').should('contain', 'Chapters 1 to 3')

    cy.contains('.task a', 'Review slides').click()
    cy.location('pathname').should('eq', '/tasks/t2')
    cy.contains('.page-header h2', 'Review slides')
    cy.contains('.related li', 'blocked by').should('contain', 'Write report')

    cy.go('back')
    cy.contains('.page-header h2', 'Thesis')
    cy.go('back')
    tile('Thesis').should('be.visible')
  })

  it("shows the project's tasks on a timeline, in date order around today and the delivery date", () => {
    cy.seed({
      tasks: [
        task('later', { name: 'Draft', dueDate: daysFromToday(7) }),
        task('done', { name: 'Research', dueDate: daysFromToday(-7), completed: true }),
        task('late', { name: 'Interview', dueDate: daysFromToday(-2) }),
        task('undated', { name: 'Someday' }),
      ],
      projects: [
        project('p', { name: 'Thesis', deliveryDate: daysFromToday(14), taskIds: ['later', 'done', 'late', 'undated'] }),
      ],
    })
    cy.visit('/')

    tile('Thesis').find('.tile-toggle').click()
    tile('Thesis').find('.timeline .stop').then((stops) => {
      expect([...stops].map((s) => s.querySelector('.stop-tasks')?.textContent?.replace(/[✓○]|\(completed\)/g, '').trim() ?? '')).to.deep.equal([
        'Research',
        'Interview',
        '', // today
        'Draft',
        '', // delivery
        'Someday',
      ])
    })
    tile('Thesis').find('.stop.overdue').should('contain', 'Interview')
    tile('Thesis').find('.stop.today').should('contain', 'Today')
    tile('Thesis').find('.stop.delivery').should('contain', 'Delivery')
  })

  it('opens the form, not the preview, when Edit is clicked', () => {
    cy.seed({ projects: [project('p', { name: 'Thesis' })] })
    cy.visit('/')

    tile('Thesis').contains('button', 'Edit').click()
    field('Project name').should('have.value', 'Thesis')
  })

  it('lists live projects by delivery date and flags overdue ones', () => {
    cy.seed({
      projects: [
        project('later', { name: 'Later', deliveryDate: daysFromToday(30) }),
        project('undated', { name: 'Undated' }),
        project('overdue', { name: 'Overdue', deliveryDate: daysFromToday(-3) }),
      ],
    })
    cy.visit('/')

    cy.get('.tile-toggle').then((toggles) => {
      expect([...toggles].map((t) => t.textContent!.replace('▸', '').trim())).to.deep.equal(['Overdue', 'Later', 'Undated'])
    })
    tile('Overdue').contains('.tag', 'overdue')
    tile('Later').find('.tag.overdue').should('not.exist')
  })
})
