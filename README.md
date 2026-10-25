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
pnpm db:migrate:local   # creates the tables in the local D1 database (.wrangler/)
```

### Compile and Hot-Reload for Development

```sh
pnpm dev
```

`pnpm dev` and `pnpm preview` run the API in [worker/index.ts](worker/index.ts) in the local Workers runtime, backed by a local D1 database.

## Deploying to Cloudflare

The app is deployed as a single Cloudflare Worker: it serves the built Vue app as static assets and handles `/api/*`, which stores projects and tasks in a [D1](https://developers.cloudflare.com/d1/) database. Configuration is in [wrangler.jsonc](wrangler.jsonc).

First deploy:

```sh
pnpm exec wrangler login
pnpm exec wrangler d1 create secretary-pam   # put the printed database_id in wrangler.jsonc
pnpm db:migrate:remote                       # creates the tables in the remote database
pnpm deploy
```

Later deploys only need `pnpm deploy`. After adding a file to [migrations/](migrations/), run `pnpm db:migrate:local` and `pnpm db:migrate:remote`. After changing bindings in `wrangler.jsonc`, run `pnpm cf-typegen`.

The API has no login of its own, so anyone with the URL can read and change the data. Put the Worker behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/) (Zero Trust → Access → Applications, allow only your email), or enable Access from the Worker's Settings → Domains & Routes in the dashboard.

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