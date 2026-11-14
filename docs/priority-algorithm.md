# Task prioritisation and workload forecast

Implementation spec, 13 Nov 2026. Status: all five stages built (14 Nov 2026), awaiting review; see "Decisions made while implementing".

Implement task prioritisation and a workload forecast in Pam (this repo).
Read README.md first, including the Design section, and follow the existing
conventions. Work in the stages below, one pull request per stage, and stop
after each stage for my review. If anything in this spec is ambiguous or
conflicts with the code, ask me before guessing.

## Ground rules
- All scoring and forecasting logic lives in pure functions in src/types/
  (like rules.ts and upcoming.ts): no Vue, no browser APIs, relative imports
  only, so the Worker can import the same code.
- Deterministic: no randomness and no reading the clock inside these
  functions. `today` (YYYY-MM-DD in the user's local time) is always passed in
  by the caller. Never store computed scores or forecasts.
- All results are plain JSON-serialisable objects.
- No new dependencies. Keep the existing "By date" Upcoming behaviour unchanged.
- Add Vitest specs for every pure function and Worker tests for every new
  validation rule and endpoint. Update README.md (features, schema, API).
- Stage 0: save this whole spec as docs/priority-algorithm.md and commit it.

## Stage 1: data
New migration (next free number in migrations/):
- tasks.effort_minutes  INTEGER, nullable, > 0
- tasks.start_date      TEXT, nullable, must be on or before due_date
- tasks.pinned_date     TEXT, nullable
- user_settings table (one row per user): capacity minutes for each weekday
  (default 480 Mon-Fri, 0 Sat-Sun), buffer (default 1.0), wU (1), k (1),
  horizon in working days (2), preset name ("balanced").
Add the fields to the Task type, limits, Worker validation, GET/PUT
/api/settings, and the task form: "Estimate (hours)" (decimals allowed,
stored as minutes, optional) and "Start date" (optional). Warn in the form,
without blocking, when the estimate exceeds the capacity between start and
due date.

Blocking loops: add findBlockCycle to src/types/rules.ts. Relations are stored
on one task only, so normalise blocks / blocked_by from both sides first. The
Worker and the task form reject a save that creates a loop and name the tasks
in it. Nothing prevents loops today, so existing data may contain them.

## Stage 2: scoring (src/types/priority.ts)
Definitions
- Working day: a day whose capacity is above 0.
- E = effort x buffer, in hours. No estimate: use 2 hours and flag the task
  as unestimated.
- Excluded entirely (not scored, not counted in any total): completed tasks,
  tasks only in archived projects, and Google Calendar imports (googleAccount
  set) that have no estimate.
- Latest start of a task: the latest day from which the capacity up to its
  effective deadline still covers its E.
- Effective deadline: the earliest of (a) its due date, or if it has none,
  the earliest delivery date of its live projects; (b) for each open task it
  blocks, the working day before that task's latest start.
- T = capacity hours from the later of today and start_date, through the
  effective deadline, inclusive.
- d = working days after today up to and including the effective deadline.
- r = E / T. No effective deadline: r = 0 and p = 0.
- R = for each live project with a delivery date, (sum of E of its open
  tasks) / (capacity hours from today through the delivery date), capped at 1.
  Use the largest across the task's projects; 0 if none.
- p = (1 - d / horizon)^2 when d < horizon, otherwise 0.
- Level values: low 0.1, medium 0.4, high 0.7, urgent 1.0.
  importance = projectValue x (0.5 + 0.5 x taskValue). Several projects:
  highest result. No project: use the task's level for both values.
- unlocked = sum of E of every distinct open task reachable through "blocks".
  boost = 1 + k x min(1, unlocked / remaining hours of the task's live
  projects). No project: divide by (own E + unlocked).

Tiers
- Tier 0: own due date is before today, or it blocks a tier 0 task.
- Tier 1: r >= 1, or T is 0, or it blocks a tier 1 task.
- Tier 2: own   = wU x max(r^2, p, R^2) + importance
          base  = largest of own and the base of each open task it blocks
          score = base x boost
Process tasks in reverse dependency order. Ignore the edges of any loop and
flag the tasks in it.

Ordering and categories
- Round scores to 4 decimal places before comparing.
- Tiers 0 and 1: importance descending, then earliest effective deadline,
  then task id. Tier 2: score descending, then least E, then task id.
- Categories: "Overdue" (tier 0); "Do nowww" (tier 1, then tasks whose
  pinned_date is today); "Do next" (the rest of tier 2).
- Scored but hidden from the list: tasks with an open blocker, and tasks
  whose start_date is after today. Return counts of each.
- Parent and subtask estimates are both counted; no special handling.

Output per task: category, tier, score, the factor values (r, p, R,
importance, boost, which urgency term won), flags (unestimated, pinned, in a
loop), a machine-readable reason code with parameters, and a ready-made
English sentence for it, e.g. "Due tomorrow", "Project X is behind pace",
"Unblocks 6 h of work", "Y goes critical in 2 days unless this is done".

## Stage 3: UI
- Upcoming panel: a "By date / Suggested" switch, remembered in the browser.
  Suggested shows the three categories, the reason on each row, a marker on
  pinned and unestimated rows, a line counting hidden blocked and not-started
  tasks, and the first 10 of "Do next" with a show-more control.
- Row quick actions in Suggested: "Do today" (pinned_date = today),
  "Not today" (start_date = tomorrow), importance up / down one level, and
  edit estimate in place.
- Settings: capacity per weekday, buffer, and presets
  Balanced (wU 1, k 1, horizon 2), Deadline-driven (2, 0.5, 3),
  Importance-driven (0.5, 0.5, 1), Blockers-first (1, 2, 2).
  Choosing a preset shows a live preview before saving: the reordered list
  with moved rows marked. Apply saves; Cancel discards.
- Must work on phones as well as desktop.

## Stage 4: forecast (src/types/forecast.ts)
Walk forward day by day from today. Fill each day's capacity with open tasks
in Suggested order (tier 0, tier 1, pinned, then tier 2), skipping tasks that
have not started or still have an open blocker on that day. A task may span
days. Return: each task's projected finish; per project, projected finish
against delivery date as On pace / Tight / Behind; per day for 14 days, hours
committed against capacity; today's plan; total hours that come from the
2-hour default; total hours with no deadline; and a short brief as both
structured data and a ready-made sentence.
UI: the brief and a 7-day load strip above Upcoming, a pace badge on project
tiles, and the forecast changes added to the preset preview.

## Stage 5: API for a future voice front-end
A small on-device LLM will later map speech to a fixed set of requests and
read results back. It must never compute or rephrase rankings itself.
- GET /api/priorities?today=YYYY-MM-DD and GET /api/forecast?today=YYYY-MM-DD
  return exactly what the shared functions return.
- Each quick action and preset change is its own small endpoint or operation
  (check src/types/operations.ts and follow the existing pattern), plus PATCH
  for partial task updates.
- A preview endpoint for presets that returns what would change, for spoken
  confirmation.
- Every reason and brief is returned as a code with parameters and as a
  finished sentence.

## Decisions made while implementing

Answers to questions raised against the spec. Where this section and the stages above disagree, this section wins.

- **This spec over the design notes.** The design notes in the appendix came first. Where they differ from the spec above, the spec wins. The known differences:
  - A blocker's inherited deadline is the working day before the blocked task's latest start, not the blocked task's deadline minus its effort.
  - R, and the ratio in the boost, are capped at 1.
  - T = 0 puts a task in tier 1.
  - A task with no effective deadline has r = 0 and p = 0.
- **Start date after due date.** A task save (the task form and `PUT /api/tasks/:id`) with `start_date` after `due_date` is refused with `400`. Other paths can move a due date without showing the start date: a project save's `dueDates` (the clash fix), Import, and the Google Calendar sync. When one of them moves a due date before the task's start date, the start date moves back to the new due date.
- **"Not today" on a task due today or overdue.** Moving the start date to tomorrow would put it after the due date. The button still shows, but it's disabled (greyed out), and it says why: the task is due today, or is overdue.

Stage 1 (proposed by Claude, open to review):

- **Task fields are optional in the JSON.** `effortMinutes`, `startDate` and `pinnedDate` follow `googleAccount`: they're left out when not set. A save that leaves one out, or sends it as `null`, clears it. Partial updates come in Stage 5 (PATCH).
- **Estimate limit:** 1 to 60,000 minutes (1,000 hours). The form takes decimal hours and rounds to the nearest minute. It shows hours to two decimal places, which always round back to the same minutes.
- **Loops:** only loops that a save creates are refused, the same way date clashes work. A loop already in the stored data doesn't block saves that leave it alone. The Worker answers `400` with the message and `loop` (the task ids in order). Planners throw `BlockLoop` (`src/types/operations.ts`). The form checks the relations already linked plus one that is picked but not linked yet.
- **Capacity warning in the form:** compares the raw estimate (no buffer) with the capacity from the later of today and the start date, through the due date. No due date means no warning.
- **Settings:** `GET /api/settings` returns the defaults without writing a row. The row is written by the first `PUT`. A `PUT` sends the whole settings object. The checks are:
  - each day's capacity is 0 to 1,440 minutes, and at least one day must be above 0;
  - buffer is 0.5 to 5;
  - `wU` and `k` are 0 to 10;
  - `horizonDays` is a whole number from 1 to 10;
  - `preset` is one of `balanced`, `deadline`, `importance` or `blockers`.

  There is no "custom" preset, and the weights aren't checked against the named preset.
- **Not logged in change tracking:** changes to estimates, start dates and pinned dates.

Stage 2 (proposed by Claude, open to review). `prioritise(tasks, projects, settings, today)` in `src/types/priority.ts`:

- **Output.**
  - `tasks` is every scored task in Suggested order (tier 0, tier 1, pinned, then the rest of tier 2), hidden tasks included, so the Stage 4 forecast can walk the same list.
  - `sections` holds the ids of the tasks the list shows in Overdue (`overdue`), Do nowww (`do_now`) and Do next (`do_next`).
  - `hidden` counts the hidden tasks, and `loops` lists the groups of tasks caught in loops.
  - Each task carries `category`, `tier`, `score`, `hidden`, `effectiveDeadline`, `deadlineSource` (`due`, `project` or `blocked`), `latestStart`, `factors`, `flags` and `reason`. A hidden task still has the category it would be shown in.
  - Every number is rounded to 4 decimal places.
- **"Open" means scored.** Only scored tasks count as blockers, as unlocked work, or in a project's work. A completed blocker, an unestimated Google import, or a task only in archived projects doesn't hide or lift anything.
- **Hidden counts.** A task that is both blocked and not started yet is counted once, as blocked.
- **Loops.** Every edge between tasks in the same loop group (a strongly connected component) is ignored, not only the edges of one cycle. A task in a loop isn't hidden by the other tasks in its loop, so it stays visible with its `inLoop` flag.
- **r.**
  - r is `null` when T is 0, since it would be infinite and can't go in JSON.
  - r is compared with 1 after rounding.
  - In `own`, r² is capped at 1: r ≥ 1 already means tier 1, so a larger value would only inflate the base that blockers inherit.
- **R.** A project with no open work has R = 0. A project whose delivery date has passed has R = 1.
- **Remaining hours for the boost.** Counts every distinct open task across the task's live projects, whether or not those projects have a delivery date.
- **Ties.**
  - Among the blocked tasks, an earlier effective deadline wins.
  - A task's own deadline wins over an inherited one on the same day.
  - When the base comes from a blocked task, the first one in relation order wins.
- **Reasons.**
  - Tier 0: `overdue`, or `blocks_overdue`.
  - Tier 1: `blocks_critical` when the tier comes from a blocked task. Otherwise `goes_critical` when the deadline comes from a blocked task, `no_time_left` when T is 0, or `needs_all_time`.
  - A pinned tier 2 task: `pinned`.
  - Other tier 2 tasks: whichever of urgency, `needed_for` (base inherited from a blocked task) or `unblocks` adds the most to the score, with ties in that order.
    - That part only becomes the reason if it adds at least 0.1 (`REASON_THRESHOLD`). Otherwise the reason is `important`, since every task has some importance.
    - Urgency gives `tight` (r), `due_soon` (p) or `project_pace` (R). It gives `goes_critical` instead when the deadline comes from a blocked task.
  - Day counts in sentences are calendar days: "Due in 2 days". The `goes_critical` count is the days until the blocked task's latest start.

Stage 3:

- **Settings page:** at `/settings`, linked beside the account in the header (decided by the user).
- **Quick actions don't use the normal task save** (decided by the user). Each is a `TaskAction` sent to `POST /api/tasks/:id/action`. The planner is `planTaskAction` in `src/types/operations.ts`, which goes through the same steps as a task save. This is the per-action operation Stage 5 asks for.

The rest of Stage 3 was proposed by Claude and is open to review:

- **Quick action rules:**
  - `today` is sent by the browser.
  - An `unpin` action was added, so a pin can be undone the same day; a pinned row shows **Unpin** instead of **Do today**.
  - **Not today** also drops a pin to today.
  - A refused action (Not today on a task due today or overdue, priority past either end) answers `400` with a sentence. An unknown task answers `404`.
- **Not today's note:** the reason a greyed-out **Not today** gives is shown as text beside it, since a tooltip doesn't show on phones.
- **Collapsing and Do next:** the panel's **Show fewer** applies to Suggested as well (its first 2 rows). Do next starts with 10 rows, with **Show N more**, and that choice isn't remembered.
- **Preview:** it shows for any change on the settings page (hours, buffer or preset), not only a preset.
  - Rows are marked "up N" or "down N", and "now in *category*" when the category changes.
  - Settings can't hide or show a task, so the preview only reorders.
  - Choosing a preset sets `wU`, `k` and `horizonDays` from its row of the table; there are no separate fields for them.
- **Failed loads:** if the settings fail to load, Suggested and the task form use the defaults, and the settings page shows the error and won't save until a retry succeeds.

Stage 4 (decided by the user):

- **Project pace** compares a project's projected finish with its delivery date. "Working days left" counts the working days after the projected finish, up to and including the delivery date.
  - **Behind:** the projected finish is after the delivery date.
  - **Tight:** 0 or 1 working days left, so it finishes on the delivery day or the working day before.
  - **On pace:** 2 or more working days left.
- **No memory:** the status is worked out from the current data every time. No previous status is stored or carried over. Hysteresis (keeping the last status inside a window) was considered and dropped, since it would need a stored status, against the rule that computed results are never stored.
- **Projects with no delivery date** get no pace status.

The rest of Stage 4 was proposed by Claude and is open to review. `forecast(tasks, projects, settings, today, priorities?)` is in `src/types/forecast.ts`:

- **The walk.**
  - Each day, it makes as many passes over the Suggested order as it takes to use up the day's hours or run out of tasks that can be worked on. So a task can start the day its blocker finishes, even when it ranks above that blocker.
  - Edges inside blocking loops are ignored, as in scoring.
  - It gives up after 5 years (`MAX_FORECAST_DAYS`). A task still unfinished by then has `finish: null`, and so does its project.
- **Today's plan** lists tasks in the order the work happens, which a blocker can make differ from the Suggested order.
- **Overbooked days.** The plan never puts more on a day than its hours, so "overbooked" can't mean planned hours over capacity. A day is overbooked when the work due by its end (effective deadlines up to that day, with overdue work counted as due today) is more than the working hours from today through that day. Overdue work is due "today", so a day off can be marked overbooked too.
- **Output.**
  - `tasks`: each task's start, finish and lateness, in Suggested order.
  - `projects`: each live project's open hours, finish, working days left (negative when late) and pace.
  - `days`: 14 days of capacity, planned and due hours, and the overbooked flag.
  - `todayPlan`, `totals` (`hours`, `unestimatedHours`, `noDeadlineHours`) and `allDone`.
- **The brief** is a list of sentences, each with a code, its values and its text, plus the sentences joined. The codes, in order:
  - `today_plan`, `today_free` or `today_off`;
  - `projects_behind`, then `projects_tight`;
  - `overbooked_days`, then `late_tasks`;
  - `assumptions` (always, whenever there is open work) or `no_work`;
  - `all_done`.
- **UI.**
  - The workload section above Upcoming shows the brief and 7 of the 14 days.
  - Pace badges follow the priority badges' scale: on pace is faint, tight is cream, behind is coral.
  - The settings preview lists the projects whose pace or projected finish would change, and the date everything is done by.

Stage 5 (proposed by Claude, open to review):

- **`GET /api/priorities` and `GET /api/forecast`** take `?today=YYYY-MM-DD`, which is required. They return exactly what `prioritise` and `forecast` give for the stored tasks, projects and settings, and store nothing.
- **`PATCH /api/tasks/:id`** takes the same `{ task, projectIds?, deliveryDates? }` shape as `PUT`, with `task` holding only the fields to change.
  - A field left out keeps its value. `null` clears `dueDate` and the optional fields.
  - The patched task is then checked whole, so start-date, clash and loop rules match `PUT`.
  - Unknown fields, `id` and `googleAccount` are refused. An unknown task is `404`.
  - The planner is `planTaskPatch` in `operations.ts`.
- **The app ticks tasks off with `PATCH`**, sending only `completed`. That shrinks the risk noted in Stage 1, where an old tab's whole-task `PUT` could clear fields it doesn't know about. The task form still saves with `PUT`, since it shows every field.
- **Preset changes** are their own operation: `POST /api/settings/preset { preset }` sets the preset's weights (`applyPreset`) and keeps the capacity and buffer. `PUT /api/settings` now refuses weights that aren't the named preset's (`matchesPreset`).
- **The preset preview** is `POST /api/settings/preview { today, preset?, capacityMinutes?, buffer? }`.
  - It merges the changes into the stored settings, checks them as a `PUT` would, and returns `previewSettings` from `src/types/settingsPreview.ts`.
  - The settings page uses the same function, so what the page shows and what the voice front-end reads out always agree.
  - Its `summary` is sentences, in order: `no_change`, `preset`, `order`, one `project_change` per project, then `all_done`.
- **Sentences everywhere.** `src/types/sentence.ts` holds the shared shape (`code`, `params`, `text`). Additions in this stage:
  - `hiddenSummary` on the priorities: "Hidden: 2 waiting on other tasks and 1 not started yet."
  - `paceReason` on each project forecast: '"Thesis" is tight: it should finish 2026-11-19, 1 working day before delivery.' The tile's hover text uses it.
  - Codes on refused quick actions: `due_today`, `overdue`, `priority_at_top` or `priority_at_bottom`, with `params` and `text` in the `400` body beside `error`.
- **Not built:** matching a spoken phrase to a task, and the voice front-end itself.

## Appendix: design notes (13 Nov 2026)

The earlier design, kept as background. The spec above takes precedence where they differ (see Decisions made while implementing).

Status: agreed design, not implemented. Default numbers are starting guesses to tune against real tasks.

### Decisions

- Output: a sortable score plus tier/bucket labels.
- Effort is estimated in hours (stored as integer minutes). Tasks stay small and binary (done / not done); there is no per-task progress field. Remaining effort of a project = sum of its open tasks' estimates.
- Capacity: hours available for tasks per day, default 8, user-editable (per weekday, default Mon-Fri).
- Overdue tasks always rank first. Clearing them is the user's job.
- A task with no slack left (needs all remaining time) ranks next, regardless of other factors.
- Blocked tasks are scored but hidden from the priority list.
- Small tasks due within 2 working days get a proximity lift so they can be cleared quickly.
- Blockers should rise early in a project, independent of deadlines.
- Project pace matters: a project that is falling behind lifts all its tasks.
- Tasks get an optional start date; the end date is the existing due date. Effort stays a separate field, entered in hours at task creation (duration is not used to derive effort).
- Tasks whose start date is in the future are scored but hidden from the priority list, like blocked tasks.
- Layout: one Upcoming panel with a "By date / Suggested" switch.
- Project priority sets how much a project matters; task priority is relative within its project. Project priority dominates.
- A blocker's deadline is the blocked task's latest possible start. The blocker also inherits the blocked task's score, and Pam prompts on the blocker when the blocked task is approaching critical.
- Parent and subtask estimates are both counted (a parent's estimate means its own work, on top of its subtasks).
- Tasks imported from Google Calendar are left out of scoring and the forecast, unless the user gives one an effort estimate; it is then treated like any other task.
- Calculations use decimals; only stored inputs are integers. Scores are computed on read, never stored.

### Inputs

| Input | Source |
|---|---|
| Effort | New field, minutes. Multiplied by buffer (default 1.0). |
| Effective deadline | Earliest of: own due date; delivery date of its live projects (if it has no due date); for each task it blocks, that task's effective deadline minus that task's effort. |
| Importance | Levels map to low 0.1, medium 0.4, high 0.7, urgent 1.0. Importance = project value x (0.5 + 0.5 x task value). Several projects: highest result. No project: the task's level is used for both values. |
| Capacity | Setting: hours per weekday. |
| Unlocked hours | Total effort of all open tasks downstream of this one via `blocks`. |

### Formula

```
E = effort x buffer
T = capacity hours from the later of today and the start date, to the effective deadline (inclusive)
d = working days before the effective deadline (today = 0)

r = E / T
R = (project open effort x buffer) / (capacity hours to project delivery date)
    largest value across the task's live projects; 0 if none
p = (1 - d / 2)^2, or 0 when d >= 2

Tier 0  own due date has passed, or it blocks a tier 0 task
Tier 1  r >= 1, or it blocks a tier 1 task
Tier 2  own   = wU x max(r^2, p, R^2) + importance
        base  = largest of own and the base of each task it blocks
        boost = 1 + k x (unlocked hours / project remaining hours)
        score = base x boost
```

Defaults: wU = 1, k = 1, buffer = 1.0, horizon = 2 working days.

Ordering: tier first. Inside tiers 0 and 1: importance, then earliest deadline. Inside tier 2: score, then least effort, then task id.

Categories shown to the user: Overdue (tier 0), Do nowww (tier 1, plus tasks pinned with Do today), Do next (all of tier 2, in score order). There is no score threshold and no Later category.

### Known limitations

- Each project's pace is measured in isolation; several projects can be individually fine but jointly too much.
- Remaining effort only counts tasks that exist. An optional total estimate per project would cover undiscovered work.
- Small-task proximity lift can starve large tasks if small ones keep arriving. Tier 1 is the guard.
- Blocker prompt: when a blocker's urgency comes from an inherited deadline, its reason reads "<blocked task> goes critical in N days unless this is done".
- The "urgent" priority level overlaps in name with computed urgency.

### Tuning: presets with live preview (agreed)

| Preset | wU | k | Proximity horizon (working days) |
|---|---|---|---|
| Balanced (default) | 1 | 1 | 2 |
| Deadline-driven | 2 | 0.5 | 3 |
| Importance-driven | 0.5 | 0.5 | 1 |
| Blockers-first | 1 | 2 | 2 |

Values are starting guesses. Choosing a preset re-runs scoring and the forecast in the browser with the candidate values and shows the result before saving: the reordered list with moved rows marked, and any project whose pace status changes. Apply saves to user settings; Cancel discards.

Determinism rules: today's date is passed in as an input; scores are rounded to 4 decimal places before comparison; ties break by effort then task id; one shared function for browser and Worker; nothing computed is stored. No automatic learning of weights.

Per-task quick actions (agreed), as buttons on a row in the Suggested list:

- Do today: pins the task into today's plan; stored as `tasks.pinned_date`, ignored once that date has passed. Pinned rows are marked.
- Not today: sets the start date to tomorrow.
- Importance up / down: moves the task's priority one level.
- Fix estimate: edits effort in place.

Pinned tasks appear at the end of Do nowww, after tier 1 tasks, and are placed in today's forecast straight after tiers 0 and 1.

Discussed but not adopted yet: analytics-driven suggestions for weight changes.

### Workload overview (forecast wanted and must be deterministic; details proposed)

Goal: Pam acts as an assistant that reports on overall workload, not only a ranked list.

- Forecast: walk forward day by day from today, filling each day's capacity with open tasks in priority order (respecting start dates and blockers). Record each task's projected finish.
- Per project: projected finish vs delivery date gives On pace / Tight / Behind, measured against everything else competing for time.
- Per day: committed hours vs capacity for the next 7 to 14 days, with overbooked days flagged.
- Today plan: the tasks that fill today's capacity.
- Always state how many forecast hours come from the 2-hour default, and how many hours have no deadline.
- Stages: (1) weekly totals and project pace badges, (2) forecast and today plan, (3) warnings when adding or moving a task overbooks a day.

### Implementation outline

1. Migration: `tasks.effort_minutes` (nullable), `tasks.pinned_date` (nullable), `tasks.start_date` (nullable, must be on or before the due date; warn when effort exceeds the capacity of the start-to-due window), a `user_settings` table (capacity per weekday, buffer, wU, k), optionally `projects.estimate_minutes`.
2. Types, limits, Worker validation, and an "Estimate (hours)" field on the task form. Effort is optional; unestimated tasks count as 2 hours and are marked.
3. `src/types/priority.ts`: a pure function next to `upcoming.ts`, returning tier, score, per-factor breakdown and a one-line reason per task. Vitest spec alongside `Upcoming.spec.ts`.
4. Cycle check. Verified 13 Nov 2026 at commit b119458: no cycle check exists. The Worker only rejects a task related to itself or listing the same task twice. A relation is stored on one task and the inverse is derived, so A blocks B plus B blocks A, and longer loops, are accepted today. Add `findBlockCycle` to `src/types/rules.ts` (shared by forms and Worker), reject on save with the loop named, and make the scoring function ignore and flag any loop already in the data.
5. UI: one Upcoming panel with a "By date / Suggested" switch (remembered in the browser). Suggested mode shows a reason per row and a count of hidden blocked tasks.
6. Later: expose the same function from the Worker for the voice front-end.

### Use by the voice / LLM front-end (planned)

The LLM only maps speech to a fixed set of requests and reads back results; all ranking stays in the shared function.

- Questions it can answer from the function's output: what to do next, why a task is ranked where it is (reason and breakdown), how the week looks (forecast brief).
- Commands map to the quick actions and presets: do today, not today, importance up/down, set estimate, switch preset.
- Preset preview doubles as spoken confirmation before applying.
- Needs: a Worker endpoint returning the scored list and forecast as JSON, partial task updates (PATCH), and backend-written sentences for numbers so the model does not restate them itself.
- Not solved by this: matching a spoken phrase to the right task.
