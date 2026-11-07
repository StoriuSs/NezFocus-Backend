# The security model

This page answers "what stops an attacker from...?" for the auth module, in one
place. Each row names a threat, what the starter does about it, and where to
read more. It also lists what is kept out of logs and error reports, what the
starter deliberately does **not** cover, and the settings production must get
right.

Read it before going live, when a security reviewer asks how something is
handled, or before you change a rule that looks inconvenient: most of them are
there for a reason given below. Words like "hashing", "HMAC", "CSRF" and
"enumeration" are explained in [concepts.md](concepts.md).

- [Threats and defences](#threats-and-defences)
- [Secrets at rest](#secrets-at-rest)
- [What is kept out of logs and Sentry](#what-is-kept-out-of-logs-and-sentry)
- [Fail open or fail closed](#fail-open-or-fail-closed)
- [What is not covered](#what-is-not-covered)
- [Production must-dos](#production-must-dos)

## Threats and defences

### Guessing and abuse

| Threat | Defence | More |
|---|---|---|
| **Password guessing** on one account | 5 failed sign-ins per address per 15 minutes, then 429. Argon2id makes each guess cost about 19 MiB of memory and real CPU time, so offline guessing of a stolen hash is slow too. | [rate-limits.md](rate-limits.md), [passwords-and-codes.md](passwords-and-codes.md) |
| **Credential stuffing and password spraying**: leaked passwords from other sites, or one common password tried on many accounts | 30 failed sign-ins per IP per 5 minutes across all addresses, a short window so a shared network (a lab, a hall) waits minutes, not an hour (D-135); each account is still held to 5 failures per address per 15 minutes, whatever the IP; new passwords must pass the policy (no common-password list, D-29); the `AuthFailedLoginSpike` alert (more than 50 failures in 10 minutes). | [rate-limits.md](rate-limits.md) |
| **Account enumeration**: finding out which addresses have accounts | One error, `AUTH_INVALID_CREDENTIALS`, for a wrong password, an unknown address and an account without a password, in the same time (an unknown address still runs a dummy Argon2 check). Asking for a code and forgot password answer the same 202 for every address, and do the same work: every address gets a code (a reset code for an address with no account is stored and sent to nobody, so it wears out like a real one, D-121); only the email's wording differs. At reset, "the password is your username" is said only after the right code (D-66). Limits keyed on an address count whether or not it exists. | [flows.md](flows.md) |
| **Guessing an emailed code** | 6 random digits, valid 10 minutes, 5 wrong guesses per code (counted atomically, so parallel guesses each count), only the newest code works, 30 wrong codes per IP per 5 minutes across all addresses (D-135), and 10 wrong codes per address per hour across its codes, whatever the IP (D-134). Codes are compared in constant time. | [passwords-and-codes.md](passwords-and-codes.md) |
| **Mail bombing**: making the API email someone over and over | 1 code email per address per minute and 5 per hour; 30 per IP per 5 minutes (D-135). | [rate-limits.md](rate-limits.md) |
| **Floods** of requests | The global throttler, per route per `THROTTLE_TTL`, before authentication runs: `THROTTLE_LIMIT` requests per signed-in user, `THROTTLE_ANONYMOUS_LIMIT` per IP for requests without a valid access token (a forged or expired token counts as none, D-135). Bounded inputs (passwords at most 1024 characters, new ones at most 128) keep one request cheap. | [rate-limits.md](rate-limits.md#the-global-throttler) |

### Stolen tokens and cross-site attacks

| Threat | Defence | More |
|---|---|---|
| **Stolen access token** | It lives 15 minutes (`JWT_ACCESS_TTL_SECONDS`) and carries no roles or email. Every request also checks the session and the user (Redis, then Postgres), so signing out, a password change or a deletion stops it on the next request, not when it expires. | [sessions-and-tokens.md](sessions-and-tokens.md) |
| **Stolen refresh cookie** | httpOnly (no script can read it), scoped to `/api/v1/auth`, single use: each refresh replaces it. Presenting a used one (outside a 10-second window for two tabs refreshing at once) is treated as theft: the whole session ends, the event is reported to Sentry, and the `AuthRefreshTokenReuse` alert fires. Sessions end after `AUTH_SESSION_TTL_DAYS` (30) however often they are refreshed. | [sessions-and-tokens.md](sessions-and-tokens.md) |
| **XSS** (a script injected into the web app) stealing tokens | The React starter keeps the access token in memory only, never in `localStorage`; the refresh token is in an httpOnly cookie. An injected script can still act as the user while the page is open, but cannot carry the session away. Preventing XSS itself is the web app's job (React escaping, a Content-Security-Policy). | [sessions-and-tokens.md](sessions-and-tokens.md) |
| **CSRF**: another site making the browser send a request with the user's cookie | Signed-in routes need the `Authorization: Bearer` header, which a browser never adds by itself, so CSRF cannot reach them. The two cookie-authenticated routes (`refresh` and `logout`) rely on `SameSite` (Lax by default) **and** check the `Origin` header against `CORS_ORIGINS` (403 `AUTH_FORBIDDEN` otherwise), the lock that still holds with `SameSite=None`. | [sessions-and-tokens.md](sessions-and-tokens.md) |
| **Login CSRF through Google**: being signed in to the attacker's account | The `state` returned by Google must equal the `oauth_state` cookie set when this browser started; the attempt is used once; PKCE and the nonce tie the code and the ID token to it. | [google-sign-in.md](google-sign-in.md#the-safety-checks-one-by-one) |
| **Session fixation** | A session is created by the server at sign-in, with a new random id and refresh token; the client cannot supply or reuse one. | [sessions-and-tokens.md](sessions-and-tokens.md) |
| **Open redirect** after sign-in | `?redirect=` must be a path on the web app (no `//`, `\` or control characters), checked by the API and again by the web app. | [google-sign-in.md](google-sign-in.md#the-safety-checks-one-by-one) |

### Taking over accounts

| Threat | Defence | More |
|---|---|---|
| **Pre-registering a victim's address**, then waiting for them to sign in with Google | There is nothing to pre-register: an account is only made once its address is confirmed, by a right emailed code or by a provider that verified it (D-133). No account waits on an address with a password its owner did not set. | [google-sign-in.md](google-sign-in.md#which-account-a-google-sign-in-lands-in), [accounts.md](accounts.md) |
| **Unverified provider email** | Google (or any provider) can create or link an account only for an address it says it verified; links are keyed on Google's stable `sub`, not the email. | [google-sign-in.md](google-sign-in.md) |
| **A phished or reused password** | The owner is emailed when the password changes, a password is added, Google sign-in is added, and when the account is deleted. Changing the password ends every other session; resetting it ends all of them, and a sign-in with the old password racing the reset opens no session. | [emails.md](emails.md) |
| **Someone at an unlocked computer** | A session alone is not enough for the dangerous actions: changing the password needs the current one; adding a first password needs an emailed code ("forgot password"), except in "complete your account", which a not-completed account must do before anything else; deleting the account needs the password. | [accounts.md](accounts.md) |
| **Deleted account still signed in** | Deletion ends every session at once, and the per-request check refuses a deleted user even if that failed. | [../account-deletion.md](../account-deletion.md) |
| **Reading codes from the queue dashboard** | Emails are queued, and a waiting or failed code email holds the code. `/admin/queues` is always behind basic auth, and production refuses to start with the default `BULL_BOARD_PASSWORD`. | [emails.md](emails.md) |

### Leaks

| Threat | Defence | More |
|---|---|---|
| **A copy of the database** (a stolen backup) | No secret in it is usable on its own; see [Secrets at rest](#secrets-at-rest). | below |
| **Leaked logs or error reports** | Credentials, codes, tokens and the auth body fields are redacted, URL query values included; see [below](#what-is-kept-out-of-logs-and-sentry). | below |
| **Leaked `JWT_SECRET`** | Anyone holding it can sign access tokens, but a token still needs a live session id and the matching user to pass the per-request check. Replace the secret (`openssl rand -hex 32`): every access token stops working at once, sessions carry on through refresh, and pending emailed codes stop working too (they are keyed with it). | [operations.md](operations.md) |

## Secrets at rest

What a copy of the database holds, and why it is not enough:

| Secret | Stored as | Needs, to be useful |
|---|---|---|
| Password | Argon2id hash (19 MiB, 2 passes), parameters in the string | Guessing, slowly, one account at a time |
| Refresh token | SHA-256 of 32 random bytes | Nothing to guess: 256 random bits |
| Emailed code | HMAC-SHA256 keyed with `JWT_SECRET`, over purpose, address and code | `JWT_SECRET`, and 10 minutes |
| Google link | Google's `sub` only, never a Google token | — |
| Rate-limit counters (Redis) | `rl:<name>:<SHA-256 of the address or IP>` | — |

So keep `JWT_SECRET` out of the database backups' reach: in the env file and your password manager, not next to the dumps.

Not secret, and stored in clear: email addresses, names and other profile
fields, and each session's IP address and user agent (512 characters at most).
A deleted account's personal fields are erased after
`DELETED_ACCOUNT_RETENTION_DAYS` ([../account-deletion.md](../account-deletion.md)).

## What is kept out of logs and Sentry

One list, [sensitive-fields.ts](../../src/shared/constants/sensitive-fields.ts),
feeds both the logger and Sentry, so a field cannot be hidden from one and
forgotten in the other.

| Kind | Names | Where they are replaced with `[REDACTED]` |
|---|---|---|
| Request headers | `authorization`, `proxy-authorization`, `cookie`, `x-api-key`, `idempotency-key` | logs, Sentry |
| Response headers | `set-cookie` | logs, Sentry |
| Body fields | `password`, `confirmPassword`, `oldPassword`, `newPassword`, `currentPassword`, `token`, `refreshToken`, `accessToken`, `code`, `secret`, `state` | logs (camelCase and snake_case, so `current_password` and `new_password` too), Sentry (any case, with or without `-` and `_`) |
| URL query values | any parameter with one of the names above, notably Google's `code` and `state` on `/auth/google/callback` | the request log line, error log lines, the `data.path` of error envelopes, Sentry's URL, query string and breadcrumbs |

Beyond the list:

- **Request bodies are not logged at all.** The request log has the method,
  the URL (redacted), the status, the duration and the request id. The body
  redaction is a second line of defence.
- **Sentry** is sent no IP addresses and no cookies (`sendDefaultPii: false`),
  never the values of local variables, and only the user's id. It receives
  server faults (5xx, except 503) and the explicit refresh-reuse report, never
  the ordinary 4xx auth errors. Failed queue jobs are reported with the queue
  and job name, without the job's data (which would hold the code and the
  address).
- **What remains visible on purpose:** user ids and session ids in log lines,
  and error messages, which never say whether an address exists.
- **Not covered by redaction:** the queue dashboard (`/admin/queues`) shows
  job data, codes included, to whoever passes its basic auth.

Add a new secret field name to `SENSITIVE_BODY_FIELDS` when you add one to an
API. [../logging.md](../logging.md) and [../error-tracking.md](../error-tracking.md)
describe the pipelines.

## Fail open or fail closed

When a dependency is down, each check either lets requests through (fails open)
or refuses them (fails closed). The choices:

| Check | When its dependency is down | Why |
|---|---|---|
| Auth rate limits (Redis) | **closed** (D-137): `503 SERVICE_UNAVAILABLE_ERROR` on the routes that count one (sign-in, codes, reset, change password, delete account), logged once a minute | They are what stops guessing at codes and passwords; let through uncounted, a client could ask for a new code every request and guess five times at each. The cost: nobody can sign in while Redis is down. Signed-in sessions carry on, and the `RedisDown` alert fires. |
| Global throttler (Redis) | **open**: requests are allowed, logged once a minute | It counts every route; refusing them all would turn a Redis outage into a total one. |
| Session check (Redis) | falls back to Postgres | Redis is an accelerator here, not the source of truth. |
| Google sign-in (Redis) | **closed**: 500 or `?error=failed` | There is nowhere else to keep them. Passwords keep working. |

## What is not covered

Know these before you promise anything to your users:

- **No audit log.** Sign-ins, failures and changes are counted in metrics
  (`auth_events_total`) and some are logged, but there is no table of "who did
  what, when" and no per-user sign-in history.
- **No list of devices.** Sessions are stored with IP and user agent, but there
  is no route to list them or end one; only "sign out everywhere".
- **No "new sign-in" email** for a new device or location, and no email about
  failed sign-in attempts.
- **No second sign-in step**: no authenticator-app codes, no passkeys or
  security keys (WebAuthn), no SMS codes. One emailed code, a password, or Google is enough.
- **No breached-password check** against an online list such as Have I Been
  Pwned, and no local common-password list either (D-29).
- **No idle timeout.** A session lasts `AUTH_SESSION_TTL_DAYS` from sign-in,
  used or not; the 15-minute access token is the only short clock.
- **No route to change the email address**, and none to unlink Google.
- **No admin interface** for users or roles: `pnpm user:promote` from the
  command line.
- **No IP reputation, geo-blocking or DDoS protection.** That belongs in front
  of the API (Cloudflare, nginx).
- **No signing keys others can verify.** Access tokens are HS256 with a shared
  secret: another service can only verify them by holding `JWT_SECRET` (which
  also lets it mint them).
- **No sign-in while Redis is down.** The auth limits fail closed (D-137), so
  signing in, codes and password changes answer 503 until it is back; the
  global throttler is off meanwhile. See above.
- **The web app's own defences** (Content-Security-Policy, dependency hygiene)
  are the React starter's to keep.

## Production must-dos

The full checklist, with commands, is in [operations.md](operations.md). The
security-critical part:

1. **`JWT_SECRET`**: `openssl rand -hex 32`, different in every environment.
   Production refuses known weak values and the template's placeholder.
2. **HTTPS end to end.** Cookies are `Secure` by default in production; do not
   set `AUTH_COOKIE_SECURE=false` there.
3. **`CORS_ORIGINS`**: exactly the web app's origin(s), such as
   `https://app.example.com`. It is also the allowlist for the `Origin` check on
   cookie routes. `CORS_CREDENTIALS` must stay `true` (production requires it).
4. **`AUTH_COOKIE_SAMESITE`**: keep `lax` when the web app and API share a
   registrable domain (`app.example.com` and `api.example.com`); use `none` only
   when they do not.
5. **`FRONTEND_URL`** set (production requires it): emails and Google redirects
   point there.
6. **Real SMTP** with SPF, DKIM and DMARC on your domain, so codes arrive and
   your domain cannot easily be spoofed in phishing.
7. **`BULL_BOARD_PASSWORD`** and **`REDIS_PASSWORD`** strong (production
   refuses weak ones), and the queue dashboard not shared widely: it shows codes.
8. **One proxy hop.** The app trusts exactly one proxy (`trust proxy 1`) to get
   the client IP that the limits key on. If you add Cloudflare's proxy in front
   of nginx, make nginx pass the real client IP on, or every visitor shares one
   IP ([../server.md](../server.md)).
9. **Sentry and the alert webhook** configured, so a refresh-token reuse or a
   login spike reaches a person.
10. **`APP_NAME`** and **`SUPPORT_EMAIL`** set: the first is what email
    subjects show; the second tells people who to contact when something they
    did not do happens to their account.
