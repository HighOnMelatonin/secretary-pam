-- Google Calendar import (worker/google.ts): the Google accounts each user has connected, and
-- which event each imported task came from.

-- A Google account connected to a Pam account. The refresh token can't be used without the
-- OAuth client secret, which is a Worker secret, so the database alone can't read a calendar.
CREATE TABLE google_accounts (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  refresh_token TEXT NOT NULL,
  synced_at TEXT, -- when its events were last imported
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, email)
);

-- A connection to Google that has been started but hasn't come back yet. id is the OAuth state
-- sent to Google, and code_verifier the PKCE secret that goes with it. Used once, then deleted.
CREATE TABLE google_auth_states (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_verifier TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- The event an imported task came from, so syncing again updates the task rather than adding it
-- twice. Deleting the task deletes this row; disconnecting the account doesn't, so the task keeps
-- its badge and is picked up again if the account is connected again.
CREATE TABLE google_events (
  user_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  account_email TEXT NOT NULL COLLATE NOCASE,
  calendar_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  starts_at TEXT NOT NULL, -- UTC timestamps of the event's start and end, to tell whether a
  ends_at TEXT NOT NULL, -- sync should have seen it
  PRIMARY KEY (user_id, task_id),
  UNIQUE (user_id, account_email, calendar_id, event_id),
  FOREIGN KEY (user_id, task_id) REFERENCES tasks (user_id, id) ON DELETE CASCADE
);
