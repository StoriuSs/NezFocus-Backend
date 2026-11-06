# Authentication

Accounts, passwords, sessions and Google sign-in are part of this API, in its
own database: there is no separate identity server to run. The code is in
[src/modules/auth/](../../src/modules/auth/).

This is the start page of the auth documentation. It says what the module
does, which pages to read for what you are trying to do, and lets you try it
in five minutes.

- [What it does](#what-it-does)
- [Where to start](#where-to-start)
- [Try it in five minutes](#try-it-in-five-minutes)
- [Every page in this set](#every-page-in-this-set)
- [The settings at a glance](#the-settings-at-a-glance)

## What it does

| Feature | In short | Read |
|---|---|---|
| Sign up or sign in with a code | One flow (D-59, D-60): a six-digit code emailed to any address; the right code signs in to the address's account, or creates one, not completed yet | [flows.md](./flows.md#sign-up-or-sign-in-with-a-code) |
| Complete your account | A new account chooses a display name, username, password, time zone and language and accepts the Terms; until then signed-in routes answer `403 ACCOUNT_INCOMPLETE` (D-61) | [accounts.md](./accounts.md#completing-the-account) |
| Sign in with a password | For an account that has one (set when completing the account, or with "forgot password") | [flows.md](./flows.md#sign-in) |
| Password rules | At least 8 characters, upper and lower case, a digit and a symbol; not the address or username (no common-password list, D-29). Each rule has an id the frontend can show | [passwords-and-codes.md](./passwords-and-codes.md#the-password-rules) |
| Password storage | Argon2id, upgraded automatically when the settings are raised | [passwords-and-codes.md](./passwords-and-codes.md#how-passwords-are-stored) |
| Sessions | A 15-minute access token (JWT) in memory, plus a refresh token in an httpOnly cookie; a session lasts 30 days | [sessions-and-tokens.md](./sessions-and-tokens.md) |
| Stolen-cookie detection | Refresh tokens work once; a replayed one ends the session and raises an alert | [sessions-and-tokens.md](./sessions-and-tokens.md#reuse-detection) |
| Immediate sign-out | Signing out, changing the password or deleting the account takes effect on the next request | [sessions-and-tokens.md](./sessions-and-tokens.md#what-ends-a-session) |
| Forgot, reset, change password | Reset by emailed code (ends every session); change with the current password (ends the others) | [flows.md](./flows.md#forgot-and-reset-the-password) |
| Sign in with Google | OpenID Connect with PKCE; optional, on when its two settings are set | [google-sign-in.md](./google-sign-in.md) |
| Rate limits | Per address, per IP and per user, on every operation an attacker would repeat | [rate-limits.md](./rate-limits.md) |
| No account enumeration | Asking for a code, sign-in and "forgot password" answer the same whether or not an address has an account | [security.md](./security.md) |
| Security emails | The owner is told when the password or sign-in methods change, and when the account is deleted. Every email in Vietnamese or English, the page's language (D-132) | [emails.md](./emails.md) |
| Account deletion | Needs the password; personal details erased after 30 days | [accounts.md](./accounts.md) |
| Roles | `["user"]` by default; `pnpm user:promote` makes an administrator; `@Roles('admin')` on a route | [accounts.md](./accounts.md) |
| Monitoring | Sign-in events counted (`auth_events_total`), a dashboard row, alerts on failed-login spikes and token reuse | [operations.md](./operations.md) |

What it does **not** have (yet): a "your devices" page, passkeys
(WebAuthn), an audit-log table, sign-in with providers other than Google
(adding one is described in [google-sign-in.md](./google-sign-in.md)).

## Where to start

Pick the line that fits; each is a reading order.

**"I just want it running."**

1. [../setup/prepare-for-development.md](../setup/prepare-for-development.md):
   from a fresh machine to a running API.
2. [Try it in five minutes](#try-it-in-five-minutes), below.
3. Optional extra later: [Google](../setup/google-sign-in.md).

**"I'm building the frontend"** (or changing the React starter).

1. [concepts.md](./concepts.md): the words, if any are new.
2. [flows.md](./flows.md): what each screen calls, in order, and every error
   it can get.
3. [sessions-and-tokens.md](./sessions-and-tokens.md#what-the-web-app-must-do):
   credentials, keeping the token in memory, refreshing.
4. [api-reference.md](./api-reference.md): every route and error code, and
   how a client should react to each.
5. [passwords-and-codes.md](./passwords-and-codes.md): showing `data.rules`.
6. As needed: [google-sign-in.md](./google-sign-in.md) (the `/auth/callback`
   page).

**"I need the exact rules."**

1. [api-reference.md](./api-reference.md): routes, bodies, answers, errors.
2. [rate-limits.md](./rate-limits.md): every limit, what counts, what resets.
3. [sessions-and-tokens.md](./sessions-and-tokens.md): rotation, grace,
   reuse, the per-request check.
4. [security.md](./security.md): each threat and the rule that handles it.
5. [in-the-code.md](./in-the-code.md): where each rule lives, and the tests
   that pin it down.

**"I'm deploying."**

1. [../setup/prepare-for-production.md](../setup/prepare-for-production.md):
   the whole path to a first deploy.
2. [sessions-and-tokens.md](./sessions-and-tokens.md#cross-site-setups):
   the web app and the API on their own domains. The most common way to
   break sign-in in production.
3. [emails.md](./emails.md) and [../setup/email.md](../setup/email.md): a
   real SMTP provider (required).
4. [operations.md](./operations.md): secrets to generate, key rotation, the
   command-line tools, monitoring, troubleshooting.

## Try it in five minutes

With the development stack running (`pnpm docker:dev`; the API on
`http://localhost:8888`, Mailpit on `http://localhost:8025`), sign up and
refresh with `curl`. A request without an `Origin` header, like these,
passes the Origin check, and `cookies.txt` plays the browser's part.

1. **Ask for a code.** The answer is `202` and an email goes to Mailpit:

   ```bash
   curl -i -X POST http://localhost:8888/api/v1/auth/email-code \
     -H 'Content-Type: application/json' \
     -d '{"email":"ada@example.com","language":"en"}'
   ```

2. **Read the code** at `http://localhost:8025`.
3. **Send it back**, which creates the account and signs you in. The access
   token is in the body, with `account: { created: true, completed: false }`;
   the refresh cookie goes into `cookies.txt`:

   ```bash
   curl -i -c cookies.txt -X POST http://localhost:8888/api/v1/auth/email-code/verify \
     -H 'Content-Type: application/json' \
     -d '{"email":"ada@example.com","code":"123456"}'
   ```

4. **Call a signed-in route** with the token:

   ```bash
   curl http://localhost:8888/api/v1/users/me -H 'Authorization: Bearer <access_token>'
   ```

5. **Refresh**: a new access token, and a new cookie (each refresh token
   works once):

   ```bash
   curl -i -b cookies.txt -c cookies.txt -X POST http://localhost:8888/api/v1/auth/refresh
   ```

6. **Sign out**, then try step 4 again: `401 AUTH_TOKEN_REVOKED`, reason
   `signed_out`.

   ```bash
   curl -i -b cookies.txt -c cookies.txt -X POST http://localhost:8888/api/v1/auth/logout
   ```

Try a wrong code in step 3 to see `400 AUTH_CODE_INVALID`, or a weak
password (`password`) at `POST /auth/reset-password` to see
`422 AUTH_PASSWORD_REJECTED` and its `data.rules`.
The interactive API docs are at `http://localhost:8888/api-docs`
([openapi.md](../openapi.md)).

## Every page in this set

| Page | Read it for |
|---|---|
| [concepts.md](./concepts.md) | Auth in plain words, and a glossary tied to the code. Start here if the words are new |
| [flows.md](./flows.md) | Every flow step by step, with diagrams: sign up or in with a code, sign in with a password, refresh, sign out, reset, change, Google, deletion |
| [sessions-and-tokens.md](./sessions-and-tokens.md) | Access token, refresh cookie, sessions, rotation, what ends a session, the per-request check, Redis down, cross-site setups |
| [passwords-and-codes.md](./passwords-and-codes.md) | The password rules, Argon2id, the six-digit emailed codes |
| [emails.md](./emails.md) | Every email, its two languages, the queue that sends them, Mailpit, editing the words and the layout |
| [google-sign-in.md](./google-sign-in.md) | How "Continue with Google" works, which account it lands in, adding another provider |
| [rate-limits.md](./rate-limits.md) | Every limit, and how to tune them |
| [security.md](./security.md) | The threats, how each is handled, what is not covered, production must-dos |
| [accounts.md](./accounts.md) | Account lifecycle: not completed, completed, deleted; roles |
| [api-reference.md](./api-reference.md) | Every route, body, answer and error code |
| [in-the-code.md](./in-the-code.md) | Module layout, ports and adapters, jobs, Redis keys, tables, tests, how to extend |
| [operations.md](./operations.md) | Production checklist, key rotation, command-line tools, monitoring, troubleshooting, FAQ |

Getting the keys from outside services (Google, an email provider) is in
[../setup/README.md](../setup/README.md).

## The settings at a glance

All in `.env.development` / `.env.production`; `.env.example` has every one
with a comment. Full list: [environment.md](../environment.md).

| Variable | Needed | What for |
|---|---|---|
| `JWT_SECRET` | always | Signs access tokens, keys the emailed-code hashes. `openssl rand -hex 32` |
| `BASE_URL` | production | The API's public address |
| `FRONTEND_URL` | production | The web app's address, for email links and the Google return |
| `CORS_ORIGINS` | production | The web app's exact origin(s) |
| `CORS_CREDENTIALS` | keep `true` | Without it the refresh cookie never arrives |
| `EMAIL_*` | production | SMTP; `EMAIL_HOST` is required in production |
| `SUPPORT_EMAIL` | recommended | Named in security emails |
| `AUTH_COOKIE_SAMESITE`, `AUTH_COOKIE_SECURE` | rarely | Only for a web app and API on different sites ([cross-site setups](./sessions-and-tokens.md#cross-site-setups)) |
| `JWT_ACCESS_TTL_SECONDS`, `AUTH_SESSION_TTL_DAYS` | optional | 900 seconds and 30 days by default |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional | Google sign-in, both or neither |
| `DELETED_ACCOUNT_RETENTION_DAYS` | optional | 30 days by default |
