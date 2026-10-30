# Pam

Pam (from **PM**, project manager) is my personal project manager. It tracks the status, priority and deadlines of my ongoing and completed projects and the tasks inside them.

It is a Vue app that runs on Cloudflare: a single Worker serves the app and a small API, and the data lives in a Cloudflare D1 (SQLite) database.

## Features

- **Accounts**: sign in at `/login`, or create an account at `/signup` with an email and a password of at least 8 characters. Each account has its own projects, tasks and tags, and starts with the example tags. The header shows who is signed in, with a **Sign out** button. Opening any page while signed out goes to the sign-in page first, then on to that page.
- **Dashboard** of live projects, with **archived projects** in a collapsible section below. When a project's last task is done, it gets the built-in **Archive** tag and moves to that section. Remove the tag in the project's form to bring it back; it stays live until its tasks go from not all done to all done again. Below the projects, **Unassigned** lists every task that isn't in any project (unfinished first, soonest due), each with its check mark, priority, due date and **Edit** button, and its name linking to its page.
- **Sort** the projects by delivery date, urgency (most or least urgent first) or % complete, and **filter** them by tag and urgency. The choices are remembered in the browser.
- **Project tiles** show the project's tags, priority, due date, an overdue tag and task progress. Click a tile to expand a preview of its timeline, tasks and reference links, with an **Edit** button on each task. Click a task's check mark to mark it done or not done. Each task's name links to its page, and **View more** opens the project's page. **Expand all** above the list opens every tile at once (and **Collapse all** closes them), and open tiles stay open after a visit to a project's page.
- **Task lookup** in the header, on every page: type part of a task's name (any case) and, once you pause, it lists the matching tasks, unfinished first, with their projects (or **Unassigned**), due date and a **done** mark on completed ones. Choose one to open its page.
- **Calendar** (`/calendar`, linked from **Calendar** in the header, with **Projects** leading back) shows a month of unfinished tasks on their due dates and live projects' delivery dates as flags. Each is a chip in the colour of its tag (a task takes the first tag of the first live project it's in; untagged things are grey), with cream or green text, whichever reads better, and links to its page. A day shows up to three chips, then **+N more** to expand it. Overdue chips get a coral ring, and today a cream ring, as on a project's timeline. **‹**, **Today** and **›** move between months, and the month is kept in the address (`?month=2026-11`), so going back after an edit returns to it and the link can be shared. The week can start on Monday or Sunday (remembered in the browser), and the chips can be filtered by tag. Below the grid, **No due date** opens the tasks that have none. On phones the grid is compact, with a dot per item, and tapping a day lists its tasks below with their check marks, **Edit** buttons and projects. Completed tasks and archived projects aren't shown. It is view-only for now: dates are changed in the forms.
- **Project pages** (`/projects/:id`) use the whole screen for one project: its details and progress, its timeline, every task with its description, and its reference links.
- **Export** on a project's page copies its tasks for sharing. It only reads the project, never changes it, and works entirely in the browser. Choose **Markdown** (a checklist, for notes apps, GitHub and chat apps), **Plain text**, **CSV** (for Excel, Google Sheets or Numbers) or **JSON** (structured data, in the `pam-project-export` format a future import would read), and whether to include completed tasks (off at first). A preview shows exactly what you'll get; then **Copy** puts it on the clipboard, or **Download** saves it as `<project>-tasks-<date>.<md|txt|csv|json>`. An export has the project's name and delivery date, then each task's name, due date, priority, whether it's done and its description, in the project's order; relations, tags and links are left out. CSV files start with a byte order mark so Excel reads accents and other scripts correctly (copied CSV leaves it out, so it doesn't stick to the first cell when pasted), and any cell starting with `=`, `+`, `-` or `@` gets a `'` in front so a spreadsheet can't run it as a formula.
- **Task pages** (`/tasks/:id`) show a task's status, priority, due date and description, the projects it is in, and its related tasks. Relations are shown from both sides, so if A blocks B, B's page says it is blocked by A.
- **Projects** have a name, description, delivery date, priority, any number of tags, tasks and reference links.
- **Taskbar** hidden on the left edge of the screen. Hover over it to slide it out over the page, with buttons for **Tags**, **Add task** and **Add project**. On phones and other touch screens these are behind a **+** button in the bottom-right corner instead.
- **Upcoming tasks** in a section at the top of the dashboard, above the projects. It lists every unfinished task that is overdue or due in the next 14 days, from all projects, soonest first, with each task's projects, check mark and **Edit** button. Tasks with no due date, or only in archived projects, are left out. **Show fewer** collapses the section to its first two tasks (and **Show all** expands it again); the browser remembers which. Once the section scrolls out of view, a coral **overdue** counter floats in the top-right corner; click it to scroll back up to it.
- **Works on phones**: each form has its own address (such as `/projects/new` or `/tags`), so the back button or gesture closes it, and the forms keep Save and Cancel pinned to the bottom of the screen.
- **Tags** such as School (SUTD), Work and Personal file projects by area of life. Add, rename, recolour and delete them from **Tags** in the taskbar. Each tag shows its colour beside a **Choose colour** button, which opens the browser's colour picker: any colour can be chosen, and it fills the tag's badges and filter chip, with cream or green text, whichever is easier to read on it. Tags start indigo. Renaming a tag renames it on every project, and deleting one removes it from its projects. The Archive tag can be renamed but not deleted.
- **Google Calendar import**: **Sync Google Calendar**, under **Unassigned** on the dashboard, imports the events of every calendar shown in your Google Calendar, from now to a year ahead, as unassigned tasks. Each one has a tag with the Google account's email. A task is due the day its event starts. An event that ends on a later day starts its description with **Ends** and that day, followed by the event's own description (Google's HTML turned into plain text). Repeating events become one task per occurrence. Cancelled events and working locations ("Home", "Office") are left out. The first time, the button sends you to Google to connect an account, then comes back and syncs. **Google accounts** beside it lists the connected accounts, each with **Disconnect**, and connects more. Syncing again updates each task's name, due date and description from its event, keeping the done mark, priority, relations and projects set in Pam. It adds new events and deletes the tasks whose events were deleted. A task in a project keeps its due date when its event moves past the project's delivery date, and the sync says so. The import is one-way: changes made in Pam are not sent to Google, and the next sync replaces an imported task's name, due date and description, which the task's form and page point out. A task deleted in Pam comes back at the next sync if its event still exists.
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
| Indigo (accent) | `#343ca6` | `--pam-indigo` | Categories: project tag badges, selected tag filters (the default tag colour) |
| Coral (accent) | `#e69e7a` | `--pam-coral` | Needs attention: urgent and overdue badges, selected urgency filters |

Tags are indigo unless given a colour of their own, which can be any colour (`Tag.color`, a `#rrggbb` code). A tag's badge and its selected filter chip are filled with it, and their text is cream or forest green, whichever contrasts more with the fill (`textColorOn` in `src/types/tag.ts`). `tagStyle(tag)` sets both as the CSS variables `--pam-tag-fill` and `--pam-tag-text`, which the styles fall back from to indigo and cream.

Three shades are derived from these: `--pam-green-line` (`#3d6652`) for borders and secondary buttons, `--pam-cream-muted` (cream at 68%) for secondary text, and `--pam-cream-faint` (cream at 14%) for focus rings.

### Accents

The accents carry meaning, so keep them to their jobs: **indigo** (or a tag's own colour) says which area of life something belongs to, and **coral** says it needs attention. Using them for decoration would blur that.

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
| project tag (e.g. Work) | filled with the tag's colour (indigo by default), in the case it was typed |

### Shared styles

Styles used in more than one place live in `main.css`, and each component keeps only its own layout in a `<style scoped>` block, so its class names can't clash with another's. Reuse these rather than restyling a copy:

| Class | For |
|---|---|
| `.small` | Buttons among a row's or tile's content: Edit, View more, Choose colour |
| `.compact` | Buttons beside a heading or among a list's controls: Expand all, Show fewer, Clear filters, filter chips, a date clash's fixes |
| `.heading-row` | A heading with its buttons at the other end, wrapping under it when narrow; `.page-header` adds the no-wrap version for a project or task page's title |
| `.tag` and its variants | Badges: priorities, overdue, and `.project-tag` coloured by `tagStyle()` |
| `.meta` | The row of a project's or task's badges and due date |
| `.section-heading`, `.plain-list` | Small uppercase headings, and lists without bullets |
| `.struck` | A completed task's name |
| `.details-page` | Project and task pages: their description, divided sections and `.columns` |
| `.edit-form` | Project and task forms: the lists of added items, pending date notes, and Save and Cancel kept at the bottom on phones |
| `.error`, `.date-error` | Error messages, and a date clash with its fixes |

## Project structure

```
src/
  components/
    dashboard.vue     main page: loads data, lists projects, opens the forms
    listControls.vue  the sort menu and the tag and urgency filters
    tagFilter.vue     the tag filter's chips, shared by listControls and the calendar
    calendarView.vue  the calendar at /calendar: its toolbar, the month in the URL, and the selected day on phones
    calendarGrid.vue  a month as a table of weeks, full or compact
    calendarDay.vue   one day of the grid (with data-date): its chips, or its dots in the compact grid
    undatedTray.vue   the tasks with no due date, below the calendar
    taskbar.vue       the Tags, Add task and Add project buttons: a hidden bar on the left, or a + button on phones
    upcomingPanel.vue the upcoming tasks section above the projects, and the overdue counter that floats once it scrolls away
    projectTile.vue   one project on the dashboard; expands into a preview
    projectExport.vue the Export button and dialog on a project's page: format, preview, Copy and Download
    project.vue       create/edit a project
    task.vue          create/edit a task, including which projects it is in
    tags.vue          add, rename, recolour and delete tags
    googleSync.vue    the Sync Google Calendar button, what the last sync did, and the connected accounts
    login.vue         the sign-in and sign-up pages
  router/             one route per form and the calendar, all showing the dashboard, so back closes forms
  stores/             Pinia stores for projects, tasks, tags and the signed-in account; they load and save through the API
  types/              Project, Task and Tag models, shared by the app and the Worker, which tasks are upcoming,
                      the calendar's items, dates and month grid (calendar.ts), the export formats (export.ts),
                      what the Google Calendar routes answer (google.ts), and the change tracking log (events.ts)
  api.ts              client for the Worker API, including signing in
  __tests__/          unit tests
worker/
  index.ts            the /api routes, reading and writing the signed-in user's rows in D1
  auth.ts             the /api/auth routes: accounts, passwords and sessions
  google.ts           the /api/google routes: connecting Google accounts and syncing their events into tasks
  events.ts           writing change tracking events, and the GET /api/events route
  jsonChunks.ts       passing many rows to D1 in a few statements, as JSON
  googleCalendar.ts   Google's OAuth and Calendar API: tokens, the calendar list, batched event lists,
                      and what a task takes from an event
  secrets.d.ts        types for the Worker's secrets
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
        ▲                                │
        └──── changes { tasks, projects } ┘
```

The Worker enforces the scheduling rules, so the app sends each save as one request and stores whatever comes back. Saving a task or project goes through the planners in `src/types/operations.ts`, which the Worker and the unit tests' fake API both run:

- **Archiving**: a project whose last task is completed gets the Archive tag. Only projects the save completes are archived, so one taken out of the archive stays out.
- **Membership**: a task save can say which projects the task is in (`projectIds`); the Worker adds it to or removes it from each project. A project save's `taskIds` is its membership.
- **Date clashes**: a save that would make a task due after the delivery date of one of its projects is refused with `409` and the clashes, and nothing is written. The forms offer to move the dates first, and send the moves with the save (`deliveryDates` on a task save, `dueDates` on a project save) so they're checked and written together. Clashes already in the stored data don't block a save that doesn't touch them.

The reply lists every task and project the save changed, and `applyChanges` (`src/stores/changes.ts`) puts each one into the stores, replacing the item with the same id or adding it.

### Accounts

- **Passwords** are stored only as salted PBKDF2-SHA256 hashes (100,000 iterations, the most the Workers runtime allows).
- **Signing in** sets a `pam_session` cookie holding a random token, valid for 30 days. The cookie is `HttpOnly` (scripts can't read it), `SameSite=Lax`, `Secure` over https, and only sent to `/api`. D1 stores only the token's SHA-256 hash. Signing out deletes the session, and reloads the page so nothing of the account stays in memory.
- **Wrong passwords**: a wrong password and an unknown email get the same answer. After 10 failed sign-ins for one email within 15 minutes, that email can't sign in until the failures are 15 minutes old.
- **Separate data**: every route except `/api/auth/*` answers `401` without a valid session. Every table has a `user_id`, which comes from the session, never from the request. Ids are only unique within an account, so two accounts can use the same id without touching each other's rows, and a project can only list its own account's tasks and tags.
- **Data from before accounts** (migration `0004`) belongs to the first account that signs up.
- **Not built yet**: password reset and changing a password. To reset one by hand, delete the account's sessions and set a new hash with `wrangler d1 execute`, or delete the user row, which deletes all of their data.

### API

| Request | Result |
|---|---|
| `POST /api/auth/signup` | Create an account from `{ email, password }` and sign in; returns `{ email }` |
| `POST /api/auth/login` | Sign in with `{ email, password }`; returns `{ email }` (`401` if wrong, `429` once locked) |
| `POST /api/auth/logout` | Sign out |
| `GET /api/auth/me` | `{ email }` of the signed-in account, or `401` |
| `GET /api/projects` | All projects |
| `PUT /api/projects/:id` | Create or update the project from `{ project, dueDates? }`; returns the changed `{ tasks, projects }` (`409` for a date clash) |
| `DELETE /api/projects/:id` | Delete the project |
| `GET /api/tasks` | All tasks |
| `PUT /api/tasks/:id` | Create or update the task from `{ task, projectIds?, deliveryDates? }`; returns the changed `{ tasks, projects }` (`409` for a date clash) |
| `DELETE /api/tasks/:id` | Delete the task, removing it from projects and relations |
| `GET /api/tags` | All tags, by name |
| `PUT /api/tags/:id` | Create, rename or recolour the tag in the body; returns it. `color` is a `#rrggbb` code (stored in lower case); leaving it out keeps an existing tag's colour, or makes a new one indigo |
| `DELETE /api/tags/:id` | Delete the tag, removing it from its projects (`400` for the built-in `archive` tag) |
| `GET /api/google/connect` | Redirect to Google to connect an account |
| `GET /api/google/callback` | Where Google redirects back to: saves the account, then redirects to `/?google=connected` (or `/?google=error&message=…`) |
| `GET /api/google/accounts` | The connected Google accounts, `{ email, syncedAt }` |
| `DELETE /api/google/accounts/:email` | Disconnect the account, revoking Pam's access at Google; its tasks stay |
| `POST /api/google/sync` | Import every connected account's events; returns a `SyncResult` per account (`src/types/google.ts`), or `[]` when none is connected. `503` until the Google secrets are set |
| `GET /api/events?projectId=&since=` | The account's change tracking events (`LoggedEvent` in `src/types/events.ts`), oldest first. `projectId` keeps one project's events; `since` (a `YYYY-MM-DD` date or a UTC timestamp) keeps those at or after it. Both are optional (`400` if malformed) |

Tasks imported from Google Calendar have `googleAccount`, the account's email. Only the sync sets it: a task save keeps the stored one, whatever the body says.

The project, task, tag and Google routes work on the signed-in account's data only. Bodies are the `Project`, `Task` and `Tag` objects from `src/types`, sent as `application/json`. The Worker checks every field and answers `400` with an error message if something is invalid, including a reference to a task or tag that doesn't exist, or a tag name that another tag already has. Each save runs as one transaction, so a failed save changes nothing.

The limits in `src/types/limits.ts` apply to the forms and the API alike: names and link labels up to 200 characters, descriptions up to 10,000, ids up to 100, link URLs up to 2,000, up to 500 tasks, tags, links or relations on one item, emails up to 254, and passwords from 8 to 256. Reference links must start with `http:`, `https:` or `mailto:`, so a `javascript:` link can't run code in the app when clicked. Every value reaches D1 as a bound parameter, never as part of the SQL.

A bare `Task` or `Project` body is still accepted, as sent by clients from before the scheduling rules: it is saved under the same rules, and the reply is the saved item.

### Schema

Defined in the files in `migrations/`. Each field has its own column, and each array is stored in its own table with a `position` column that keeps its order. Every data table starts with `user_id`, and its keys include it: a project is keyed by `(user_id, id)`, and `project_tasks` refers to `tasks` by `(user_id, task_id)`, so a row can only ever point at rows of the same account.

| Table | Holds | Columns |
|---|---|---|
| `users` | Accounts | `id`, `email` (unique, ignoring case), `password_hash`, `created_at` |
| `sessions` | Signed-in browsers | `id` (SHA-256 of the cookie's token), `user_id` → `users`, `expires_at`, `created_at` |
| `login_failures` | Failed sign-ins | `email`, `at` |
| `projects` | `Project` | `user_id` → `users`, `id`, `name`, `description`, `delivery_date`, `priority`, `created_at`, `updated_at` |
| `tasks` | `Task` | `user_id` → `users`, `id`, `name`, `description`, `due_date`, `priority`, `completed`, `created_at`, `updated_at` |
| `project_tasks` | `Project.taskIds` | `user_id`, `project_id` → `projects`, `task_id` → `tasks`, `position` |
| `project_links` | `Project.links` | `user_id`, `project_id` → `projects`, `position`, `label`, `url` |
| `project_tags` | `Project.tagIds` | `user_id`, `project_id` → `projects`, `tag_id` → `tags`, `position` |
| `task_relations` | `Task.relations` | `user_id`, `task_id` → `tasks`, `related_task_id` → `tasks`, `type`, `position` |
| `tags` | `Tag` | `user_id` → `users`, `id`, `name`, `color`, `created_at`, `updated_at` |
| `google_accounts` | Connected Google accounts | `user_id` → `users`, `email`, `refresh_token`, `synced_at`, `created_at` |
| `google_auth_states` | Connections to Google not back yet | `id` (the OAuth state), `user_id` → `users`, `code_verifier` (PKCE), `expires_at` |
| `google_events` | `Task.googleAccount`, and the event each imported task came from | `user_id`, `task_id` → `tasks`, `account_email`, `calendar_id`, `event_id`, `starts_at`, `ends_at` |
| `task_events` | The change tracking log (see below), append-only | `user_id` → `users`, `id` (increasing), `at`, `kind`, `task_id`, `project_id`, `old_value`, `new_value`, `delivery_date_at_time`, `source`, `task_source` |

- `project_tasks` links projects to tasks. A task can be in several projects.
- All foreign keys cascade on delete. `task_events` has none to `tasks` or `projects`, so events outlive what they're about, but deleting a user deletes their events. Deleting a task removes it from its projects and from other tasks' relations, deleting a project removes its links and tags, deleting a tag removes it from its projects, and deleting a user removes their sessions and all of their data.
- Tag names are unique within an account, ignoring case. A new account starts with the tags School (SUTD), Work and Personal, plus the built-in Archive tag (id `archive`).
- `CHECK` constraints limit `priority` to `low`, `medium`, `high` or `urgent`; relation `type` to `blocks`, `blocked_by`, `subtask_of`, `parent_of` or `related_to`; and `completed` to `0` or `1`.
- Dates are ISO 8601 strings such as `2026-10-25`. Timestamps are UTC, such as `2026-10-25T15:08:26.123Z`.

### Change tracking

Pam logs changes to `task_events` so that scope creep, and how well projects were scoped, can be worked out later. Nothing in the app reads the log yet; `GET /api/events` returns it.

**What's logged.** Each event has a `kind`:

| `kind` | When | `old_value` → `new_value` |
|---|---|---|
| `task_created` | A task is made in the app or imported | → its first due date |
| `task_added_to_project`, `task_removed_from_project` | A task joins or leaves a project, from either form, or by a delete | |
| `due_date_changed` | A task's due date moves, from the task form, a project save's `dueDates`, or a sync | old → new date |
| `delivery_date_changed` | A project's delivery date moves, from the project form or a task save's `deliveryDates` | old → new date |
| `task_completed`, `task_reopened` | A task is ticked off or unticked | |
| `task_deleted` | A task is deleted in the app, or by a sync because its event was deleted | |
| `project_created`, `project_deleted` | A project is made or deleted | → its first delivery date |

- An event about a task is logged once for each project the task is in, with that project's `project_id` and `delivery_date_at_time` (its delivery date once the change is made). A task in no project gets one event with no project. `task_created` always has no project, since a task is made before it joins any: a task saved with its projects logs `task_created`, then `task_added_to_project` for each.
- Deleting a task logs `task_deleted`, then its removal from each project. Deleting a project logs `project_deleted`, then the removal of each of its tasks.
- `source` says who made the change: `app`, `google` (a sync) or `backfill`. `task_source` says where the task came from (`app` or `google`), so adding an imported task to a project is `source = 'app'`, `task_source = 'google'`.
- Events are worked out from the data before and after a save, by `diffEvents` in `src/types/events.ts`, which the Worker and the fake API both run. Membership comes from each project's tasks before and after, whichever form changed it.
- Events are written in the same batch as the change, so a refused (`409`) or failed save logs nothing. Only real changes are logged: a save that changes nothing logs nothing.

**What isn't logged:** names, descriptions, priorities, relations, links, tags (including the Archive tag a completed project gets), the order of a project's tasks, and a sync's name or description updates. Nor is a sync's due date that stays put because of a clash.

**Backfilled rows are approximate.** Migration `0007` logged the data from before tracking began as `source = 'backfill'`: one `task_created` per task at its `created_at`, with its due date as it was at the migration (not necessarily its first), and one `task_added_to_project` per project it was in, also at the task's `created_at`, because when it really joined isn't known. There are no backfilled `project_created` events. Leave backfilled rows out of anything that depends on timing.

**Planned or added later.** `isPlanned` in `src/types/events.ts` counts a task as planned for a project if it first joined within `PLANNING_WINDOW_HOURS` (24) of the project's `project_created` event, and as added later otherwise. It returns `undefined` for projects whose creation wasn't logged. The window is a tunable guess, not a recorded fact, and nothing stores the result, so changing it reclassifies all of the history.

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

### Google Calendar

The import needs an OAuth client from Google Cloud, which Pam's Worker uses to ask for read-only access to your calendars:

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project (or pick one) and enable the **Google Calendar API** under APIs & Services → Library.
2. Under **Google Auth Platform** (APIs & Services → OAuth consent screen), set up the app as **External**, and add yourself, and anyone else who will connect an account, as a **test user**. Add the scopes `openid`, `email`, `https://www.googleapis.com/auth/calendar.calendarlist.readonly` (to list your calendars) and `https://www.googleapis.com/auth/calendar.events.readonly` (to read their events). These are the narrowest scopes the import can use, and neither covers the other's call.
3. Under **Clients**, create a client of type **Web application**, with these **Authorised redirect URIs**:
   - `http://localhost:5173/api/google/callback`, for `pnpm dev`
   - `https://<your domain>/api/google/callback`, for each address Pam is deployed at
4. Give the Worker the client's id and secret:
   - for `pnpm dev`, in a `.dev.vars` file at the root of the project (git ignores it):
     ```
     GOOGLE_CLIENT_ID=<client id>
     GOOGLE_CLIENT_SECRET=<client secret>
     ```
   - for deploys, as secrets: `pnpm exec wrangler secret put GOOGLE_CLIENT_ID`, then the same for `GOOGLE_CLIENT_SECRET`

While the app's publishing status is **Testing**, Google lets only the test users connect, and its access lasts 7 days. After that, a sync asks you to connect the account again. To keep access longer, publish the app. Google then asks for verification, because reading calendars is a sensitive scope, and shows a warning until the app is verified.

How it works:

- **Connecting** uses OAuth 2.0's authorization code flow with PKCE, run by the Worker: the browser never sees a Google token. The `state` is stored for 10 minutes against the Pam account that started it, used once and then deleted, so a link to the callback can't connect a Google account to someone else's Pam account. Google is asked for offline access, which gives a refresh token for later syncs, and the account's email comes from the ID token. Accounts connected while Pam asked for the broader `calendar.readonly` still work, as it covers both calls; to drop it, disconnect the account in Pam (which revokes the access at Google) and connect it again.
- **Refresh tokens** are stored in D1 as they are. They can't be used without the client secret, which is a Worker secret and not in the database. Disconnecting an account revokes its token at Google and deletes it.
- **Syncing** gets an access token, lists the account's calendars and keeps the shown ones (`selected` in Google Calendar). It then lists their events in [batch requests](https://developers.google.com/workspace/calendar/api/guides/batch): one request to `/batch/calendar/v3` holds an `events.list` call per calendar (up to 1,000), with the `Authorization` header once on the batch. Google may answer in any order, so each answer is matched to its calendar by `Content-ID`. Calendars with more pages get them in further batches that hold only those calendars. Each call still counts towards Google's quota, and calls that are rate limited (`429`, or `403` with a rate limit reason) or fail on Google's side are tried again after 1, 2 and 4 seconds. `fields` asks only for the parts of each event that the import uses.
- **Writing** happens in one D1 batch per account, so an account's sync is saved in full or not at all. Rows go to D1 as JSON read with `json_each`, a few statements for thousands of events, because D1 limits the queries one request can make.
- **Deleted events**: a task is deleted when its calendar was listed in full but its event wasn't, and the event should have been listed: it ends after now and starts within the year ahead, more than a day from either end, since an all-day event's stored times can be up to a day off. A calendar that couldn't be read, or was hidden in Google Calendar, keeps its tasks.

### Security

Pam has its own accounts (see [Accounts](#accounts)), and anyone who can reach it can create one. To choose who can reach it, put the Worker behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/) and allow only the emails you want. You can enable it from the Worker's Settings → Domains & Routes in the dashboard. Access only covers the hostnames you add to it, so also turn off the `workers.dev` route and Preview URLs (or add them to Access), or they stay open to everyone.

## Testing

There are three layers of tests:

| Layer | Command | Where | What it covers |
|---|---|---|---|
| Unit | `pnpm test:unit` | `src/__tests__/` | Components, stores, models and the API client in a simulated browser (jsdom). `fetch` is replaced by an in-memory fake API (`fakeApi.ts`), so no server or database is needed. |
| Integration | `pnpm test:integration` | `worker/__tests__/` | The Worker API inside the real Workers runtime, against a real D1 database built from `migrations/`. Covers signing up and in, sessions, keeping accounts' data apart, routing, saving and reading every field, tags, migrations, validation, transactions, cascading deletes, the schema's constraints and change tracking. The Google Calendar import runs against a fake Google that stands in for `fetch` (`google.spec.ts`). The database is emptied before every test. |
| End-to-end | `pnpm test:e2e` | `cypress/e2e/` | The production build in a real browser (Cypress), with the Worker and a local D1 database. Covers creating and editing projects and tasks, managing tags, the tile preview, sorting, the calendar, and how errors are shown. |

`pnpm test` runs the unit and integration tests together.

End-to-end tests use their own database in `.wrangler/e2e-state`, so they never touch the data you use with `pnpm dev`. Each test signs in to a test account (`e2e@example.com`, created the first time), clears its data and adds the data it needs through the API, using the commands in `cypress/support/commands.ts`. `pnpm test:e2e` builds the app first. `pnpm test:e2e:dev` opens the Cypress app against the dev server instead, which is quicker for writing tests.

If Cypress fails to start with `bad option: --smoke-test`, the `ELECTRON_RUN_AS_NODE` environment variable is set. Some editor extensions set it for the processes they start. Unset it, or run the tests from a normal terminal.

## Roadmap

Planned, not built yet:

- Task list view
- Project list view, including completed projects
- Messages
- Settings and profile (the calendar's week start would move there from the browser's storage)
- **Rescheduling from the calendar**: drag a chip to another day on wide screens; on phones (where drag and drop doesn't work) tap it, then **Move to…** with a date picker. Dragging a task from **No due date** onto a day gives it that date. Saves through `taskList.saveTask` or `projectList.saveProject`, showing the move straight away and undoing it if the save fails. Items already carry `editable` (false for now) to decide what can be moved. A move that clashes with a delivery date comes back from the Worker as a `409`, and should offer the same clash fixes the forms do.
- **Google Calendar, both ways**: events are imported as tasks one way (see [Google Calendar](#google-calendar)). Still to do: send changes made in Pam back to Google, using the event's etag and update time to detect conflicting edits, and show events on the calendar without making them tasks, through a third adapter beside `taskToItems` and `projectToItems` in `src/types/calendar.ts`. That adapter already asks for items by date range (as Google's API does), keeps a loading and error state per source, places timed events after all-day ones, and has room for time zones and Google's exclusive end dates on all-day events. Syncing on a schedule (a Cron Trigger) rather than by button would also fit here.
- **Logo**: a logo for Pam, to make it look the part.
- **LLM layer**: summarise what needs doing, quickly pick out the high priority tasks, and explain how tasks relate to each other.
- **Android app**: Pam on Android, for home screen widgets and notifications.
- **Data analytics**: track how Pam is used over time: the rate tasks and projects are created, the rate tasks are completed, and the number of tasks per project.
- **Team Pam**: a collaborative Pam for group projects. Scope out the use cases first.

Maintenance:

- Code review: check there's nothing unnecessary in the code, and that its structure and links between parts make sense
- A second code review, later on

## Editor setup

[VS Code](https://code.visualstudio.com/) with the [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) extension. Type-checking uses `vue-tsc` instead of `tsc`, so `.vue` files are checked too. The [Vue.js devtools](https://devtools.vuejs.org/) panel is built into `pnpm dev`.
