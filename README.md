# Pam

Pam (from **PM**, project manager) is my personal project manager. It tracks the status, priority and deadlines of my ongoing and completed projects and the tasks inside them.

It is a Vue app that runs on Cloudflare: a single Worker serves the app and a small API, and the data lives in a Cloudflare D1 (SQLite) database.

## Features

- **Dashboard** of live projects, with **archived projects** in a collapsible section below. When a project's last task is done, it gets the built-in **Archive** tag and moves to that section. Remove the tag in the project's form to bring it back; it stays live until its tasks go from not all done to all done again.
- **Sort** the projects by delivery date, urgency (most or least urgent first) or % complete, and **filter** them by tag and urgency. The choices are remembered in the browser.
- **Project tiles** show the project's tags, priority, due date, an overdue tag and task progress. Click a tile to expand a preview of its timeline, tasks and reference links, with an **Edit** button on each task. Click a task's check mark to mark it done or not done. Each task's name links to its page, and **View more** opens the project's page. **Expand all** above the list opens every tile at once (and **Collapse all** closes them), and open tiles stay open after a visit to a project's page.
- **Project pages** (`/projects/:id`) use the whole screen for one project: its details and progress, its timeline, every task with its description, and its reference links.
- **Task pages** (`/tasks/:id`) show a task's status, priority, due date and description, the projects it is in, and its related tasks. Relations are shown from both sides, so if A blocks B, B's page says it is blocked by A.
- **Projects** have a name, description, delivery date, priority, any number of tags, tasks and reference links.
- **Taskbar** hidden on the left edge of the screen. Hover over it to slide it out over the page, with buttons for **Tags**, **Add task** and **Add project**. On phones and other touch screens these are behind a **+** button in the bottom-right corner instead.
- **Upcoming tasks** in a section at the top of the dashboard, above the projects. It lists every unfinished task that is overdue or due in the next 14 days, from all projects, soonest first, with each task's projects, check mark and **Edit** button. Tasks with no due date, or only in archived projects, are left out. Once the section scrolls out of view, a coral **overdue** counter floats in the top-right corner; click it to scroll back up to it.
- **Works on phones**: each form has its own address (such as `/projects/new` or `/tags`), so the back button or gesture closes it, and the forms keep Save and Cancel pinned to the bottom of the screen.
- **Tags** such as School (SUTD), Work and Personal file projects by area of life. Add, rename and delete them from **Tags** in the taskbar. Renaming a tag renames it on every project, and deleting one removes it from its projects. The Archive tag can be renamed but not deleted.
- **Tasks** have a name, description, due date, priority, completed flag and relations to other tasks (blocks, blocked by, subtask of, parent of, related to). A task can be assigned to several projects, from either the project form or the task form. A task can't be due after the delivery date of a project it's in: once both dates are set, either form points out the clash, offers to extend the project's deadline or move the task's due date, and won't add the task or save until it's fixed.

## Tech stack

