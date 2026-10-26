# Pam

Pam (from **PM**, project manager) is my personal project manager. It tracks the status, priority and deadlines of my ongoing and completed projects and the tasks inside them.

It is a Vue app that runs on Cloudflare: a single Worker serves the app and a small API, and the data lives in a Cloudflare D1 (SQLite) database.

## Features

- **Dashboard** of live projects. A project stays live until it has tasks and all of them are done.
- **Sort** the projects by delivery date, urgency (most or least urgent first) or % complete, and **filter** them by tag and urgency. The choices are remembered in the browser.
- **Project tiles** show the project's tag, priority, due date, an overdue tag and task progress. Click a tile to expand a preview of its tasks and reference links.
- **Projects** have a name, description, delivery date, priority, an optional tag, tasks and reference links.
- **Taskbar** hidden on the left edge of the screen. Hover over it to slide it out over the page, with buttons for **Tags**, **Add task** and **Add project**. On phones and other touch screens these are behind a **+** button in the bottom-right corner instead.
- **Works on phones**: each form has its own address (such as `/projects/new` or `/tags`), so the back button or gesture closes it, and the forms keep Save and Cancel pinned to the bottom of the screen.
- **Tags** such as School (SUTD), Work and Personal file projects by area of life. Add, rename and delete them from **Tags** in the taskbar. Renaming a tag renames it on every project, and deleting one leaves its projects untagged.
- **Tasks** have a name, description, due date, priority, completed flag and relations to other tasks (blocks, blocked by, subtask of, parent of, related to). A task can be assigned to several projects, from either the project form or the task form.

## Tech stack

