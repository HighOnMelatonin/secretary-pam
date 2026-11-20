// Which client made a change or took an action, and the names of the actions counted in
// usage_counts (README, "Usage"), shared by the web app, which sends them as headers, and the
// Worker, which checks them. The headers are only labels: nothing is allowed or refused by them.

// The web app says which of its layouts sent a request. Decided once per page load from the
// screen's width, at the app's phone breakpoint (as in App.vue and calendarView.vue).
export const CLIENT_HEADER = 'X-Pam-Client'
export const WEB_CLIENTS = ['web-desktop', 'web-mobile'] as const
export type WebClient = (typeof WEB_CLIENTS)[number]
export const PHONE_QUERY = '(max-width: 767px)'

// Who an action or change came from. A request without a known X-Pam-Client is 'unknown'.
export type Client = WebClient | 'telegram' | 'unknown'
// Who a change in history came from: a client, or the Google sync. 'baseline' marks the rows
// migration 0013 wrote for the data that already existed.
export type ChangeSource = Client | 'google'

// The action a request is, sent by the web app as X-Pam-Action. A request the app sends on its own,
// without a click or keypress, is marked 'auto' and isn't counted. A missing or unknown name is
// counted as "METHOD route", such as "PUT tasks".
export const ACTION_HEADER = 'X-Pam-Action'
export const AUTO_ACTION = 'auto'

export const USAGE_ACTIONS = [
  'task_create',
  'task_edit',
  'task_complete', // also the bot's Done button
  'task_reopen',
  'task_delete',
  'task_import',
  'project_create',
  'project_edit',
  'project_delete',
  'tag_create',
  'tag_edit',
  'tag_delete',
  'quick_action_pin',
  'quick_action_unpin',
  'quick_action_not_today', // also the bot's Not today button
  'quick_action_priority', // also the bot's priority buttons
  'quick_action_estimate', // also the bot's estimate buttons
  'quick_action_due', // the bot's due date buttons
  'google_sync',
  'google_disconnect',
  'settings_save',
  'telegram_link',
  'telegram_save',
  'telegram_unlink',
  'export',
  'bot_stop',
  'bot_brief',
  'bot_quickwins',
] as const
export type UsageAction = (typeof USAGE_ACTIONS)[number]

export const isUsageAction = (value: unknown): value is UsageAction =>
  (USAGE_ACTIONS as readonly unknown[]).includes(value)

// Actions that happen only in the browser, so the app reports them with POST /api/usage
export const CLIENT_ONLY_ACTIONS = ['export'] as const satisfies readonly UsageAction[]
export type ClientOnlyAction = (typeof CLIENT_ONLY_ACTIONS)[number]
