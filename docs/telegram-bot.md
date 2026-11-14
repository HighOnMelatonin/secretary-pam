# Telegram companion bot

Implementation spec, 14 Nov 2026. Status: Stages 1 to 4 (linking, morning brief, buttons and commands, capture) built (14 Nov 2026), awaiting review; see "Decisions made while implementing".

Add a Telegram companion bot to Pam (this repo). Read README.md and
docs/priority-algorithm.md first and follow the existing conventions. Work in
the stages below, one pull request per stage, and stop after each for my
review. If anything here is ambiguous or conflicts with the code, ask me
before guessing. Check Telegram Bot API details against its documentation
rather than relying on this prompt.

## What it is
A companion, not a second front end. It sends a morning brief, shows two tasks
at a time, takes one-tap actions and captures new tasks. Anything else is an
"Open Pam" link to the right page (APP_ORIGIN + route).

## Ground rules
- All bot code lives in worker/pamBot/. It runs inside the existing Worker:
  no second Worker, no separate process, no new dependencies (call the Bot API
  with fetch), no LLM.
- No logic of its own. Rankings and the brief come from prioritise() and
  forecast(); changes go through planTaskSave / planTaskAction and
  saveWithRules, so every rule and event log applies. Reuse the sentence text
  those already return (brief.text, reason.text, ActionRefused.sentence).
- Functions that build messages and buttons are pure and unit-tested. Only the
  webhook and scheduled handlers read the clock; they pass `today` (the user's
  local date) and `now` into everything else.
- Add 'telegram' to EventSource so analytics can tell bot changes apart.
- Secrets TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and the setting
  TELEGRAM_BOT_USERNAME go in worker/secrets.d.ts. When they are missing the
  feature is off: routes answer 404, the scheduled handler does nothing, and
  the settings page hides the section. Do not set them for previews.
- Never log the token. Send messages as plain text (no parse_mode).
- Tests: Vitest unit tests for the pure builders; Worker integration tests with
  the Bot API faked. Update README (features, setup, schema, roadmap).
- Stage 0: save this spec as docs/telegram-bot.md and commit it.

## Stage 1: linking
- Migration (next free number): a telegram_links table (user_id primary key,
  chat_id unique, time_zone as an IANA name, brief_minutes default 450 for
  07:30, enabled, last_brief_date, last_added_task_id, last_update_id,
  linked_at) and a table of one-time link codes (hash of the code, user_id,
  expiry of 10 minutes).
- Signed-in API: GET /api/telegram (status), POST /api/telegram/link-code,
  PUT /api/telegram (time zone, brief time, enabled), DELETE /api/telegram.
- Settings page: a Telegram section. "Connect" shows the code and a
  https://t.me/<username>?start=<code> link; once linked it shows the brief
  time, time zone (prefilled from the browser), an on/off switch and
  "Disconnect".
- POST /api/telegram/webhook, handled before the session check. Reject any
  request whose X-Telegram-Bot-Api-Secret-Token header does not equal the
  secret (constant-time compare). Private chats only. "/start <code>" links
  the chat; every other update from an unlinked chat is ignored. Skip updates
  whose update_id is not above last_update_id. Always answer 200 quickly.
- README: creating the bot, setting the secrets, and the setWebhook call with
  secret_token and allowed_updates ["message", "callback_query"].

## Stage 2: morning brief
- A cron trigger every 15 minutes and a scheduled handler. For each enabled
  link: if the user's local time has reached brief_minutes, last_brief_date is
  before their local today, and today has capacity above 0, send the brief and
  set last_brief_date.
- The message:
    line 1-2: forecast.brief.text
    line 3:   counts of overdue and do-now tasks not shown below, if any
    then "Start with:" and the top TWO visible tasks in Suggested order, each
    as "<n>. <name> (<hours>). <reason.text>"
- Buttons: per task "<n> Done" and "<n> Not today"; then "Next" and "Open Pam".
- With no open tasks, send one short line instead.

## Stage 3: buttons and commands
- Button data carries the action and task id (and, for Next, an offset), so
  nothing is remembered between presses. Check the Bot API's size limit for
  callback data; if an id does not fit, leave that task's buttons out.
- Done: complete the task, answer the callback, edit the original message to
  mark it done and remove its buttons, then IMMEDIATELY send the current top
  two tasks.
- Not today: planTaskAction 'not_today'. If it is refused, reply with the
  refusal sentence. Then send the current top two.
- Next: send the following two tasks without changing anything.
- A button for a task that is already done or deleted replies with a short
  note, never an error. Pressing Done twice never reopens a task.
