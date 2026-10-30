// What the Google Calendar routes (worker/google.ts) send back, shared by the app and the Worker

// A Google account connected to the signed-in Pam account
export interface GoogleAccount {
  email: string
  syncedAt: string | null // when its events were last imported, as a UTC timestamp
}

// What a sync did for one Google account. With an error, nothing was changed for that account.
export interface SyncResult {
  email: string
  added: number // tasks made for new events
  updated: number // tasks whose name, due date or description changed with their event
  removed: number // tasks deleted because their event was deleted
  keptDates: number // tasks whose event moved after the delivery date of a project the task is in, so they kept their due date
  failedCalendars: number // calendars that couldn't be read; their tasks were left as they were
  error?: string
  reconnect?: boolean // Google no longer accepts Pam's access, so the account must be connected again
}

// What a sync changed in a few words, e.g. "3 added, 1 removed", or "up to date"
export function syncSummary(result: SyncResult): string {
  const parts = [
    [result.added, 'added'],
    [result.updated, 'updated'],
    [result.removed, 'removed'],
  ] as const
  const changes = parts.filter(([count]) => count > 0).map(([count, label]) => `${count} ${label}`)
  return changes.length ? changes.join(', ') : 'up to date'
}