| Part | Tools |
|---|---|
| Frontend | [Vue 3](https://vuejs.org/), [Pinia](https://pinia.vuejs.org/), [Pico CSS](https://picocss.com/), TypeScript |
| Build | [Vite](https://vite.dev/) with the [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/) |
| Backend | [Cloudflare Workers](https://developers.cloudflare.com/workers/) (`worker/index.ts`) |
| Database | [Cloudflare D1](https://developers.cloudflare.com/d1/) |
| Tests | [Vitest](https://vitest.dev/) with Vue Test Utils and the [Cloudflare Vitest plugin](https://developers.cloudflare.com/workers/testing/vitest-integration/), [Cypress](https://www.cypress.io/) |

## Design

A dark theme: [Pico CSS](https://picocss.com/) recoloured in `src/assets/css/main.css`, with a serif typeface (Iowan Old Style, falling back to Palatino and Georgia). Every colour is a CSS variable there, so use the variable rather than the hex code.

### Palette

| Colour | Hex | Variable | Used for |
|---|---|---|---|
| Forest green | `#204030` | `--pam-green` | Page background, form fields, and text on cream or coral fills |
| Raised green | `#2a5040` | `--pam-green-raised` | Cards (project tiles, forms), the taskbar and menus |
| Cream | `#faefe0` | `--pam-cream` | Text, primary buttons, progress bars |
| Indigo (accent) | `#343ca6` | `--pam-indigo` | Categories: project tag badges, selected tag filters |
| Coral (accent) | `#e69e7a` | `--pam-coral` | Needs attention: urgent and overdue badges, selected urgency filters |

Three shades are derived from these: `--pam-green-line` (`#3d6652`) for borders and secondary buttons, `--pam-cream-muted` (cream at 68%) for secondary text, and `--pam-cream-faint` (cream at 14%) for focus rings.

### Accents

The accents carry meaning, so keep them to their jobs: **indigo** says which area of life something belongs to, and **coral** says it needs attention. Using them for decoration would blur that.

Their contrast with the rest of the palette decides how they can be used:

| Pairing | Contrast | Rule |
|---|---|---|
| Cream text on indigo | 7.9 : 1 | Indigo is only ever a fill behind cream text |
| Indigo on forest / raised green | 1.3 : 1 / 1.0 : 1 | Never indigo text or borders on the greens. Give an indigo shape on the page a cream border so its edge shows |
| Green text on coral | 5.2 : 1 | Text on a coral fill is forest green |
| Cream text on coral | 1.9 : 1 | Never cream on coral |
| Coral on forest green | 5.2 : 1 | Coral text is fine on the page background |
| Coral on raised green | 4.1 : 1 | On cards, coral is for borders, not small text (which needs 4.5 : 1) |

Colour is never the only cue: badges spell out their meaning, and a selected filter chip shows a ✓ as well as its colour.

### Badges

Priority badges get louder as the priority rises, and overdue is the loudest:

| Badge | Style |
|---|---|
| low | faint green outline |
| medium | muted cream outline |
| high | cream outline |
| urgent | coral outline |
| overdue | coral fill |
| project tag (e.g. Work) | indigo fill, in the case it was typed |

## Project structure

```
src/
  components/
    dashboard.vue     main page: loads data, lists projects, opens the forms
    listControls.vue  the sort menu and the tag and urgency filters
    taskbar.vue       the Tags, Add task and Add project buttons: a hidden bar on the left, or a + button on phones
    upcomingPanel.vue the upcoming tasks section above the projects, and the overdue counter that floats once it scrolls away
    projectTile.vue   one project on the dashboard; expands into a preview
    project.vue       create/edit a project
    task.vue          create/edit a task, including which projects it is in
    tags.vue          add, rename and delete tags
  router/             one route per form, all showing the dashboard, so back closes forms
  stores/             Pinia stores for projects, tasks and tags; they load and save through the API
  types/              Project, Task and Tag models, shared by the app and the Worker, and which tasks are upcoming
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
| `DELETE /api/tags/:id` | Delete the tag, removing it from its projects (`400` for the built-in `archive` tag) |

Bodies are the `Project`, `Task` and `Tag` objects from `src/types`, sent as `application/json`. The Worker checks every field and answers `400` with an error message if something is invalid, including a reference to a task or tag that doesn't exist, or a tag name that another tag already has. Each save runs as one transaction, so a failed save changes nothing.

The limits in `src/types/limits.ts` apply to the forms and the API alike: names and link labels up to 200 characters, descriptions up to 10,000, ids up to 100, link URLs up to 2,000, and up to 500 tasks, tags, links or relations on one item. Reference links must start with `http:`, `https:` or `mailto:`, so a `javascript:` link can't run code in the app when clicked. Every value reaches D1 as a bound parameter, never as part of the SQL.

The Worker doesn't check that a task's due date is on or before the delivery dates of its projects. Only the task and project forms enforce that, so a project or task saved straight through the API can break the rule. Its form will then refuse to save until the dates are fixed.

### Schema

Defined in the files in `migrations/`. Each field has its own column, and each array is stored in its own table with a `position` column that keeps its order.

| Table | Holds | Columns |
|---|---|---|
| `projects` | `Project` | `id`, `name`, `description`, `delivery_date`, `priority`, `created_at`, `updated_at` (and `tag_id`, unused since `0003`) |
| `tasks` | `Task` | `id`, `name`, `description`, `due_date`, `priority`, `completed`, `created_at`, `updated_at` |
| `project_tasks` | `Project.taskIds` | `project_id` → `projects`, `task_id` → `tasks`, `position` |
| `project_links` | `Project.links` | `project_id` → `projects`, `position`, `label`, `url` |
| `project_tags` | `Project.tagIds` | `project_id` → `projects`, `tag_id` → `tags`, `position` |
| `task_relations` | `Task.relations` | `task_id` → `tasks`, `related_task_id` → `tasks`, `type`, `position` |
| `tags` | `Tag` | `id`, `name`, `created_at`, `updated_at` |

- `project_tasks` links projects to tasks. A task can be in several projects.
- All foreign keys cascade on delete. Deleting a task removes it from its projects and from other tasks' relations, deleting a project removes its links and tags, and deleting a tag removes it from its projects.
- Tag names are unique, ignoring case. A new database starts with the tags School (SUTD), Work and Personal, plus the built-in Archive tag (id `archive`).
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

- Task list view
- Project list view, including completed projects
- Messages
- Settings and profile

## Editor setup

[VS Code](https://code.visualstudio.com/) with the [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) extension. Type-checking uses `vue-tsc` instead of `tsc`, so `.vue` files are checked too. The [Vue.js devtools](https://devtools.vuejs.org/) panel is built into `pnpm dev`.
