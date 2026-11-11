// Sends email through Cloudflare Email Service: the EMAIL binding in wrangler.jsonc, from the
// EMAIL_FROM address (see "Password reset" in README.md). Under `pnpm dev` nothing is sent:
// Wrangler prints each email to the terminal instead.
//
// Emails are plain text only, so nothing put into one can be read as HTML.

export interface Email {
  to: string
  subject: string
  text: string
}

// An object so tests can replace send
export const mailer = {
  async send(env: Env, email: Email): Promise<void> {
    await env.EMAIL.send({ from: { name: 'Pam', email: env.EMAIL_FROM }, ...email })
  },
}

// Whether the settings email needs are there
export const canSendEmail = (env: Env) => Boolean(env.EMAIL && env.EMAIL_FROM)
