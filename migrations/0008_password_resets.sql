-- Password resets (worker/auth.ts), following OWASP's Forgot Password Cheat Sheet.

-- A reset link that has been emailed and not used yet. Like sessions, the id is the SHA-256 hash
-- of the token in the link, so the database alone can't be used to reset a password. A link
-- works once, until expires_at; asking for another replaces it, and resetting the password
-- deletes all of the account's links.
CREATE TABLE password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX password_resets_user_id ON password_resets (user_id);

-- Every reset request, whether or not the email has an account, so one inbox can't be flooded
-- with reset emails, and the limit doesn't give away which emails have accounts
CREATE TABLE reset_requests (
  email TEXT NOT NULL COLLATE NOCASE,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX reset_requests_email ON reset_requests (email, at);
