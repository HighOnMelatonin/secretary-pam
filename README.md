# secretary-pam

## About secretary pam
The name: Pam is derived from PM, for Project manager. As the name suggests, this program is meant to help me manage my projects, tracking the status, priority and deadlines for various ongoing/completed projects

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
- Firefox:
  - [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  - [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

## Type Support for `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI with `vue-tsc` for type checking. In editors, we need [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) to make the TypeScript language service aware of `.vue` types.

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

```sh
pnpm install
```

### Compile and Hot-Reload for Development

```sh
pnpm dev
```

### Type-Check, Compile and Minify for Production

```sh
pnpm build
```

### Run Unit Tests with [Vitest](https://vitest.dev/)

```sh
pnpm test:unit
```

### Run End-to-End Tests with [Cypress](https://www.cypress.io/)

```sh
pnpm test:e2e:dev
```

This runs the end-to-end tests against the Vite development server.
It is much faster than the production build.

But it's still recommended to test the production build with `test:e2e` before deploying (e.g. in CI environments):

```sh
pnpm build
pnpm test:e2e
```

## Code Documentation
### JSON Structure
```
{
  project_name: { 
    "Description": (String),
    "tasks": {
      task1: {
        "deadline": (String),
        "description": (String),
        "Priority": (Integer),
        "Weight": (Integer)
        },
      task2: {
        "deadline": (String),
        "description": (String),
        "Priority": (Integer),
        "Weight": (Integer)
        }
    },
    "Deadline": (String),
    "Affiliation": (String)
  }
}
```
The weight of the task refers to how much effort is required to complete the task

### Components
1. Task
2. Project
3. Message

### Views
1. Project list
2. Task list
3. Main Page
4. Settings/profile
5. Add project
6. Add task