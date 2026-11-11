// Secrets and settings, which aren't in wrangler.jsonc, so `pnpm cf-typegen` only adds them to Env
// when they're in .dev.vars. Set them in .dev.vars for `pnpm dev`, and with `wrangler secret put`
// for deploys (see "Google Calendar" and "Password reset" in README.md). Until they're set they
// are missing, which google.ts and auth.ts check.
interface Env {
  GOOGLE_CLIENT_ID: string // the OAuth client from Google Cloud, for importing calendars
  GOOGLE_CLIENT_SECRET: string
  APP_ORIGIN: string // where the app is served, e.g. "https://pam.example.com", for reset links
  EMAIL_FROM: string // the address reset emails come from, on a domain set up for Email Service
  EMAIL: SendEmail // the send_email binding in wrangler.jsonc
}
