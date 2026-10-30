// Secrets, which aren't in wrangler.jsonc, so `pnpm cf-typegen` only adds them to Env when they're
// in .dev.vars. Set them in .dev.vars for `pnpm dev`, and with `wrangler secret put` for deploys
// (see "Google Calendar" in README.md). Until they're set they are missing, which google.ts checks.
interface Env {
  GOOGLE_CLIENT_ID: string // the OAuth client from Google Cloud, for importing calendars
  GOOGLE_CLIENT_SECRET: string
}
