import { project } from '../support/factories'

const field = (label: string) => cy.contains('label', label).find('input')

// A new email each run, since the e2e database keeps its accounts between runs
const newEmail = () => `new-${Date.now()}@example.com`

describe('Signing in', () => {
  it('sends a signed-out visitor to the sign-in page, then on to the page they asked for', () => {
    cy.resetData()
    cy.clearCookies()
    cy.visit('/tags')

    cy.location('pathname').should('eq', '/login')
    cy.contains('h2', 'Sign in')
    field('Email').type('e2e@example.com')
    field('Password').type('e2e test password{enter}')

    cy.location('pathname').should('eq', '/tags')
    cy.contains('h2', 'Tags')
    cy.contains('.account', 'e2e@example.com')
  })

  it('says so when the password is wrong, and stays on the page', () => {
    cy.resetData()
    cy.clearCookies()
    cy.visit('/login')

    field('Email').type('e2e@example.com')
    field('Password').type('wrong password{enter}')

    cy.get('[role="alert"]').should('have.text', 'Wrong email or password')
    cy.location('pathname').should('eq', '/login')
  })

  it('creates an account that starts empty, apart from the other accounts, and signs out of it', () => {
    cy.resetData()
    cy.seed({ projects: [project('p', { name: 'Thesis' })] })
    cy.clearCookies()
    const email = newEmail()

    cy.visit('/login')
    cy.contains('a', 'Create one').click()
    cy.contains('h2', 'Create an account')
    field('Email').type(email)
    field('Password').type('new account password')
    field('Confirm password').type('new account password{enter}')

    cy.location('pathname').should('eq', '/')
    cy.contains('.account', email)
    cy.contains('No projects yet')
    cy.contains('Thesis').should('not.exist')

    cy.contains('button', 'Sign out').click()
    cy.location('pathname').should('eq', '/login')
    cy.visit('/')
    cy.location('pathname').should('eq', '/login')

    // The test account still has its project
    field('Email').type('e2e@example.com')
    field('Password').type('e2e test password{enter}')
    cy.contains('.project-tile', 'Thesis')
  })
})
