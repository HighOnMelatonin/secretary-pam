# Pam

Pam (from **PM**, project manager) is my personal project manager. It tracks the status, priority and deadlines of my ongoing and completed projects and the tasks inside them.

It is a Vue app that runs on Cloudflare: a single Worker serves the app and a small API, and the data lives in a Cloudflare D1 (SQLite) database.

- [Pam](#pam)
  - [Features](#features)
  - [Tech stack](#tech-stack)
  - [Design](#design)
    - [Palette](#palette)
    - [Accents](#accents)
    - [Badges](#badges)
    - [Shared styles](#shared-styles)
  - [Project structure](#project-structure)
  - [Getting started](#getting-started)
    - [Scripts](#scripts)
  - [Data storage](#data-storage)
    - [Accounts](#accounts)
    - [API](#api)
    - [Schema](#schema)
    - [Change tracking](#change-tracking)
    - [Changing the schema](#changing-the-schema)
  - [Deploying to Cloudflare](#deploying-to-cloudflare)
    - [First-time setup](#first-time-setup)
    - [Deploying](#deploying)
    - [Google Calendar](#google-calendar)
    - [Password reset](#password-reset)
    - [Telegram bot](#telegram-bot)
    - [Security](#security)
  - [Testing](#testing)
  - [Roadmap](#roadmap)
    - [Done](#done)
    - [Planned](#planned)
  - [Editor setup](#editor-setup)


## Features

- **Accounts**: sign in at `/login`, or create an account at `/signup` with an email and a password of at least 8 characters. Each account has its own projects, tasks and tags, and starts with the example tags. The header shows who is signed in, with a **Sign out** button. Opening any page while signed out goes to the sign-in page first, then on to that page. **Forgot your password?** on the sign-in page emails a link for choosing a new one (see [Password reset](#password-reset)).
- **Dashboard** of live projects, with **archived projects** in a collapsible section below. When a project's last task is done, it gets the built-in **Archive** tag and moves to that section. Remove the tag in the project's form to bring it back; it stays live until its tasks go from not all done to all done again. Below the projects, **Unassigned** lists every task that isn't in any project (unfinished first, soonest due), each with its check mark, priority, due date and **Edit** button, and its name linking to its page. **Hide done** next to its heading hides the completed ones (and **Show N done** brings them back); this browser remembers the choice.
- **Sort** the projects by delivery date, urgency (most or least urgent first) or % complete, and **filter** them by tag and urgency. The choices are remembered in the browser.
- **Project tiles** show the project's tags, priority, due date, an overdue tag and task progress. Click a tile to expand a preview of its timeline, tasks and reference links, with an **Edit** button on each task. Click a task's check mark to mark it done or not done. Each task's name links to its page, and **View more** opens the project's page. **Expand all** above the list opens every tile at once (and **Collapse all** closes them), and open tiles stay open after a visit to a project's page.
- **Task lookup** in the header, on every page: type part of a task's name (any case) and, once you pause, it lists the matching tasks, unfinished first, with their projects (or **Unassigned**), due date and a **done** mark on completed ones. Choose one to open its page.
- **Calendar** (`/calendar`, linked from **Calendar** in the header, with **Projects** leading back) shows a month of unfinished tasks on their due dates and live projects' delivery dates as flags. Each is a chip in the colour of its tag (a task takes the first tag of the first live project it's in; untagged things are grey), with cream or green text, whichever reads better, and links to its page. A day shows up to three chips, then **+N more** to expand it. Overdue chips get a coral ring, and today a cream ring, as on a project's timeline. **‹**, **Today** and **›** move between months, and the month is kept in the address (`?month=2026-11`), so going back after an edit returns to it and the link can be shared. The week can start on Monday or Sunday (remembered in the browser), and the chips can be filtered by tag. Below the grid, **No due date** opens the tasks that have none. On phones the grid is compact, with a dot per item, and tapping a day lists its tasks below with their check marks, **Edit** buttons and projects. Completed tasks and archived projects aren't shown. It is view-only for now: dates are changed in the forms.
- **Project pages** (`/projects/:id`) use the whole screen for one project: its details and progress, its timeline, every task with its description, and its reference links.
- **Export** on a project's page copies its tasks for sharing. It only reads the project, never changes it, and works entirely in the browser. Choose **Markdown** (a checklist, for notes apps, GitHub and chat apps), **Plain text**, **CSV** (for Excel, Google Sheets or Numbers) or **JSON** (structured data, in the `pam-project-export` format that **Import** reads), and whether to include completed tasks (off at first). A preview shows exactly what you'll get; then **Copy** puts it on the clipboard, or **Download** saves it as `<project>-tasks-<date>.<md|txt|csv|json>`. An export has the project's name and delivery date, then each task's name, due date, priority, whether it's done and its description, in the project's order; relations, tags and links are left out. CSV files start with a byte order mark so Excel reads accents and other scripts correctly (copied CSV leaves it out, so it doesn't stick to the first cell when pasted), and any cell starting with `=`, `+`, `-` or `@` gets a `'` in front so a spreadsheet can't run it as a formula.
- **Import** on a project's page reads a JSON export back in, to update the project's tasks: choose the `.json` file, or paste its text. Before anything is saved it lists what the file would do. **New tasks** are added to the end of the project. A file task with the id of one of the project's tasks, or failing that the same name (ignoring case), is a **duplicate**. If its details are identical it's left alone. Otherwise both versions are shown side by side, with only the fields that differ, and you choose **Keep current** or **Use imported** for each (or **Keep all current** / **Use all imported**); **Import** stays off until every duplicate has a choice. Only the exported fields (name, due date, priority, done, description) are imported, so a task keeps its relations and other projects. A task whose id belongs to a task in another project is imported as a separate copy rather than changing that task. Everything is saved in one request under the usual rules, so if any task would be due after the project's delivery date, nothing is saved, and the dialog says which task and keeps your choices. Fields a hand-written file leaves out get a new task's defaults; anything malformed is refused with the task's number and what's wrong.
- **Task pages** (`/tasks/:id`) show a task's status, priority, due date and description, the projects it is in, and its related tasks. Relations are shown from both sides, so if A blocks B, B's page says it is blocked by A.
- **Projects** have a name, description, delivery date, priority, any number of tags, tasks and reference links.
- **Taskbar** hidden on the left edge of the screen. Hover over it to slide it out over the page, with buttons for **Tags**, **Add task** and **Add project**. On phones and other touch screens these are behind a **+** button in the bottom-right corner instead.
- **Upcoming tasks** in a section at the top of the dashboard, above the projects. It lists every unfinished task that is overdue or due in the next 14 days, from all projects, soonest first, with each task's projects, check mark and **Edit** button. Tasks with no due date, or only in archived projects, are left out. **Show fewer** collapses the section to its first two tasks (and **Show all** expands it again); the browser remembers which. Once the section scrolls out of view, a coral **overdue** counter floats in the top-right corner; click it to scroll back up to it.
- **Suggested**: the **By date / Suggested** switch on **Upcoming** (remembered in the browser) swaps the list by date for every open task ranked by what to do next (see [docs/priority-algorithm.md](docs/priority-algorithm.md)), under **Overdue**, **Do nowww** and **Do next**:
  - Each row says why it's there, such as *Due tomorrow*, *Unblocks 6 h of work* or *"Review" goes critical in 2 days unless this is done*. Rows are marked **pinned**, **no estimate** (counted as 2 hours) or **in a loop** (part of a loop of blocking tasks).
  - Tasks waiting on another task, or with a start date still to come, are left out, and a line under the list counts them. Do next shows its first 10, with **Show N more** for the rest.
  - Quick actions on each row:
    - **Do today** pins the task to today, moving it to the end of Do nowww, and **Unpin** undoes that.
    - **Not today** starts it tomorrow. It's greyed out, with the reason beside it, on a task due today or overdue.
    - **Priority ↑ / ↓** moves its priority one level.
    - The **estimate** button edits the estimate in place, in hours, or clears it when left blank.
  - Each action is its own small request, never a whole task save, so it changes only what it names.
  - Completed tasks, tasks only in archived projects, and Google Calendar events without an estimate aren't ranked.
- **Workload** above **Upcoming** forecasts how the open work plays out. It walks forward from today and fills each day's hours with tasks in Suggested order, skipping tasks not started yet or still waiting on another task.
  - **Brief:** a short summary, for example: *Today: 3 tasks, 7.5 h of 8 h. "Thesis" is tight. 1 of the next 14 days is overbooked. Of 20 h of open work, 4 h come from the 2-hour default for tasks with no estimate, and 6 h have no deadline. All of it is done by 2026-12-04.* It always says how much of the forecast is guesswork.
  - **Seven days:** each day's hours planned out of the hours there are. A day is marked **over** (coral) when more work is due by its end than there's time for from today.
  - **Project tiles** get a pace badge: **On pace** (2 or more working days to spare), **Tight** (finishing on the delivery day or the working day before) or **Behind** (finishing after it). Hover over it for the projected finish. Projects with no delivery date get none.
  - Nothing is stored: it's worked out again from the current tasks whenever they change.
- **Settings** (`/settings`, linked beside the account in the header):
  - the hours for tasks on each weekday;
  - the **buffer** every estimate is multiplied by;
  - how Suggested weighs tasks: **Balanced**, **Deadline-driven**, **Importance-driven** or **Blockers-first**.

  Any change shows a preview before **Apply** saves it: the Suggested list in its new order with the rows that would move marked, and the projects whose pace or projected finish would change. **Cancel** discards it. If the settings can't be loaded, the page says so and won't save over them.

  Below them, a **Telegram** section links a Telegram chat to the account, once the bot is set up (see [Telegram bot](#telegram-bot); without it the section is hidden). **Connect** shows a one-time code and an **Open Telegram** link that sends it to the bot; the code works once, for 10 minutes. Once linked, it shows the morning brief's time (07:30 at first), the time zone (the browser's when connecting, with **Use it** when the browser is in another), an on/off switch for the brief, and **Disconnect**. These save with their own **Save**, apart from **Apply**.
- **Telegram companion bot** (being built in stages, see [docs/telegram-bot.md](docs/telegram-bot.md)): so far, linking a chat from the settings page. A link replaces any chat the account had, and any account the chat had. Disconnecting tells the chat it's no longer linked. Every other message from a chat that isn't linked is ignored.
- **Works on phones**: each form has its own address (such as `/projects/new` or `/tags`), so the back button or gesture closes it, and the forms keep Save and Cancel pinned to the bottom of the screen.
- **Tags** such as School, Work and Personal file projects by area of life. Add, rename, recolour and delete them from **Tags** in the taskbar. Each tag shows its colour beside a **Choose colour** button, which opens the browser's colour picker: any colour can be chosen, and it fills the tag's badges and filter chip, with cream or green text, whichever is easier to read on it. Tags start indigo. Renaming a tag renames it on every project, and deleting one removes it from its projects. The Archive tag can be renamed but not deleted.
- **Google Calendar import**: **Sync Google Calendar**, under **Unassigned** on the dashboard, imports the events of every calendar shown in your Google Calendar, from now to a year ahead, as unassigned tasks. Each one has a tag with the Google account's email. A task is due the day its event starts. An event that ends on a later day starts its description with **Ends** and that day, followed by the event's own description (Google's HTML turned into plain text). Repeating events become one task per occurrence. Cancelled events and working locations ("Home", "Office") are left out. The first time, the button sends you to Google to connect an account, then comes back and syncs. **Google accounts** beside it lists the connected accounts, each with **Disconnect**, and connects more. Syncing again updates each task's name, due date and description from its event, keeping the done mark, priority, relations, projects, estimate and start and pinned dates set in Pam. It adds new events and deletes the tasks whose events were deleted. A task in a project keeps its due date when its event moves past the project's delivery date, and the sync says so. The import is one-way: changes made in Pam are not sent to Google, and the next sync replaces an imported task's name, due date and description, which the task's form and page point out. A task deleted in Pam comes back at the next sync if its event still exists.
- **Tasks** have a name, description, due date, priority, completed flag and relations to other tasks (blocks, blocked by, subtask of, parent of, related to). A task can be assigned to several projects, from either the project form or the task form. A task can't be due after the delivery date of a project it's in: once both dates are set, either form points out the clash, offers to extend the project's deadline or move the task's due date, and won't add the task or save until it's fixed.
- **Estimates and start dates** (the first step towards suggesting what to do next, see [docs/priority-algorithm.md](docs/priority-algorithm.md)): the task form has an optional **Estimate (hours)**, decimals allowed and saved to the minute, and an optional **Start date**, which can't be after the due date. When the estimate is more than the working time from the start date (or today, if that's later) to the due date, the form says how much time there is, but still saves. Working time comes from each weekday's capacity in the account's settings: 8 hours Monday to Friday and none at the weekend until changed (changed on the **Settings** page). Moving a due date from the project form, an import or a Google Calendar sync moves a start date it passes back to the new due date, since those don't show start dates.
- **Blocking loops are refused**: a task can't end up blocking itself through other tasks (A blocks B, B blocks C, C blocks A), whichever task each relation was added to. The task form names the tasks in the loop and won't save until a relation is removed, and the API refuses such a save with `400`. Loops saved before this check don't stop saves that leave them as they are.

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
    upcomingPanel.vue the upcoming tasks section above the projects, its By date / Suggested switch, and the overdue counter that floats once it scrolls away
    suggestedList.vue the Suggested view: ranked tasks with their reasons, markers and quick actions
    forecastStrip.vue the workload above Upcoming: the forecast's brief and the next seven days
    settings.vue      the settings page: hours per weekday, buffer and presets, with a preview before Apply
    telegramSettings.vue  the settings page's Telegram section: Connect, the brief's time and time zone, Disconnect
    projectTile.vue   one project on the dashboard; expands into a preview
    projectExport.vue the Export button and dialog on a project's page: format, preview, Copy and Download
    projectImport.vue the Import button and dialog on a project's page: the file, new tasks, and a choice per duplicate
    project.vue       create/edit a project
    task.vue          create/edit a task, including which projects it is in, its estimate and start date
    tags.vue          add, rename, recolour and delete tags
    googleSync.vue    the Sync Google Calendar button, what the last sync did, and the connected accounts
    login.vue         the sign-in and sign-up pages
    forgotPassword.vue  the page that emails a reset link (/forgot-password)
    resetPassword.vue   the page reset emails link to, for choosing a new password (/reset-password)
  router/             one route per form, the settings page and the calendar, all showing the dashboard, so back closes forms
  stores/             Pinia stores for projects, tasks, tags, settings and the signed-in account; they load and save through the API
  types/              Project, Task and Tag models, shared by the app and the Worker, which tasks are upcoming,
                      the calendar's items, dates and month grid (calendar.ts), the export formats (export.ts), reading and matching imports (import.ts),
                      what the Google Calendar routes answer (google.ts), the change tracking log (events.ts),
                      each account's capacity and prioritisation weights (settings.ts), and the scoring that
                      ranks open tasks into Overdue, Do nowww and Do next (priority.ts), and the workload
                      forecast built on it (forecast.ts), what a settings change would change (settingsPreview.ts),
                      and the sentence type every reason, brief and refusal uses (sentence.ts), and what the
                      Telegram routes answer and their limits (telegram.ts)
  api.ts              client for the Worker API, including signing in
  __tests__/          unit tests
worker/
  index.ts            the /api routes, reading and writing the signed-in user's rows in D1
  auth.ts             the /api/auth routes: accounts, passwords, sessions and password reset
  email.ts            sending email through Cloudflare Email Service
  google.ts           the /api/google routes: connecting Google accounts and syncing their events into tasks
  events.ts           writing change tracking events, and the GET /api/events route
  settings.ts         the /api/settings routes: reading and saving settings, preset changes and the preview
  jsonChunks.ts       passing many rows to D1 in a few statements, as JSON
  googleCalendar.ts   Google's OAuth and Calendar API: tokens, the calendar list, batched event lists,
                      and what a task takes from an event
  pamBot/             the Telegram companion bot: its routes and webhook (index.ts), the Bot API called with
                      fetch (botApi.ts), the linked chats and link codes in D1 (links.ts), and what it says
                      (messages.ts, pure)
  secrets.d.ts        types for the Worker's secrets and settings
  migrate.ts          applies migrations/ to the database on the Worker's first request
  __tests__/          integration tests for the API and database
cypress/
  e2e/                end-to-end tests
  support/            commands and builders for test data
migrations/           SQL that creates the database tables
docs/                 designs for features being built, such as task prioritisation (priority-algorithm.md)
                      and the Telegram companion bot (telegram-bot.md)
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
- **Quick actions** (`planTaskAction`): each changes one thing about a stored task, then goes through the same steps as a task save.
- **Membership**: a task save can say which projects the task is in (`projectIds`); the Worker adds it to or removes it from each project. A project save's `taskIds` is its membership.
- **Blocking loops**: a save whose relations would make a loop of blocking tasks is refused with `400`, naming the tasks (`findBlockCycle` in `src/types/rules.ts`). Only loops the save makes count, so ones already stored don't block other saves.
- **Start dates**: a project save's `dueDates` and an import move a task's start date back to its new due date when the due date moves before it (`clampStartDate`), as the Google Calendar sync does too. A task save with a start date after its due date is refused with `400` instead, since the task form shows both.
- **Date clashes**: a save that would make a task due after the delivery date of one of its projects is refused with `409` and the clashes, and nothing is written. The forms offer to move the dates first, and send the moves with the save (`deliveryDates` on a task save, `dueDates` on a project save) so they're checked and written together. Clashes already in the stored data don't block a save that doesn't touch them.

The reply lists every task and project the save changed, and `applyChanges` (`src/stores/changes.ts`) puts each one into the stores, replacing the item with the same id or adding it.

### Accounts

- **Passwords** are stored only as salted PBKDF2-SHA256 hashes (100,000 iterations, the most the Workers runtime allows).
- **Signing in** sets a `pam_session` cookie holding a random token, valid for 30 days. The cookie is `HttpOnly` (scripts can't read it), `SameSite=Lax`, `Secure` over https, and only sent to `/api`. D1 stores only the token's SHA-256 hash. Signing out deletes the session, and reloads the page so nothing of the account stays in memory.
- **Wrong passwords**: a wrong password and an unknown email get the same answer. After 10 failed sign-ins for one email within 15 minutes, that email can't sign in until the failures are 15 minutes old.
- **Separate data**: every route except `/api/auth/*` answers `401` without a valid session. Every table has a `user_id`, which comes from the session, never from the request. Ids are only unique within an account, so two accounts can use the same id without touching each other's rows, and a project can only list its own account's tasks and tags.
- **Data from before accounts** (migration `0004`) belongs to the first account that signs up.
- **Password reset** follows OWASP's [Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html):
  - Asking for a link (`/forgot-password`) gets the same answer, in the same time, whether or not the email has an account. The answer depends only on the email typed: looking up the account, making the link and emailing it happen after the response is sent (`waitUntil`).
  - Each email can ask for 3 links an hour, counted whether or not it has an account, so no one can flood an inbox and the limit gives nothing away. Asking doesn't change or lock the account.
  - The link holds a random 256-bit token. D1 stores only its SHA-256 hash (`password_resets`). It works once, for 30 minutes, and asking for another replaces it.
  - The link is built from `APP_ORIGIN`, never from the request's `Host` header, which a request could set to another site.
  - The reset page (`/reset-password`) takes the token out of the address bar as soon as it opens, and sends no `Referer` (`public/_headers`, and a `<meta name="referrer">`), so the token doesn't leak to history or to other sites. It opens whether or not the browser is signed in.
  - The new password is typed twice and follows the sign-up rules. Saving it signs every device out, deletes the account's other links, lifts any lock from failed sign-ins, and emails a notice that the password changed. It doesn't sign in: the page reloads at the sign-in page to sign in with the new password.
- **Not built yet**: changing a password while signed in.

### API

| Request | Result |
|---|---|
| `POST /api/auth/signup` | Create an account from `{ email, password }` and sign in; returns `{ email }` |
| `POST /api/auth/login` | Sign in with `{ email, password }`; returns `{ email }` (`401` if wrong, `429` once locked) |
| `POST /api/auth/logout` | Sign out |
| `GET /api/auth/me` | `{ email }` of the signed-in account, or `401` |
| `POST /api/auth/forgot` | Email a reset link for `{ email }` if it has an account; `204` either way (`429` after 3 requests for the email within an hour, `503` until password reset is set up) |
| `POST /api/auth/reset` | Set the password from a reset link's `{ token, password }`, signing out every device; `204`, or `400` if the link expired or was used |
| `GET /api/projects` | All projects |
| `PUT /api/projects/:id` | Create or update the project from `{ project, dueDates? }`; returns the changed `{ tasks, projects }` (`409` for a date clash) |
| `DELETE /api/projects/:id` | Delete the project |
| `POST /api/projects/:id/import` | Create or update each task in `{ tasks }` and add the new ones to the end of the project, all in one transaction; returns the changed `{ tasks, projects }` (`409` for a date clash, which saves none of them) |
| `GET /api/tasks` | All tasks |
| `PUT /api/tasks/:id` | Create or update the task from `{ task, projectIds?, deliveryDates? }`; returns the changed `{ tasks, projects }` (`409` for a date clash, `400` with the task ids as `loop` for a blocking loop) |
| `PATCH /api/tasks/:id` | Change only the fields in `{ task, projectIds?, deliveryDates? }`, where `task` holds any of `name`, `description`, `dueDate`, `relations`, `priority`, `completed`, `effortMinutes`, `startDate` and `pinnedDate` (`TaskPatch` in `src/types/operations.ts`). A field left out keeps its value; `null` clears `dueDate`, `effortMinutes`, `startDate` or `pinnedDate`. The task is then checked and saved as a `PUT` would be. Returns the changed `{ tasks, projects }` (`400` for an unknown or invalid field, `404` for an unknown task, `409` for a date clash) |
| `POST /api/tasks/:id/action` | Do one quick action (`TaskAction` in `src/types/operations.ts`) and nothing else: `{ action: 'do_today', today }`, `{ action: 'unpin' }`, `{ action: 'not_today', today }`, `{ action: 'importance', direction: 'up' \| 'down' }` or `{ action: 'estimate', effortMinutes }` (`null` clears it). `today` is the user's local date. Returns the changed `{ tasks, projects }`; `400` if the action can't be done, with `code` (`due_today`, `overdue`, `priority_at_top` or `priority_at_bottom`), `params` and `text` besides `error`, or is malformed; `404` for an unknown task |
| `DELETE /api/tasks/:id` | Delete the task, removing it from projects and relations |
| `GET /api/tags` | All tags, by name |
| `PUT /api/tags/:id` | Create, rename or recolour the tag in the body; returns it. `color` is a `#rrggbb` code (stored in lower case); leaving it out keeps an existing tag's colour, or makes a new one indigo |
| `DELETE /api/tags/:id` | Delete the tag, removing it from its projects (`400` for the built-in `archive` tag) |
| `GET /api/google/connect` | Redirect to Google to connect an account |
| `GET /api/google/callback` | Where Google redirects back to: saves the account, then redirects to `/?google=connected` (or `/?google=error&message=…`) |
| `GET /api/google/accounts` | The connected Google accounts, `{ email, syncedAt }` |
| `DELETE /api/google/accounts/:email` | Disconnect the account, revoking Pam's access at Google; its tasks stay |
| `POST /api/google/sync` | Import every connected account's events; returns a `SyncResult` per account (`src/types/google.ts`), or `[]` when none is connected. `503` until the Google secrets are set |
| `GET /api/settings` | The account's `UserSettings` (`src/types/settings.ts`): capacity in minutes per weekday, buffer, weights and preset. The defaults until the account saves its own |
| `PUT /api/settings` | Save the whole `UserSettings` in the body; returns them as stored. `wU`, `k` and `horizonDays` must be the named preset's (`400` otherwise) |
| `POST /api/settings/preset` | Switch to `{ preset }`, setting its weights and keeping the capacity and buffer; returns the settings |
| `POST /api/settings/preview` | What `{ today, preset?, capacityMinutes?, buffer? }` would change, saving nothing: a `SettingsPreview` (`src/types/settingsPreview.ts`) with the new Suggested order, the projects whose pace or finish would move, and a `summary` in sentences |
| `GET /api/priorities?today=YYYY-MM-DD` | Exactly what `prioritise` (`src/types/priority.ts`) returns for the account's tasks, projects and settings: every open task's category, tier, score, factors and reason, and the Overdue, Do nowww and Do next lists (`400` without a `today`) |
| `GET /api/forecast?today=YYYY-MM-DD` | Exactly what `forecast` (`src/types/forecast.ts`) returns: each task's and project's projected finish and pace, 14 days of load, today's plan, the totals and the brief (`400` without a `today`) |
| `GET /api/telegram` | Whether a Telegram chat is linked (`TelegramStatus` in `src/types/telegram.ts`): `{ linked: false, botUsername }`, or with the chat's `timeZone`, `briefMinutes` (minutes after local midnight), `enabled` and `linkedAt`. Every `/api/telegram` route answers `404` until the bot is set up |
| `POST /api/telegram/link-code` | A one-time code for linking a chat, from `{ timeZone }` (an IANA name, used for the brief once linked): `{ code, url, expiresAt }`, where `url` is `https://t.me/<bot>?start=<code>`. It works once, for 10 minutes, and replaces the account's earlier code |
| `PUT /api/telegram` | Save `{ timeZone, briefMinutes, enabled }` for the linked chat; returns the status (`400` if malformed, `409` with no chat linked) |
| `DELETE /api/telegram` | Unlink the chat, telling it so; `204` |
| `POST /api/telegram/webhook` | Where Telegram sends the bot's updates. No session: it needs the `X-Telegram-Bot-Api-Secret-Token` header to be `TELEGRAM_WEBHOOK_SECRET` (`401` otherwise), and answers `200` to everything else, even when an update can't be handled |
| `GET /api/events?projectId=&since=` | The account's change tracking events (`LoggedEvent` in `src/types/events.ts`), oldest first. `projectId` keeps one project's events; `since` (a `YYYY-MM-DD` date or a UTC timestamp) keeps those at or after it. Both are optional (`400` if malformed) |

Tasks imported from Google Calendar have `googleAccount`, the account's email. Only the sync sets it: a task save keeps the stored one, whatever the body says.

A task's `effortMinutes` (a whole number of minutes, 1 to 60,000), `startDate` and `pinnedDate` are only in the JSON when set. A `PUT` that leaves one out, or sends it as `null`, clears it; to change some fields and keep the rest, use `PATCH`. The app ticks tasks off with `PATCH`, sending only `completed`.

#### For a voice front-end

A small on-device model is planned to turn speech into a fixed set of requests and read the answers out. The model never ranks tasks or words numbers itself, since everything it needs comes back from the shared functions, finished:

- **Questions**:
  - "What should I do next?" reads `GET /api/priorities`: `sections` in order, with each task's `reason.text`.
  - "Why is this here?" reads that task's `reason` and `factors`.
  - "How does my week look?" reads `GET /api/forecast`, whose `brief.text` is ready to say, and whose `brief.parts` let it pick sentences.
- **Commands**:
  - The quick actions (`POST /api/tasks/:id/action`) and partial updates (`PATCH /api/tasks/:id`).
  - A preset change (`POST /api/settings/preset`). It's confirmed first by reading `summary.text` from `POST /api/settings/preview`.
- **`today`**: every request that depends on it takes it from the device, which knows the user's local date.
- **Sentences**: every reason, brief, summary and refusal is a `code` with its `params` and a finished `text`.

Not solved by this API: matching a spoken phrase to the right task.

The project, task, tag and Google routes work on the signed-in account's data only. Bodies are the `Project`, `Task` and `Tag` objects from `src/types`, sent as `application/json`. The Worker checks every field and answers `400` with an error message if something is invalid, including a reference to a task or tag that doesn't exist, or a tag name that another tag already has. Each save runs as one transaction, so a failed save changes nothing.

The limits in `src/types/limits.ts` apply to the forms and the API alike: names and link labels up to 200 characters, descriptions up to 10,000, ids up to 100, link URLs up to 2,000, up to 500 tasks, tags, links or relations on one item, estimates up to 1,000 hours, emails up to 254, and passwords from 8 to 256. Reference links must start with `http:`, `https:` or `mailto:`, so a `javascript:` link can't run code in the app when clicked. Settings are checked too: each weekday's capacity is 0 to 1,440 minutes, with at least one day above 0; the buffer is 0.5 to 5; `wU` and `k` are 0 to 10; the horizon is 1 to 10 working days; and the preset is `balanced`, `deadline`, `importance` or `blockers`. Every value reaches D1 as a bound parameter, never as part of the SQL.

A bare `Task` or `Project` body, as clients from before the scheduling rules sent, is refused with `400` and nothing is saved: task saves must be wrapped as `{ task, … }` and project saves as `{ project, … }`.

### Schema

Defined in the files in `migrations/`. Each field has its own column, and each array is stored in its own table with a `position` column that keeps its order. Every data table starts with `user_id`, and its keys include it: a project is keyed by `(user_id, id)`, and `project_tasks` refers to `tasks` by `(user_id, task_id)`, so a row can only ever point at rows of the same account.

| Table | Holds | Columns |
|---|---|---|
| `users` | Accounts | `id`, `email` (unique, ignoring case), `password_hash`, `created_at` |
| `sessions` | Signed-in browsers | `id` (SHA-256 of the cookie's token), `user_id` → `users`, `expires_at`, `created_at` |
| `login_failures` | Failed sign-ins | `email`, `at` |
| `projects` | `Project` | `user_id` → `users`, `id`, `name`, `description`, `delivery_date`, `priority`, `created_at`, `updated_at` |
| `tasks` | `Task` | `user_id` → `users`, `id`, `name`, `description`, `due_date`, `priority`, `completed`, `effort_minutes`, `start_date`, `pinned_date`, `created_at`, `updated_at` |
| `project_tasks` | `Project.taskIds` | `user_id`, `project_id` → `projects`, `task_id` → `tasks`, `position` |
| `project_links` | `Project.links` | `user_id`, `project_id` → `projects`, `position`, `label`, `url` |
| `project_tags` | `Project.tagIds` | `user_id`, `project_id` → `projects`, `tag_id` → `tags`, `position` |
| `task_relations` | `Task.relations` | `user_id`, `task_id` → `tasks`, `related_task_id` → `tasks`, `type`, `position` |
| `tags` | `Tag` | `user_id` → `users`, `id`, `name`, `color`, `created_at`, `updated_at` |
| `google_accounts` | Connected Google accounts | `user_id` → `users`, `email`, `refresh_token`, `synced_at`, `created_at` |
| `google_auth_states` | Connections to Google not back yet | `id` (the OAuth state), `user_id` → `users`, `code_verifier` (PKCE), `expires_at` |
| `google_events` | `Task.googleAccount`, and the event each imported task came from | `user_id`, `task_id` → `tasks`, `account_email`, `calendar_id`, `event_id`, `starts_at`, `ends_at` |
| `user_settings` | `UserSettings`, one row per account, written by its first `PUT /api/settings` | `user_id` → `users`, `capacity_mon` … `capacity_sun` (minutes), `buffer`, `w_u`, `k`, `horizon_days`, `preset`, `updated_at` |
| `telegram_links` | Telegram chats linked to accounts, at most one each way | `user_id` → `users` (key), `chat_id` (unique), `time_zone`, `brief_minutes` (default 450, 07:30), `enabled`, `last_brief_date`, `last_added_task_id`, `last_update_id`, `linked_at` |
| `telegram_link_codes` | Codes for linking a chat, not used yet | `id` (SHA-256 of the code), `user_id` → `users`, `time_zone`, `expires_at` |
| `task_events` | The change tracking log (see below), append-only | `user_id` → `users`, `id` (increasing), `at`, `kind`, `task_id`, `project_id`, `old_value`, `new_value`, `delivery_date_at_time`, `source`, `task_source` |

- `project_tasks` links projects to tasks. A task can be in several projects.
- All foreign keys cascade on delete. `task_events` has none to `tasks` or `projects`, so events outlive what they're about, but deleting a user deletes their events. Deleting a task removes it from its projects and from other tasks' relations, deleting a project removes its links and tags, deleting a tag removes it from its projects, and deleting a user removes their sessions and all of their data.
- Tag names are unique within an account, ignoring case. A new account starts with the tags School, Work and Personal, plus the built-in Archive tag (id `archive`).
- `CHECK` constraints limit `priority` to `low`, `medium`, `high` or `urgent`; relation `type` to `blocks`, `blocked_by`, `subtask_of`, `parent_of` or `related_to`; and `completed` to `0` or `1`. `effort_minutes` must be above 0, and `start_date` can't be after `due_date`. In `user_settings`, each capacity is 0 to 1,440, `buffer` above 0, `w_u` and `k` at least 0, `horizon_days` above 0, and `preset` one of `balanced`, `deadline`, `importance` or `blockers`. In `telegram_links`, `brief_minutes` is 0 to 1,439 and `enabled` `0` or `1`. `task_events.source` is `app`, `google`, `telegram` or `backfill`.
- Scores and forecasts worked out from estimates, dates and settings are never stored.
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
- `source` says who made the change: `app`, `google` (a sync), `telegram` (the Telegram bot) or `backfill`. Migration `0010` rebuilt the table to allow `telegram`, keeping every event and its id. `task_source` says where the task came from (`app` or `google`), so adding an imported task to a project is `source = 'app'`, `task_source = 'google'`.
- Events are worked out from the data before and after a save, by `diffEvents` in `src/types/events.ts`, which the Worker and the fake API both run. Membership comes from each project's tasks before and after, whichever form changed it.
- Events are written in the same batch as the change, so a refused (`409`) or failed save logs nothing. Only real changes are logged: a save that changes nothing logs nothing.

**What isn't logged:** names, descriptions, priorities, estimates, start and pinned dates, relations, links, tags (including the Archive tag a completed project gets), the order of a project's tasks, and a sync's name or description updates. Nor is a sync's due date that stays put because of a clash.

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

### Password reset

Reset emails go out through [Cloudflare Email Service](https://developers.cloudflare.com/email-service/), from the `EMAIL` binding in `wrangler.jsonc`. Until it is set up, `POST /api/auth/forgot` and `/api/auth/reset` answer `503`.

1. In the Cloudflare dashboard, set up a domain on your account for sending email (Email Service → onboard the domain), which adds the DNS records that let other mail servers trust its emails.
2. Give the Worker two settings:
   - `APP_ORIGIN`: where Pam is served, such as `https://pam.example.com`. Reset links point here.
   - `EMAIL_FROM`: the address emails come from, on that domain, such as `pam@example.com`.

   For `pnpm dev`, put them in `.dev.vars` (with `APP_ORIGIN=http://localhost:5173`). Nothing is sent under `pnpm dev`: Wrangler prints each email, link included, to the terminal. For deploys, set them with `pnpm exec wrangler secret put APP_ORIGIN`, then the same for `EMAIL_FROM`. A reset link always points at `APP_ORIGIN`, whichever address the request came to, so a Preview deploy's links open the live site unless that deploy is given its own `APP_ORIGIN`.

### Telegram bot

The companion bot ([docs/telegram-bot.md](docs/telegram-bot.md)) runs inside the same Worker, at `/api/telegram/webhook`. It is off until all of `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_USERNAME` and `APP_ORIGIN` are set: until then every `/api/telegram` route answers `404`, and the settings page hides its section.

1. **Create the bot.** In Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot`, and choose a name and a username ending in `bot`. BotFather replies with the bot's token. Anyone with the token can act as the bot, so keep it secret.
2. **Make a webhook secret**: 1 to 256 of `A-Z`, `a-z`, `0-9`, `_` and `-`, for example from `openssl rand -hex 32`. Telegram sends it back with every update, and the Worker refuses requests without it.
3. **Give the Worker the settings** (`APP_ORIGIN` too, if it isn't set yet; links to Pam's pages are built from it):
   ```sh
   pnpm exec wrangler secret put TELEGRAM_BOT_TOKEN
   pnpm exec wrangler secret put TELEGRAM_WEBHOOK_SECRET
   pnpm exec wrangler secret put TELEGRAM_BOT_USERNAME   # without the @
   ```
   Don't add them to the Previews base configuration: Preview deploys have their own database, and a second Worker receiving the same bot's updates would answer chats it can't see. For `pnpm dev`, they can go in `.dev.vars`, but Telegram can only reach a public https address, so linking a chat needs a deploy (or a tunnel to the dev server).
4. **Point Telegram at the Worker** once it's deployed, with only the updates the bot handles:
   ```sh
   curl "https://api.telegram.org/bot<token>/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url": "https://<your domain>/api/telegram/webhook", "secret_token": "<webhook secret>", "allowed_updates": ["message", "callback_query"]}'
   ```
   It answers `{"ok":true,"result":true,...}`. `getWebhookInfo` (`https://api.telegram.org/bot<token>/getWebhookInfo`) shows the address and the last delivery error, if any.

How it works:

- **Linking.** **Connect** on the settings page asks for a code: 128 random bits as hex. D1 stores only its SHA-256 hash, with the browser's time zone, for 10 minutes. The **Open Telegram** link (`https://t.me/<bot>?start=<code>`) opens the bot, which receives `/start <code>`. The code is deleted by the same statement that finds it, so it links one chat at most.
- **Updates.** Only private chats are answered. Each chat's `last_update_id` is checked and set in one statement, so an update Telegram sends again is skipped. Anything that goes wrong while handling an update is logged, and still answered with `200`, so Telegram doesn't keep sending it.
- **Messages** are plain text, with no `parse_mode`, so nothing in a task's name can format or break one. The token is part of every Bot API URL, so neither the URL nor anything `fetch` throws is logged: errors name only the method and Telegram's description.

### Security

Pam has its own accounts (see [Accounts](#accounts)), and anyone who can reach it can create one. To choose who can reach it, put the Worker behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/) and allow only the emails you want. You can enable it from the Worker's Settings → Domains & Routes in the dashboard. Access only covers the hostnames you add to it, so also turn off the `workers.dev` route and Preview URLs (or add them to Access), or they stay open to everyone.

## Testing

There are three layers of tests:

| Layer | Command | Where | What it covers |
|---|---|---|---|
| Unit | `pnpm test:unit` | `src/__tests__/` | Components, stores, models and the API client in a simulated browser (jsdom). `fetch` is replaced by an in-memory fake API (`fakeApi.ts`), so no server or database is needed. |
| Integration | `pnpm test:integration` | `worker/__tests__/` | The Worker API inside the real Workers runtime, against a real D1 database built from `migrations/`. Covers signing up and in, sessions, keeping accounts' data apart, routing, saving and reading every field, tags, settings, estimates and start dates, blocking loops, migrations, validation, transactions, cascading deletes, the schema's constraints and change tracking. The Google Calendar import runs against a fake Google that stands in for `fetch` (`google.spec.ts`), and the Telegram bot against a fake Bot API (`telegram.spec.ts`); what the bot says is unit-tested in `telegramMessages.spec.ts`. The database is emptied before every test. |
| End-to-end | `pnpm test:e2e` | `cypress/e2e/` | The production build in a real browser (Cypress), with the Worker and a local D1 database. Covers creating and editing projects and tasks, managing tags, the tile preview, sorting, the calendar, Suggested with its quick actions, the workload and the settings page (on a wide screen and a phone), and how errors are shown. |

`pnpm test` runs the unit and integration tests together.

End-to-end tests use their own database in `.wrangler/e2e-state`, so they never touch the data you use with `pnpm dev`. Each test signs in to a test account (`e2e@example.com`, created the first time), clears its data and adds the data it needs through the API, using the commands in `cypress/support/commands.ts`. `pnpm test:e2e` builds the app first. `pnpm test:e2e:dev` opens the Cypress app against the dev server instead, which is quicker for writing tests.

If Cypress fails to start with `bad option: --smoke-test`, the `ELECTRON_RUN_AS_NODE` environment variable is set. Some editor extensions set it for the processes they start. Unset it, or run the tests from a normal terminal.

## Roadmap

### Done

Built so far, oldest first. [Features](#features) describes each in full.

- **Foundations** (October 2026): the Vue app on one Cloudflare Worker with a D1 database, deployed from Git, with unit, integration and end-to-end tests. Projects and tasks with priorities, due and delivery dates, and relations between tasks.
- **Organising projects**: tags, the taskbar, sorting and filtering the project list, editing tasks from a project.
- **Seeing progress**: the project timeline, project and task pages, **Expand all**, ticking tasks off without opening a form, the Archive tag for completed projects, and the **Upcoming tasks** section.
- **Scheduling rules**: a task can't be due after a project's delivery date. Since then the Worker enforces this along with membership and archiving, using planners in `src/types/operations.ts` that it shares with the test fake. Each save is one request and one transaction.
- **Accounts and security**: email and password accounts, each with its own data (data from before accounts moved to the first account to sign up), and bound parameters for every query.
- **Calendar and lookup**: the month calendar, task lookup in the header, the **Unassigned** section, and tag colours of your own choosing.
- **Export**: a project's tasks as Markdown, plain text, CSV or JSON.
- **Google Calendar import**: events become tasks, one way, synced from the taskbar or under **Unassigned**.
- **Change tracking**: every save logs what it changed to `task_events`, ready for analytics (see [Change tracking](#change-tracking)).
- **November 2026**: bigger check marks, hiding completed unassigned tasks, deleting a task without completing it, password reset by email, and **Import**, which reads a JSON export back into a project and asks which version to keep of each duplicate task.

### Planned

Not built yet:

- Task list view
- Project list view, including completed projects
- Messages
- More settings and a profile (the calendar's week start would move to the settings page from the browser's storage), including changing your password while signed in
- **Rescheduling from the calendar**: drag a chip to another day on wide screens; on phones (where drag and drop doesn't work) tap it, then **Move to…** with a date picker. Dragging a task from **No due date** onto a day gives it that date. Saves through `taskList.saveTask` or `projectList.saveProject`, showing the move straight away and undoing it if the save fails. Items already carry `editable` (false for now) to decide what can be moved. A move that clashes with a delivery date comes back from the Worker as a `409`, and should offer the same clash fixes the forms do.
- **Google Calendar, both ways**: events are imported as tasks one way (see [Google Calendar](#google-calendar)). Still to do: send changes made in Pam back to Google, using the event's etag and update time to detect conflicting edits, and show events on the calendar without making them tasks, through a third adapter beside `taskToItems` and `projectToItems` in `src/types/calendar.ts`. That adapter already asks for items by date range (as Google's API does), keeps a loading and error state per source, places timed events after all-day ones, and has room for time zones and Google's exclusive end dates on all-day events. Syncing on a schedule (a Cron Trigger) rather than by button would also fit here.
- **Logo**: a logo for Pam, to make it look the part.
- **Prioritisation and workload forecast**, in stages ([docs/priority-algorithm.md](docs/priority-algorithm.md)). Built in five stages: estimates, start dates and pinned dates; refusing blocking loops; the scoring (`prioritise` in `src/types/priority.ts`); the Suggested view of Upcoming with quick actions; the settings page with presets; the workload forecast with project pace badges; and the API for a voice front-end. Still to do: the voice front-end itself (see the LLM layer below).
- **Telegram companion bot**, in stages ([docs/telegram-bot.md](docs/telegram-bot.md)): linking a chat from the settings page is built. Still to do: the morning brief, buttons and commands for the next two tasks, and adding tasks from the chat.
- **LLM layer**: summarise what needs doing, quickly pick out the high priority tasks, and explain how tasks relate to each other.
- **Android app**: Pam on Android, for home screen widgets and notifications.
- **Data analytics**: track how Pam is used over time: the rate tasks and projects are created, the rate tasks are completed, and the number of tasks per project. The data is already being logged ([Change tracking](#change-tracking)), and `isPlanned` can tell planned tasks from ones added later. What's left is a view that reads the log through `GET /api/events`.
- **Fuller export and import**: exports leave out relations, tags and links, so an import can't bring them back. Adding them would mean a new export `version`, which Import already checks for.
- **Team Pam**: a collaborative Pam for group projects. Scope out the use cases first.

Maintenance:

- Code review: check there's nothing unnecessary in the code, and that its structure and links between parts make sense
- A second code review, later on

## Editor setup

[VS Code](https://code.visualstudio.com/) with the [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) extension. Type-checking uses `vue-tsc` instead of `tsc`, so `.vue` files are checked too. The [Vue.js devtools](https://devtools.vuejs.org/) panel is built into `pnpm dev`.