- Commands: /next (top two), /today (forecast.todayPlan), /brief, /stop
  (turns the morning brief off), /help.

## Stage 4: capture
- "/add <name>" creates a task with the defaults (medium, no dates, no
  estimate, no project) and replies with what was created plus buttons:
    Priority: Low / High / Urgent
    Due:      Today / Tomorrow / End of week
    Estimate: 30 m / 1 h / 4 h
    Open in Pam (the task's page)
  Each press changes that one field and edits the message to show the task's
  current values.
- "/desc <text>" sets the description of the task most recently created with
  /add in that chat, and the reply names the task.
- Any other text gets a one-line hint about /add and /help. It never creates
  a task.
- Not in the bot: deleting, projects, relations, exact dates, settings.

## Decisions made while implementing

Answers to questions raised against the spec. Where this section and the stages above disagree, this section wins.

- **Git.** Claude makes the changes for each stage and the user commits, branches and opens the pull requests (the user's standing preference, which overrides "commit it" and "one pull request per stage" above).

Before Stage 1 (decided by the user):

- **`'telegram'` needs a table rebuild.** `task_events.source` has a `CHECK` constraint (migration `0007`), which SQLite can't change in place. Migration `0010` rebuilds the table: every row is copied with its id into a table with the new constraint, which then takes the old name, and its indexes are made again. It ships in Stage 1 with the other schema changes.
- **Time zone at link time.** `POST /api/telegram/link-code` takes `{ timeZone }` from the browser. It's stored on the code's row (`telegram_link_codes.time_zone`, a column beyond the spec) and copied to the link, so the first brief comes at the right local time.
- **Hours per task** (for Stage 2): the hours the forecast counts, estimate × buffer, with unestimated tasks shown as "2 h, no estimate".
- **Relinking.** A new link replaces the old one: linking a chat moves the account off any chat it had, and moves the chat off any account it had.

Stage 1 (proposed by Claude, open to review):

- **Event source.** `planTaskSave` and `planTaskAction` take an optional `source` (default `'app'`), which `finish` passes to `diffEvents`. The bot's changes still go through the same planners and `saveWithRules`.
- **When the bot is on.** It needs `APP_ORIGIN` as well as the three Telegram settings, since its messages link to Pam's pages. Without any of them, every `/api/telegram` route answers `404`. The secrets are typed as `string` in `secrets.d.ts`, like the others, so they match what `pnpm cf-typegen` adds, and are checked for being empty or missing at runtime.
- **Previews.** Cloudflare keeps Preview deploys' secrets in their own "Previews base configuration", and Cron Triggers never run on Previews. So "not set for previews" means leaving the bot's settings out of that configuration; nothing in `wrangler.jsonc` is needed.
- **Codes** are 128 random bits as 32 hex characters: within the 64 characters, and the `A-Z a-z 0-9 _ -` set, that a `t.me/<bot>?start=` parameter allows. Each account has at most one code: asking for another replaces it, and expired codes are cleared then too. The code is deleted by the statement that finds it, so it links one chat at most.
- **`/start` parsing.** `/start <code>` or `/start@<bot> <code>`, with nothing else in the message. A wrong or expired code gets a reply pointing to the settings page, even from an unlinked chat, since it's an attempt to link. A bare `/start`, or anything else from an unlinked chat, gets no reply.
- **Skipping repeats.** `last_update_id` is checked and set in one `UPDATE … WHERE last_update_id < ?` statement, so two copies of an update can't both be handled. Linking sets it to the update that brought the code. Telegram may deliver updates over several connections at once, so an older update arriving after a newer one is skipped too. That's acceptable for a chat with one person in it.
- **The webhook handles the update before answering**, rather than after (`waitUntil`). Handling is a few D1 queries and one Bot API call. Errors are logged (never the token) and still answered with `200`. A request without the right secret is refused with `401`, and a non-POST gets `405`. A body that isn't an update is answered with `200` and ignored.
- **Disconnect** deletes the link and the account's codes, then tells the chat "This chat is no longer linked to Pam" after answering (`waitUntil`). If the message fails, the unlink still stands.
- **`PUT /api/telegram`** takes all three fields, each required: `timeZone` (an IANA name the runtime knows, up to 100 characters), `briefMinutes` (a whole number from 0 to 1,439) and `enabled` (a boolean). It answers `409` when no chat is linked.
- **Link status in the API.** `GET /api/telegram` answers `{ linked: false, botUsername }` or the linked chat's preferences. The chat id is never sent to the browser.
- **Settings page.** The Telegram section is its own card below the settings form, with its own **Save**, since **Apply** and its preview are about planning. Unlinked: **Connect**, then **Open Telegram** (the t.me link), the code to send by hand, and **I've linked it** to check again. Linked: an on/off switch for the brief, the brief time (`<input type="time">`), the time zone (a text field suggesting the zones the browser knows, with **Use it** when the browser's zone differs), **Save** and **Disconnect**.
- **Where the bot's pure tests live.** In `worker/__tests__/telegramMessages.spec.ts`, which runs with the integration project (so in the Workers runtime), since the unit project only covers `src/`. They need no database or fake Bot API.
- **The API client** now throws `ApiError`, which carries the response's status, for failures other than clashes. It's a subclass of `Error`, so nothing that catches errors changes. The status is what tells "the bot is off" (`404`) apart from a failure.

Stage 2 (proposed by Claude, open to review):

- **Brief times are on the quarter hour.** This changes Stage 1: `PUT /api/telegram` refuses a `briefMinutes` that isn't a multiple of 15, and the settings page's time field steps by 15 minutes. The Cron Trigger runs at :00, :15, :30 and :45 UTC. Every UTC offset in use is a whole number of quarter hours, so each run also falls on a local quarter hour. Any other time would come late, and a time after 23:45 would never come, since the next run is on the next local day.
- **When it's due.** At the first run whose local time is at or after the brief time, on a local day after `last_brief_date`, with capacity above 0 that day. A missed run is caught up later the same day; a missed day isn't sent the next day.
- **Sending once.** `last_brief_date` is claimed in one conditional `UPDATE` before sending, so two runs at once can't both send. If Telegram refuses the message, it's put back, so the next run tries again. Chats are handled one after another, and one chat's failure is logged (never the token) without stopping the rest.
- **Clock.** The scheduled handler takes the run's `scheduledTime` as `now`. `localDateTime(now, timeZone)` gives the local date (`today`) and minutes, and everything after that is pure: `briefDue`, `prioritise`, `forecast` and `briefMessage`.
- **Data access.** The bot reads tasks, projects and settings through a `PamData` object that `worker/index.ts` passes in, using its own `listTasks`, `listProjects` and `getSettings`. So the bot has no queries of its own for them, and nothing is imported in a circle.
- **The message.**
  - Line 1 is `forecast.brief.text` as it is (one paragraph, which Telegram wraps). Then, if any, "Plus N more overdue and M more to do now." for the Overdue and Do nowww tasks after the top two. Then "Start with:" and the two task lines, with no blank lines between them.
  - Hours are `formatHours(factors.effortHours)` (estimate × buffer, rounded to 0.1 h), with ", no estimate" for the 2-hour default.
  - The shown tasks are the Suggested list's: Overdue, Do nowww, then Do next, leaving out hidden ones.
- **Nothing to start.** With no visible tasks, the whole message is "No open tasks today.", or "Nothing to start today." followed by `hiddenSummary.text` when tasks are hidden (waiting on others, or not started yet). There are no buttons.
- **Buttons and callback data.**
  - The callback data is `d:<task id>` (Done), `nt:<task id>` (Not today) and `next:<offset>` (Next). Telegram allows 1 to 64 bytes. A task whose `nt:` data doesn't fit (an id over 61 bytes) gets no buttons, though its line is still shown. Pam's own ids are 36-character UUIDs, so this only affects ids set by hand or imported.
  - **Next** is left out when there are no more tasks. **Open Pam** links to the dashboard (`APP_ORIGIN` + `/`).
  - Stage 3 handles the presses.
- **No link previews.** Messages are sent with `link_preview_options.is_disabled`, so the Open Pam URL doesn't add a card.

Stage 3 (proposed by Claude, open to review):

- **Saving.** `PamData` gains `save`, which is `saveWithRules` from `worker/index.ts`. Done is `planTaskSave` with the stored task marked completed (the same change the app's checkbox makes), and Not today is `planTaskAction` `'not_today'`, both with the source `'telegram'`. Whether the task still exists and is still open is checked inside the plan, so against the data the save reads.
- **Done never reopens.** Done only ever sets `completed`. For a task already done (twice, or ticked off in Pam), Done and Not today change nothing and reply `"Report" is already done.`; for a deleted one, `That task is no longer in Pam.` These notes don't send the top two after them.
- **Order for Done and Not today:** change the task, answer the callback (no toast text), edit the message, then send the top two. If handling fails before the answer, the press is answered with "That didn't work. Try again, or use Pam." so the spinner stops; the failure is logged as before.
- **Marking the message.** The edit adds a last line, `Done: <name>` (or `Not today: <name>`, which the spec doesn't ask for, so the stale buttons go away there too), and removes only that task's row of buttons, keeping the other task's and Next/Open Pam. The text and buttons come from the pressed message itself. A message Telegram says is too old to see (`date` 0) isn't edited, and a failed edit is logged without stopping the top two. If the added line would pass 4,096 characters, only the buttons change.
- **Refusals.** Not today's `ActionRefused.sentence.text` is sent as its own message, then the top two. A clash or blocking loop the save refuses (it can't happen for these two changes, but the save can say so) is sent the same way.
- **The top two** after a press, and for `/next`, are `Next up:` and the same task lines and buttons as the brief, without the brief and count lines. **Next** sends `Then:` and the tasks from its offset, numbered on (3, 4, …), worked out afresh, so a list that has changed since may differ. Past the end: "That's every task for today." with Open Pam.
- **`/today`** is the brief's first sentence (`forecast.brief.parts[0]`: "Today: 2 tasks, 3.5 h of 6 h.", "Nothing is planned for today." or "Today is a day off."), then `forecast.todayPlan` in its order, as `1. Report (1.5 h)`, with `, more after today` when the plan doesn't finish the task today. Only an Open Pam button.
- **`/brief`** sends the brief for the local today whenever it's asked for, even on a day with no hours, and doesn't set `last_brief_date`, so the scheduled one still comes.
- **`/stop`** sets `enabled` to off (the settings switch) and replies with how to turn it back on. There's no `/start`-style command to turn it back on, since that's a setting.
- **Command parsing.** `/cmd` or `/cmd@<bot>` (any case), with anything after it ignored for these five. A command addressed to another bot is ignored. A bare `/start` from a linked chat gets `/help`. Any other text, or an unknown command, gets no reply until Stage 4 adds the hint (which it now does, see below).
- **Unlinked chats and odd data.** A press from a chat that isn't linked, or whose data the bot didn't make, is only answered (silently), so the spinner stops. A repeated press (same `update_id`) is skipped like a repeated message.
- **Command menu.** The README gives an optional `setMyCommands` call, so Telegram's menu lists the five commands. The Worker doesn't call it.

Stage 4 (proposed by Claude, open to review):

- **`/add <name>`** trims the name and refuses an empty one (with how to use it) or one over 200 characters, the app's limit. The task is `createEmptyTask()` with that name, a new UUID, saved with `planTaskSave` and source `'telegram'`, which logs `task_created`. Then the chat's `last_added_task_id` is set.
- **The reply** is `Added: <name>`, then `Priority: Medium`, `Due: none` or `Due: 2026-11-20 (Friday)`, and `Estimate: none`, `30 m` or `1.5 h`, one per line. Under it are three rows of buttons, one per field, then **Open in Pam** to `/tasks/<id>`. Medium has no button, as the spec lists. The buttons don't mark the current value; the text shows it.
- **Callback data** is `p:<low|high|urgent>:<id>`, `due:<today|tomorrow|week>:<id>` and `e:<30|60|240>:<id>`, the choice before the id so an id with `:` still reads back. The longest, `due:tomorrow:`, leaves 51 bytes for the id; the bot's own ids are 36. A task whose id doesn't fit gets only Open in Pam.
- **End of week** is the coming Friday: today on a Friday, and the next Friday on Saturday or Sunday. It's fixed rather than the last working day from the capacity settings, so it's the same every week. **Today** and **Tomorrow** come from the chat's local date when the button is pressed, not when the task was added.
- **Each press** changes its one field through the planners: priority and due date with `planTaskSave`, the estimate with `planTaskAction` `'estimate'`. A due date before the task's start date moves the start date back with it (`clampStartDate`), as a project save does, since the bot doesn't show start dates. The press is answered, then the message is edited to show the task as saved. A press that changes nothing (the field already has that value) is only answered, since Telegram refuses an edit that changes nothing. Under a message too old to edit, the values are sent as a new message.
- **Done or deleted.** As in Stage 3, a field button for a task that's since been done or deleted only gets the note, so a done task's fields aren't changed from the chat.
- **`/desc <text>`** replaces the description of the chat's last added task, keeping line breaks, up to 10,000 characters, and replies `Saved the description of "<name>".` It works on a task ticked off since. With no task added yet, it says to `/add` first; with an empty text, how to use it; if the task was deleted, `That task is no longer in Pam.` Only `/add` sets the last added task, so a task made in Pam isn't described by mistake.
- **Any other text** gets `To add a task, send /add and its name. /help lists everything else.` That includes unknown commands, and commands addressed to another bot, which Stage 3 ignored. A message with no text (a photo, a sticker) gets nothing. Nothing but `/add` makes a task.
- **`/help`** now lists `/add` and `/desc` too, and the README's `setMyCommands` call includes them.