| Part | Tools |
|---|---|
| Frontend | [Vue 3](https://vuejs.org/), [Pinia](https://pinia.vuejs.org/), [Pico CSS](https://picocss.com/), TypeScript |
| Build | [Vite](https://vite.dev/) with the [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/) |
| Backend | [Cloudflare Workers](https://developers.cloudflare.com/workers/) (`worker/index.ts`) |
| Database | [Cloudflare D1](https://developers.cloudflare.com/d1/) |
| Tests | [Vitest](https://vitest.dev/) with Vue Test Utils and the [Cloudflare Vitest plugin](https://developers.cloudflare.com/workers/testing/vitest-integration/), [Cypress](https://www.cypress.io/) |

## Project structure

```
src/
  components/
    dashboard.vue     main page: loads data, lists projects, opens the forms
    listControls.vue  the sort menu and the tag and urgency filters
    taskbar.vue       the Tags, Add task and Add project buttons: a hidden bar on the left, or a + button on phones
    projectTile.vue   one project on the dashboard; expands into a preview
    project.vue       create/edit a project
    task.vue          create/edit a task, including which projects it is in
    tags.vue          add, rename and delete tags
  router/             one route per form, all showing the dashboard, so back closes forms
  stores/             Pinia stores for projects, tasks and tags; they load and save through the API
  types/              Project, Task and Tag models, shared by the app and the Worker
  api.ts              client for the Worker API
  __tests__/          unit tests
worker/
  index.ts            the /api routes, reading and writing D1
  migrate.ts          applies migrations/ to the database on the Worker's first request
  __tests__/          integration tests for the API and database
cypress/
  e2e/                end-to-end tests
  support/            commands and builders for test data
migrations/           SQL that creates the database tables
wrangler.jsonc        Worker and database configuration
```

## Getting started

You need Node.js `^22.18.0` or `>=24.12.0` and pnpm 10.

```sh
pnpm install
pnpm dev
```

`pnpm dev` runs the app with hot reload, and runs the API in the real Workers runtime against a local database under `.wrangler/`. The Worker creates the tables on its first request. Nothing touches Cloudflare until you deploy.

### Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Start the dev server with the API and local database |
| `pnpm build` | Type-check and build the app and Worker into `dist/` |
| `pnpm preview` | Serve the production build locally, with the API |
| `pnpm test` | Run the unit and integration tests once |
| `pnpm test:unit` | Run the unit tests in watch mode |
| `pnpm test:integration` | Run the Worker integration tests in watch mode |
| `pnpm test:e2e` | Build, then run the end-to-end tests headless |
| `pnpm test:e2e:dev` | Open Cypress against the dev server |
| `pnpm type-check` | Type-check the app, Worker and config files |
| `pnpm deploy` | Build and deploy to Cloudflare |
| `pnpm db:migrate:local` | Apply new migrations to the local database now, instead of on the Worker's next start |
| `pnpm db:migrate:remote` | Apply new migrations to the production database now, instead of on the Worker's next start |
| `pnpm db:migrate:e2e` | Apply new migrations to the end-to-end test database (run by `pnpm test:e2e`) |
| `pnpm cf-typegen` | Regenerate `worker/worker-configuration.d.ts` after changing `wrangler.jsonc` |

## Data storage

The app never talks to the database directly. The Pinia stores call the Worker API through `src/api.ts`, and the Worker reads and writes D1.

```
Vue app (Pinia stores)  ──fetch──▶  Worker /api/*  ──SQL──▶  D1
```

### API

| Request | Result |
|---|---|
| `GET /api/projects` | All projects |
| `PUT /api/projects/:id` | Create or update the project in the body; returns it |
| `DELETE /api/projects/:id` | Delete the project |
| `GET /api/tasks` | All tasks |
| `PUT /api/tasks/:id` | Create or update the task in the body; returns it |
| `DELETE /api/tasks/:id` | Delete the task, removing it from projects and relations |
| `GET /api/tags` | All tags, by name |
| `PUT /api/tags/:id` | Create or rename the tag in the body; returns it |
| `DELETE /api/tags/:id` | Delete the tag, leaving its projects untagged |

Bodies are the `Project`, `Task` and `Tag` objects from `src/types`. The Worker checks every field and answers `400` with an error message if something is invalid, including a reference to a task or tag that doesn't exist, or a tag name that another tag already has. Each save runs as one transaction, so a failed save changes nothing.

### Schema

Defined in the files in `migrations/`. Each field has its own column, and each array is stored in its own table with a `position` column that keeps its order.

| Table | Holds | Columns |
|---|---|---|
| `projects` | `Project` | `id`, `name`, `description`, `delivery_date`, `priority`, `tag_id` → `tags`, `created_at`, `updated_at` |
| `tasks` | `Task` | `id`, `name`, `description`, `due_date`, `priority`, `completed`, `created_at`, `updated_at` |
| `project_tasks` | `Project.taskIds` | `project_id` → `projects`, `task_id` → `tasks`, `position` |
| `project_links` | `Project.links` | `project_id` → `projects`, `position`, `label`, `url` |
| `task_relations` | `Task.relations` | `task_id` → `tasks`, `related_task_id` → `tasks`, `type`, `position` |
| `tags` | `Tag` | `id`, `name`, `created_at`, `updated_at` |

- `project_tasks` links projects to tasks. A task can be in several projects.
- All foreign keys cascade on delete. Deleting a task removes it from its projects and from other tasks' relations, and deleting a project removes its links. The exception is `projects.tag_id`, which is set to `NULL` when its tag is deleted.
- Tag names are unique, ignoring case. A new database starts with the tags School (SUTD), Work and Personal.
- `CHECK` constraints limit `priority` to `low`, `medium`, `high` or `urgent`; relation `type` to `blocks`, `blocked_by`, `subtask_of`, `parent_of` or `related_to`; and `completed` to `0` or `1`.
- Dates are ISO 8601 strings such as `2026-10-25`. Timestamps are UTC, such as `2026-10-25T15:08:26.123Z`.

### Changing the schema

Add a new numbered file to `migrations/`, such as `0002_add_tags.sql`, instead of editing an applied one. End each statement with a semicolon at the end of a line.

You don't need to apply it by hand. When a Worker instance handles its first request, `worker/migrate.ts` applies any files in `migrations/` that the database doesn't have yet. It records them in the `d1_migrations` table, the same one `wrangler d1 migrations apply` uses. The `pnpm db:migrate:*` scripts still work if you want to apply a migration before deploying.

## Deploying to Cloudflare

The app deploys as one Cloudflare Worker named `secretary-pam`. It serves the built app as static assets and handles `/api/*`. There are two databases:

| Database | Used by |
|---|---|
| `pam-data` | Production deploys, from the production branch |
| `secretary-pam-preview` | Preview deploys, from every other branch, so testing never touches real data |

### First-time setup

```sh
pnpm exec wrangler login

pnpm exec wrangler d1 create pam-data
# Put the printed database_id in the top-level "d1_databases" in wrangler.jsonc

pnpm exec wrangler d1 create secretary-pam-preview
# Put the printed database_id under "previews" → "d1_databases" in wrangler.jsonc
```

Commit `wrangler.jsonc` after adding the ids. The Worker creates the tables in each database on its first request.

### Deploying

- **From your machine:** run `pnpm deploy`.
- **From Git:** connect the repository under Workers & Pages → Create → Workers → Import a repository. Use a Worker, not a Pages project. Set the build command to `pnpm run build` and the deploy command to `pnpm exec wrangler deploy`. Pushes to the production branch deploy the live site. Pushes to other branches create Preview deployments with their own URLs.

The `packageManager` field in `package.json` makes Cloudflare's build use pnpm 10. pnpm 9 can't read this project's `pnpm-workspace.yaml`.

### Security

The API has no login of its own, so anyone with the URL can read and change the data. Put the Worker behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/) and allow only your own email. You can enable it from the Worker's Settings → Domains & Routes in the dashboard.

## Testing

There are three layers of tests:

| Layer | Command | Where | What it covers |
|---|---|---|---|
| Unit | `pnpm test:unit` | `src/__tests__/` | Components, stores, models and the API client in a simulated browser (jsdom). `fetch` is replaced by an in-memory fake API (`fakeApi.ts`), so no server or database is needed. |
| Integration | `pnpm test:integration` | `worker/__tests__/` | The Worker API inside the real Workers runtime, against a real D1 database built from `migrations/`. Covers routing, saving and reading every field, tags, migrations, validation, transactions, cascading deletes and the schema's constraints. The database is emptied before every test. |
| End-to-end | `pnpm test:e2e` | `cypress/e2e/` | The production build in a real browser (Cypress), with the Worker and a local D1 database. Covers creating and editing projects and tasks, managing tags, the tile preview, sorting, and how errors are shown. |

`pnpm test` runs the unit and integration tests together.

End-to-end tests use their own database in `.wrangler/e2e-state`, so they never touch the data you use with `pnpm dev`. Each test clears it and adds the data it needs through the API, using the commands in `cypress/support/commands.ts`. `pnpm test:e2e` builds the app first. `pnpm test:e2e:dev` opens the Cypress app against the dev server instead, which is quicker for writing tests.

If Cypress fails to start with `bad option: --smoke-test`, the `ELECTRON_RUN_AS_NODE` environment variable is set. Some editor extensions set it for the processes they start. Unset it, or run the tests from a normal terminal.

## Roadmap

Planned, not built yet:

- Open and edit existing tasks from the dashboard
- Task list view
- Project list view, including completed projects
- Messages
- Settings and profile

## Editor setup

[VS Code](https://code.visualstudio.com/) with the [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) extension. Type-checking uses `vue-tsc` instead of `tsc`, so `.vue` files are checked too. The [Vue.js devtools](https://devtools.vuejs.org/) panel is built into `pnpm dev`.
