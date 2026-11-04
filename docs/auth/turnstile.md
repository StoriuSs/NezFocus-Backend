# Turnstile: telling people from scripts

[Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) is a free
alternative to the "click all the traffic lights" CAPTCHA. A small widget on the
web page decides, usually without asking the person anything, whether a real
browser is in front of it, and hands the page a **token**. The page sends the
token with the form, and the API asks Cloudflare whether it is genuine.

The starter uses it on the forms a script would abuse: sign-up, forgot password,
and sign-in after a couple of wrong passwords. It is **optional and off by
default**. Read this page to decide whether to turn it on, to understand what
the API does with it, or to test with it. To get the keys, follow
[../setup/cloudflare-turnstile.md](../setup/cloudflare-turnstile.md).

- [Turning it on](#turning-it-on)
- [Which forms ask for it](#which-forms-ask-for-it)
- [How the API checks a token](#how-the-api-checks-a-token)
- [Why it fails closed](#why-it-fails-closed)
- [How it changes the limits](#how-it-changes-the-limits)
- [The order of checks](#the-order-of-checks)
- [Errors](#errors)
- [Testing and development](#testing-and-development)
- [What the web app does](#what-the-web-app-does)
- [Where it lives in the code](#where-it-lives-in-the-code)

## Turning it on

| Variable | What it is |
|---|---|
| `TURNSTILE_SITE_KEY` | Public. It goes to the browser, which uses it to draw the widget. |
| `TURNSTILE_SECRET_KEY` | Secret. Only the API uses it, to ask Cloudflare about a token. |

Both set: on. Both empty: off, and every form works without a token. One without
the other: the app refuses to start, naming the missing one.

The web app does not need its own copy of the site key: `GET /api/v1/auth/options`
answers `"turnstile_site_key": "0x4AAA..."` when Turnstile is on, or `null` when
it is off, and the React starter draws the widget only then.

Without Turnstile, the [rate limits](rate-limits.md) alone protect these forms.
That is enough for many apps. Turn it on when you see sign-up spam, email
bombing through "forgot password", or password spraying in the
`auth_events_total{event="login_failed"}` metric.

## Which forms ask for it

| Route | When a token is required |
|---|---|
| `POST /auth/register` | always |
| `POST /auth/forgot-password` | always |
| `POST /auth/login` | from the **third** attempt: once this address, or this IP, has 2 failed sign-ins in the current 15-minute window. Also whenever a token is sent, even if not required yet. |
| everything else | never: `resend-verification`, `verify-email`, `reset-password`, `login/2fa`, Google, and every signed-in route |

On sign-in, the person who types their password correctly the first time never
sees a challenge. After a failure that brings either count to 2, the 401
`AUTH_INVALID_CREDENTIALS` answer carries `data.captcha_required: true`, so the
page shows the widget **before** the next attempt instead of failing it. The
count of 2 is `CAPTCHA_AFTER_LOGIN_FAILURES` in
[rate-limits.ts](../../src/modules/auth/application/rate-limits.ts).

The other routes do not need it: they need something a script does not have (an
emailed code, a challenge from a correct password, a session), and they have
their own [limits](rate-limits.md).

The token goes in the body as `turnstile_token` (at most 2048 characters).

## How the API checks a token

For each required token, the API calls Cloudflare's siteverify endpoint,
`POST https://challenges.cloudflare.com/turnstile/v0/siteverify`, with the
secret key, the token and the client's IP, and waits at most **5 seconds**.

| Cloudflare's answer | Result |
|---|---|
| `success: true` | passes |
| no token, or a token over 2048 characters | 400 `AUTH_CAPTCHA_REQUIRED` or `AUTH_CAPTCHA_FAILED`, without asking Cloudflare |
| an error about the token (`invalid-input-response`, `timeout-or-duplicate`, ...) | 400 `AUTH_CAPTCHA_FAILED`: solve it again |
| an error about our request (`missing-input-secret`, `invalid-input-secret`, `bad-request`, `internal-error`) | 503 `AUTH_CAPTCHA_UNAVAILABLE`, and an error log "Turnstile refused the check itself (...): check TURNSTILE_SECRET_KEY" |
| no answer: network error, or slower than 5 s | 503 `AUTH_CAPTCHA_UNAVAILABLE`, and an error log "Turnstile could not be asked: ..." |

A token can be checked once. Cloudflare answers `timeout-or-duplicate` for a
token already used or older than 5 minutes, so a form that failed for another
reason needs a fresh token (the widget gives one).

## Why it fails closed

If Cloudflare cannot be asked, the API **refuses** the form (503) rather than
letting it through unchecked. An outage that stops sign-ups for a few minutes is
an ordinary outage that people notice and that ends. An outage that silently
turns the check off is a hole nobody notices, and a script can be waiting for
exactly that. A wrong `TURNSTILE_SECRET_KEY` shows up the same way, as 503s with
a log line naming it.

The rate limits make the opposite choice (they fail **open** when Redis is
down), because refusing every sign-in during a Redis outage would turn a partial
outage into a total one. [security.md](security.md) lists these trade-offs
together.

The 503 is not sent to Sentry (503s never are; the alerts and the log cover
the cause).

## How it changes the limits

With Turnstile on, two limits rise, on the **same counters**:

| Limit | Off | On | Why it can rise |
|---|---|---|---|
| `login-fail-email`: failed sign-ins per address | 5 per 15 min | 20 per 15 min | From the third failure every attempt needs a solved challenge, so a script cannot run up someone's count to lock them out, and a person who forgot their password gets more tries. |
| `register-ip`: sign-ups per IP | 5 per hour | 20 per hour | Every sign-up costs a solved challenge, so an office or school behind one IP is not stopped at the sixth person. |

The other limits do not change. All of them are on [rate-limits.md](rate-limits.md).

When Redis is down the limit counters read as zero, so sign-in does not demand a
token unless one is sent. Sign-up and forgot password still always require one.

## The order of checks

The order is chosen so that a solved challenge is never wasted and a script
cannot spend anyone's allowance:

- **Sign-up**: password rules → limits checked (not counted) → Turnstile →
  limits counted → the rest. A password the form must change, or a limit
  refusal, does not use up the person's token. The emails-per-address limits
  are counted only after the token passed, so a script that cannot solve
  challenges cannot exhaust an address's emails.
- **Forgot password**: limits checked → Turnstile → limits counted → the rest.
- **Sign-in**: limits checked → Turnstile (if required or sent) → the password.

## Errors

| Status | `meta.type` | Code | Meaning | What the page should do |
|---|---|---|---|---|
| 400 | `AUTH_CAPTCHA_REQUIRED` | 400106 | No token, and this form needs one now | Show the widget, submit again with its token |
| 400 | `AUTH_CAPTCHA_FAILED` | 400107 | Cloudflare did not accept the token | Reset the widget, let it solve again |
| 503 | `AUTH_CAPTCHA_UNAVAILABLE` | 503002 | Cloudflare could not be asked, or refused our secret | "Try again in a minute"; operators: check the log |
| 401 | `AUTH_INVALID_CREDENTIALS` with `data.captcha_required: true` | 401001 | Wrong email or password, and the next attempt needs a token | Show the widget now |

The complete error list is in [api-reference.md](api-reference.md).

## Testing and development

Cloudflare publishes test keys that work on any hostname, `localhost`
included, and always give the same answer:

| Purpose | `TURNSTILE_SITE_KEY` | `TURNSTILE_SECRET_KEY` |
|---|---|---|
| Always passes | `1x00000000000000000000AA` | `1x0000000000000000000000000000000AA` |
| Always fails | `2x00000000000000000000AB` | `2x0000000000000000000000000000000AA` |
| Forces an interactive challenge | `3x00000000000000000000FF` | — |
| "Token already spent" | — | `3x0000000000000000000000000000000AA` |

Pair test keys with test keys: test widgets produce the dummy token
`XXXX.DUMMY.TOKEN.XXXX`, which a real secret key rejects. With the always-passes
secret you can try the API by hand with that dummy token. If a key does not
behave as listed, check Cloudflare's
[testing page](https://developers.cloudflare.com/turnstile/troubleshooting/testing/):
it is the source of truth.

Ways to run it in development, in `.env.development`:

- **Off** (the default): leave both keys empty. Simplest.
- **Test keys**: the always-passes pair. The widget appears and solves itself,
  so you see the real page flow.
- **A real dev widget**: a separate Turnstile widget with `localhost` as its
  hostname. Do not add `localhost` to the production widget.

Tests:

- The API's integration tests start a local stand-in for siteverify and point
  the adapter at it (`verifyUrl`), so they never call Cloudflare
  (`test/integration/two-step-http.integration-spec.ts`).
- The React starter's end-to-end tests read the site key from
  `GET /auth/options`. They work with Turnstile off or with Cloudflare's test
  site keys, and stop with an explanation if the API has a real key, which a
  test browser may not pass.
- Load tests (k6) sign in with the right password, so they never meet the
  challenge, unless the password is wrong: two failures and every further
  sign-in from that IP needs a token k6 cannot solve. See
  [../load-testing.md](../load-testing.md).

## What the web app does

In the React starter:

- `src/features/auth/hooks/useTurnstile.tsx` and `src/features/auth/components/Turnstile.tsx`
  load Cloudflare's script (`https://challenges.cloudflare.com/turnstile/v0/api.js`)
  only when the API reports a site key, and render the widget full width. (The
  widget's mode, Managed, is chosen when you create it in Cloudflare's
  dashboard, not in code.)
- Sign-up and forgot password show it always; sign-in shows it after an answer
  with `captcha_required: true`, or a 400 `AUTH_CAPTCHA_REQUIRED` or
  `AUTH_CAPTCHA_FAILED`.
- If you set a Content-Security-Policy on the web app, allow
  `https://challenges.cloudflare.com` for scripts and frames.
- Ad and tracker blockers sometimes block that script; the page says so and
  suggests allowing it.

## Where it lives in the code

| File | What it does |
|---|---|
| [turnstile-captcha.adapter.ts](../../src/modules/auth/infrastructure/adapters/turnstile-captcha.adapter.ts) | Calls siteverify; decides passed, failed or unavailable |
| [captcha-check.ts](../../src/modules/auth/application/services/captcha-check.ts) | Turns that into the three errors; "on" means a site key is set |
| [login.handler.ts](../../src/modules/auth/application/commands/login/login.handler.ts) | When sign-in needs a token |
| [register.handler.ts](../../src/modules/auth/application/commands/register/register.handler.ts), [forgot-password.handler.ts](../../src/modules/auth/application/commands/forgot-password/forgot-password.handler.ts) | The order of checks |
| [rate-limits.ts](../../src/modules/auth/application/rate-limits.ts) | The raised limits and `CAPTCHA_AFTER_LOGIN_FAILURES` |
