# Running auth in production

What the person who deploys and looks after the API needs to know about
sign-in: what to set before the first deploy, how to change the two keys
safely, the command-line tools, what to watch, and what to do when something
goes wrong. You do not need to have built the module; you do need shell access
to the server.

The server commands below assume the standard setup: the repository checked
out on the server, `.env.production` beside it, and the stack started from
`docker-compose.prod.yaml` ([deploy.md](../deploy.md)). Every `docker compose`
command passes `--env-file .env.production`: compose reads it to fill in
`${...}` values (Redis's password, for one) even for `exec`, and refuses to
run without them.

- [Before the first deploy](#before-the-first-deploy)
- [The auth settings](#the-auth-settings)
- [Changing JWT_SECRET](#changing-jwt_secret)
- [Changing the encryption key](#changing-the-encryption-key)
- [The command-line tools](#the-command-line-tools)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)
- [Questions people ask](#questions-people-ask)

## Before the first deploy

Tick each one. Most are refused at start-up when wrong (the app prints which
variable and why), but the ones marked **not checked** only show up when
someone tries to sign in.

**Secrets to generate.** Each is a fresh random value, never one from
`.env.example`, never the same in two environments:

```bash
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # AUTH_ENCRYPTION_KEY (a different run)
```

- [ ] `JWT_SECRET`: at least 32 characters. Production refuses weak values
      (`password`, `changeme`, ...) and the template's `your_...` placeholder.
      It signs access tokens and keys the emailed codes.
- [ ] `AUTH_ENCRYPTION_KEY`: 64 hex characters or more. Production refuses the
      template's all-zero key. It seals every two-step secret.
- [ ] **A copy of `AUTH_ENCRYPTION_KEY` outside the server** (a password
      manager), **not checked**. Lose it and everyone with two-step sign-in on
      is locked out at the second step ([below](#two-step-sign-in-unavailable)).
      A database backup is useless for those accounts without it.
- [ ] `AUTH_ENCRYPTION_KEY_PREVIOUS` empty: it is only for the middle of a
      key change.
- [ ] `BULL_BOARD_PASSWORD` strong. The queue dashboard at `/admin/queues`
      shows each pending email's job data, and sign-up and reset codes are in
      it in clear: whoever can open it can reset any password.

**Addresses.**

- [ ] `BASE_URL`: the API's public address, `https://api.example.com`, no
      trailing slash. It is the access tokens' issuer and audience, and the
      base of Google's redirect URI.
- [ ] `FRONTEND_URL`: the web app's address, `https://app.example.com`
      (required in production). Email links and Google's return go there.
- [ ] `CORS_ORIGINS`: the web app's exact origin, `https://app.example.com`:
      scheme included, no path, no trailing slash, comma-separated if several,
      **not checked**. Refresh and sign-out refuse any other origin.
- [ ] `CORS_CREDENTIALS` true (production refuses false).
- [ ] The web app and the API on the **same site** (`app.example.com` and
      `api.example.com` under one domain), **not checked**. Then the default
      `AUTH_COOKIE_SAMESITE=lax` works. On two different domains, read
      [cross-site cookies](./sessions-and-tokens.md) first: it needs
      `AUTH_COOKIE_SAMESITE=none`, and some browsers block such cookies anyway.

**Outside services.**

- [ ] Email: `EMAIL_HOST` (required in production), `EMAIL_PORT`,
      `EMAIL_SECURE`, `EMAIL_USER`, `EMAIL_PASSWORD`, and `EMAIL_FROM_ADDRESS`
      on a domain with SPF and DKIM set up, **not checked**. Nobody can sign up
      without the emailed code ([../setup/email.md](../setup/email.md)).
- [ ] Google (optional): `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, the
      redirect URI `https://api.example.com/api/v1/auth/google/callback`
      registered exactly, and the consent screen published (In production),
      **not checked** ([../setup/google-sign-in.md](../setup/google-sign-in.md)).
- [ ] Turnstile (optional): `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`
      from a widget whose hostnames include the web app's
      ([../setup/cloudflare-turnstile.md](../setup/cloudflare-turnstile.md)).
- [ ] `SUPPORT_EMAIL` (optional): named in the "two-step sign-in was turned
      on or off" and "account deleted" emails, where only a person can help.
- [ ] `APP_NAME`: the name authenticator apps list the account under, and in
      every email subject. Set it before people turn two-step sign-in on:
      entries already in their apps keep the old name.

**The server.**

- [ ] nginx in front of the app, as `nginx/bootstrap-nginx.sh` sets it up
      ([server.md](../server.md)). The app trusts exactly one proxy hop to tell
      it the client's IP, and every per-IP limit depends on it
      ([429s for everyone](#troubleshooting)).
- [ ] The server's clock synchronised (`timedatectl` shows
      `System clock synchronized: yes`). Two-step codes are time-based: a
      clock more than about 30 seconds off refuses right codes.

**After deploying**, with a real address:

- [ ] Sign up, receive the code, confirm: you are signed in.
- [ ] Reload the web app: you are still signed in (the refresh cookie works).
- [ ] Wait 16 minutes, use the app: still signed in (refresh works after the
      first access token expired).
- [ ] Sign in with Google, if on.
- [ ] Turn two-step sign-in on and off on a test account, and run
      `auth:rotate-key` once ([below](#the-command-line-tools)) so you have
      seen it work before you need it.
- [ ] Make yourself an administrator with `user:promote`, if your app has
      admin routes.

The whole first deploy, every service included, is in
[../setup/prepare-for-production.md](../setup/prepare-for-production.md).

## The auth settings

The variables the auth module reads. Every variable, with validation details,
is in [environment.md](../environment.md#authentication). Where they are used:
[sessions-and-tokens.md](./sessions-and-tokens.md),
[two-step-sign-in.md](./two-step-sign-in.md), [turnstile.md](./turnstile.md),
[google-sign-in.md](./google-sign-in.md).

| Variable | Default | Production | Changing it later |
|---|---|---|---|
| `JWT_SECRET` | none: required | At least 32 characters, not weak, not the placeholder | Every access token and every pending emailed code stops working. [Changing JWT_SECRET](#changing-jwt_secret) |
| `JWT_ACCESS_TTL_SECONDS` | `900` | 60 to 3600 | Applies to new tokens |
| `AUTH_SESSION_TTL_DAYS` | `30` | 1 to 365 | Applies to new sessions; existing ones keep their end |
| `AUTH_COOKIE_SAMESITE` | `lax` | `lax`, `strict` or `none` | Applies to the next cookie set (next refresh) |
| `AUTH_COOKIE_SECURE` | on in production, or with `none` | Cannot be `false` with `none` | |
| `AUTH_ENCRYPTION_KEY` | none: required | 64+ hex characters, not all zeros | Only as in [changing the encryption key](#changing-the-encryption-key) |
| `AUTH_ENCRYPTION_KEY_PREVIOUS` | empty | Not all zeros; never the same as the current key | During a key change only |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | empty (off) | Both or neither | Emptying both turns Google off; people with no password must then use "forgot password" |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | empty (off) | Both or neither | Takes effect at restart |
| `BASE_URL` | `http://localhost:<PORT>` | The public `https://` address | Access tokens become invalid (clients refresh); Google's redirect URI changes: register the new one |
| `FRONTEND_URL` | `http://localhost:3001` | Required | Email links and Google's return |
| `CORS_ORIGINS` | `http://localhost:3001` | The web app's exact origin(s) | |
| `CORS_CREDENTIALS` | `true` | Must be true | |
| `APP_NAME` | `Test App` | Your product's name | New two-step entries and emails only |
| `SUPPORT_EMAIL` | empty | Recommended | |
| `UNVERIFIED_ACCOUNT_RETENTION_DAYS` | `7` | At least 1 | |
| `DELETED_ACCOUNT_RETENTION_DAYS` | `30` | At least 0 | |
| `THROTTLE_TTL`, `THROTTLE_LIMIT` | `60`, `100` | | The global per-IP-per-route throttler ([rate-limits.md](./rate-limits.md)) |
| `EMAIL_*` | Mailpit in development | `EMAIL_HOST` required | |

Not configurable, by design: code lifetime 10 minutes, 5 tries per code, the
10-second refresh grace, 10 minutes for a Google sign-in, 5 minutes and 5
tries for a second step, and every auth rate limit
([rate-limits.md](./rate-limits.md) says where to change them in code).

**Applying a change.** Edit `.env.production` on the server, then redeploy:
`./deploy.sh`, or `./deploy.sh --skip-build` when only the env file changed
and the server builds its own image ([deploy.md](../deploy.md)). With more
than one app instance, every instance must have the same `JWT_SECRET`,
`AUTH_ENCRYPTION_KEY` and `BASE_URL`.

## Changing JWT_SECRET

Do it if the secret may have leaked (it was in a commit, a screenshot, a
former colleague's laptop). There is no "previous secret": the change is
immediate.

What happens:

| | Effect |
|---|---|
| Access tokens | Every one is refused with `401 AUTH_TOKEN_INVALID`. Clients refresh and carry on, once each |
| Sessions and refresh cookies | **Unaffected**: refresh tokens are random values stored as plain SHA-256 hashes, not signed with the secret. Nobody is signed out |
| Emailed codes | Every pending code stops working (`400 AUTH_CODE_INVALID`): they are stored as an HMAC keyed with the secret. Anyone mid-sign-up or mid-reset asks for a new one |
| Two-step sign-in | Unaffected: it uses `AUTH_ENCRYPTION_KEY` |

Steps:

1. `openssl rand -hex 32`.
2. Put it in `JWT_SECRET` in `.env.production`.
3. Redeploy. Expect a short burst of refreshes as every open tab gets a new
   access token.

If you also want everyone signed out (the leak may have been used), end every
session as in [the FAQ](#how-do-i-sign-everyone-out).

## Changing the encryption key

`AUTH_ENCRYPTION_KEY` seals each authenticator secret (AES-256-GCM) and keys
the fingerprints of recovery codes. Each sealed value records which key made
it, so a server holding both the old and the new key can read both. That is
how the key changes without locking anyone out. The mechanism is in
[two-step-sign-in.md](./two-step-sign-in.md).

For a key that may have leaked, or a routine change:

1. Generate a new key: `openssl rand -hex 32`.
2. In `.env.production`, **move** the current key to
   `AUTH_ENCRYPTION_KEY_PREVIOUS` and put the new one in `AUTH_ENCRYPTION_KEY`.
   Redeploy. From now on new secrets are sealed with the new key; the old key
   still opens what it sealed, and each secret is sealed again with the new
   key the next time its owner signs in.
3. Seal the rest now, and see what still needs the old key:

   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yaml exec app \
     node dist/src/bootstrap/rotate-encryption-key.js
   ```

4. Read the output:
   - `✓ N two-step secret(s): N sealed again with the current key.` Done for
     the secrets.
   - `✓ Nothing needs AUTH_ENCRYPTION_KEY_PREVIOUS any more: empty it, and
     restart the app.` Empty it and redeploy. Finished.
   - `! Keep AUTH_ENCRYPTION_KEY_PREVIOUS: N account(s) have recovery codes
     that may need it.` Recovery codes cannot be re-sealed (only their
     fingerprints exist, and the codes themselves are needed to remake them).
     Keep the previous key until those codes are used or replaced. If you
     empty it anyway, those recovery codes stop working (the app codes keep
     working), and their owners get new ones from settings
     (`POST /auth/2fa/recovery-codes`).
   - `✗ N account(s) have a secret sealed with a key this server does not
     have.` See the next section.

The command is safe to run any number of times, and while the app serves
requests: a secret is replaced only if it has not changed since it was read.
It exits with code 1 when any account cannot be read.

Keep each retired key with the backups made while it was current: restoring
an old dump brings back secrets sealed with it, and they need it as
`AUTH_ENCRYPTION_KEY_PREVIOUS` ([backups.md](../backups.md)).

<a id="two-step-sign-in-unavailable"></a>
### If the key was lost, or changed without step 2

Everyone with two-step sign-in on is refused at the second step with
`503 AUTH_TWO_FACTOR_UNAVAILABLE` ("Two-step verification can't be checked for
this account right now. Contact support."), and the API logs an error naming
the user and what to do. Nothing is used up and no wrong code is counted.

- **The old key still exists somewhere** (a backup of the env file, a password
  manager): set it as `AUTH_ENCRYPTION_KEY_PREVIOUS`, redeploy, and carry on
  from step 3 above.
- **It is gone for good**: those secrets can never be read again. Turn
  two-step sign-in off for the accounts concerned; each owner is emailed and
  can turn it on again in settings. Their password and sessions are left
  alone.

  ```bash
  # who it would be
  docker compose --env-file .env.production -f docker-compose.prod.yaml exec app \
    node dist/src/bootstrap/two-factor-off.js --unreadable
  # do it
  docker compose --env-file .env.production -f docker-compose.prod.yaml exec app \
    node dist/src/bootstrap/two-factor-off.js --unreadable --yes
  ```

`--unreadable` also catches secrets that fail their integrity check (changed
by hand in the database).

## The command-line tools

Each runs on your machine with `pnpm` (it reads `.env.development`, or
`.env.<NODE_ENV>`, and needs the database reachable), and on the server inside
the running app container with `node dist/src/bootstrap/<file>.js`.

| What | On your machine | On the server |
|---|---|---|
| Re-seal two-step secrets after a key change | `pnpm auth:rotate-key` | `docker compose --env-file .env.production -f docker-compose.prod.yaml exec app node dist/src/bootstrap/rotate-encryption-key.js` |
| Turn two-step sign-in off for one account | `pnpm auth:two-factor:off you@example.com` | `docker compose --env-file .env.production -f docker-compose.prod.yaml exec app node dist/src/bootstrap/two-factor-off.js you@example.com` |
| ... for every account whose secret cannot be read | `pnpm auth:two-factor:off --unreadable [--yes]` | `docker compose --env-file .env.production -f docker-compose.prod.yaml exec app node dist/src/bootstrap/two-factor-off.js --unreadable [--yes]` |
| Give a role (default `admin`) | `pnpm user:promote you@example.com [--role editor]` | `docker compose --env-file .env.production -f docker-compose.prod.yaml exec app node dist/src/bootstrap/user-roles.js you@example.com [--role editor]` |
| Take a role away | `pnpm user:promote you@example.com --remove [--role editor]` | `docker compose --env-file .env.production -f docker-compose.prod.yaml exec app node dist/src/bootstrap/user-roles.js you@example.com --remove` |
| Rebuild the common-password list | `pnpm passwords:generate [file]` | (development only: commit the generated file) |

**`auth:two-factor:off <email>`** is for someone who lost both their phone and
their recovery codes. **Be sure it is them by other means first** (it removes
the protection that would stop someone who only has their password). It
deletes the account's secret and recovery codes, queues the "two-step
verification was turned off" email (so a real owner who did not ask finds out
at once), and leaves the password and sessions alone. It prints:

- `✓ you@example.com: two-step sign-in is off, and they are emailed.`
- `⚠ ...: two-step sign-in is off, but the email could not be queued (Redis). Tell them.`
- `✗ No account uses you@example.com` or `✗ you@example.com does not have two-step sign-in on`

**`user:promote`** adds `admin` (or `--role <name>`: lower case, letters,
digits, `_` and `-`) to the account's `roles`; `--remove` takes it away; the
`user` role is never removed. It applies from the user's next request (it
drops their cached copy in Redis; if Redis cannot be reached, within 5
minutes). Nothing else in the app grants roles ([accounts.md](./accounts.md)).

## Monitoring

What the auth module reports, and what to do about it. How the stack works:
[monitoring.md](../monitoring.md) and [alerts.md](../alerts.md).

**The dashboard.** Grafana → NestJS API → the "Sign-in and accounts" row:
sign-ins, failed sign-ins, requests refused by the limits, refresh-token
reuse, and over time, sign-in attempts and account changes (two-step on and
off, resets, deletions). All of it is `auth_events_total{event}`
([in-the-code.md](./in-the-code.md#metrics-alerts-and-logs) lists the events).

**Alerts.**

| Alert | Means | Do |
|---|---|---|
| `AuthFailedLoginSpike` (more than 50 failed sign-ins in 10 minutes) | Someone is probably guessing passwords across many addresses or IPs. The per-address and per-IP limits slow each source; this sees the total | Look at the "Failed sign-ins" and "Refused by the limits" panels and the API logs for the IPs. Consider turning Turnstile on. Raise the threshold in `monitoring/prometheus/rules/app.yml` if your user base makes 50 normal |
| `AuthRefreshTokenReuse` | A refresh token came back after it was replaced, and the app ended that session. Usually a stolen cookie; sometimes a device restoring an old one | Sentry has the user id and session id (tag `auth: refresh-reuse`). Contact the user if it repeats; check for an XSS hole or a compromised device |
| `AppErrorLogs` (any error line) | Among other things, the auth errors below | Read the line |

**Log lines that need a person.** In Grafana → NestJS Logs, or Loki with
`{service="app"} |= "<text>"`.

| Line contains | Means | Do |
|---|---|---|
| `Two-step sign-in cannot be checked for user` | That user's secret was sealed with a key this server lacks | [If the key was lost](#two-step-sign-in-unavailable) |
| `Turnstile could not be asked` | The API cannot reach `challenges.cloudflare.com` (5-second timeout). Sign-ups and forgot-password are refused with 503 meanwhile | Check outbound HTTPS from the server and Cloudflare's status |
| `Turnstile refused the check itself (...): check TURNSTILE_SECRET_KEY` | Cloudflare rejected the secret key | Copy the secret key again from the widget the site key belongs to |
| `sign-in did not complete` (warn) | A Google return failed, with the reason (`state does not match`, `no attempt with this state`, `the code could not be redeemed: ...`) | Only worth acting on if it repeats; see [troubleshooting](#troubleshooting) |
| `sign-in failed:` (error) | A Google return failed on the database or Redis | Check those |
| `an account deletion's event was not handled` | The hourly clean-up finished a deletion whose event was lost (a crash at the wrong moment). Nothing was exposed meanwhile | None, unless it repeats |
| `Session cache unavailable, reading from the database` | Redis is down; sign-in checks fall back to Postgres | Fix Redis (`RedisDown` will be firing) |
| `Rate limiting unavailable, allowing the request` | Redis is down; **auth limits are off** until it is back | Fix Redis |
| A failed `send-code` job (queue dashboard, or Sentry) | An email with a code could not be sent after 3 tries (about 15 seconds) | Check SMTP; the person must ask for a new code |

To see auth refusals by type over the last hour, in Loki:

```
sum by (statusCode) (count_over_time({service="app"} | json | url=~"/api/v1/auth/.*" | statusCode >= 400 [1h]))
```

Secrets do not reach the logs: request bodies are never logged, and Google's
`code` and `state` are redacted from logged URLs.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Sign-in works, but everyone is signed out after about 15 minutes, or on every reload | The refresh cookie is not sent back. Usually the web app and API are on **different sites** (`example-app.com` and `example-api.com`), so `SameSite=Lax` keeps the browser from sending it; or the web app calls refresh without credentials; or `Secure` is on over plain http | Put both on one domain (`app.example.com`, `api.example.com`). Otherwise `AUTH_COOKIE_SAMESITE=none` over HTTPS ([sessions-and-tokens.md](./sessions-and-tokens.md)). In the browser's network tab, the refresh request must carry a `Cookie` header; the login response's `Set-Cookie` shows a warning icon when the browser dropped it |
| `403 AUTH_FORBIDDEN` on `/auth/refresh`, `/auth/logout` or `/auth/login/2fa` | The page's origin is not in `CORS_ORIGINS` | Add the exact origin (`https://app.example.com`: scheme, no trailing slash) and redeploy. A `www.` variant is a different origin |
| The browser console says a CORS request was blocked (credentials) | `CORS_ORIGINS` does not list the page's origin, or `CORS_CREDENTIALS` is off | As above |
| No sign-up or reset email arrives | SMTP settings, or the email is in spam, or the per-address limit was hit | Open `/admin/queues`, queue `auth`: failed `send-code` jobs carry the SMTP error. `Missing credentials for "PLAIN"`: `EMAIL_USER` set but `EMAIL_PASSWORD` empty (leave both empty for a server without login). Delivered but in spam: SPF, DKIM and DMARC ([../setup/email.md](../setup/email.md)). In development every email goes to Mailpit, `http://localhost:8025`, whatever `EMAIL_*` says |
| Google shows "Error 400: redirect_uri_mismatch" | The redirect URI the API sends is not in the client's **Authorized redirect URIs** | Register exactly `<BASE_URL>/api/v1/auth/google/callback`: in development `http://localhost:8888/api/v1/auth/google/callback`, in production `https://api.example.com/api/v1/auth/google/callback`. Check the scheme, the port and a trailing slash. A change at Google can take a few minutes |
| Google shows "Access blocked" or "has not completed the Google verification process" | The consent screen is in Testing and this Google account is not a test user | Add it under Audience → Test users, or publish the app ([../setup/google-sign-in.md](../setup/google-sign-in.md)) |
| Back in the web app with `?error=failed` after Google | The API log's `sign-in did not complete (failed): <detail>` says which: the browser did not send back the `oauth_state` cookie (blocked cookies, or a different browser), the attempt took more than 10 minutes, Google refused the code, or Google or Redis could not be reached | Act on the detail; a single occurrence is usually the person, not the server |
| The "Continue with Google" button is missing | `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` is empty (`GET /auth/options` lists no providers) | Set both and redeploy |
| `503 AUTH_TWO_FACTOR_UNAVAILABLE` at the second step | `AUTH_ENCRYPTION_KEY` changed without the old one in `AUTH_ENCRYPTION_KEY_PREVIOUS`, or was lost | [If the key was lost](#two-step-sign-in-unavailable) |
| `503 AUTH_CAPTCHA_UNAVAILABLE` on sign-up, forgot-password or sign-in | The API could not ask Cloudflare (network), or Cloudflare rejected `TURNSTILE_SECRET_KEY`. Turnstile fails closed on purpose | The error log says which. Fix the secret or the network; to stop refusing while you fix it, empty both Turnstile keys and redeploy (Turnstile off) |
| Every Turnstile answer is `400 AUTH_CAPTCHA_FAILED` | The site key and secret key belong to different widgets, the token expired, or the page re-sends a token already used (each works once) | Copy both keys from the same widget in Cloudflare; reset the widget after every submit ([turnstile.md](./turnstile.md)) |
| Many people get `429` with `data.reason: "network"`, or `429 THROTTLE_ERROR`, at the same time | The API sees every request as coming from one IP, so everyone shares one per-IP count. The app trusts exactly **one** proxy hop (`trust proxy 1` in [configure-app.ts](../../src/bootstrap/configure-app.ts)) and expects that proxy (nginx) to set `X-Forwarded-For` to the real client | Keep the shipped nginx config: it sets `X-Forwarded-For $remote_addr` and, behind Cloudflare's proxy, takes the client IP from `CF-Connecting-IP`. With another load balancer in front of nginx, set the real IP from it in nginx, or change the hop count in `configure-app.ts`. Check: the `ip` column of recent rows in the `Session` table should show real client addresses. A whole office behind one IP may also simply need a higher limit ([rate-limits.md](./rate-limits.md)) |
| One person is told to wait 15 minutes after a few wrong passwords | `login-fail-email`: 5 failures per address per 15 minutes | Working as intended. Turnstile raises it to 20. To unlock now, see [the FAQ](#how-do-i-clear-a-limit-for-one-person) |
| Every request answers `401 AUTH_TOKEN_INVALID` after a deploy, and refresh fixes it | `JWT_SECRET` or `BASE_URL` changed: existing access tokens no longer verify | Expected once. If it keeps happening, the app instances disagree on `JWT_SECRET` or `BASE_URL` |
| Right two-step codes are refused (`AUTH_TWO_FACTOR_CODE_INVALID`) for everyone | The server's clock is off by more than about 30 seconds | Enable time sync (`timedatectl set-ntp true`). If only one person: their phone's clock |
| Someone lost their phone and their recovery codes | Nothing in the app can let them in without the second factor, by design | Confirm it is them by other means, then `two-factor-off.js you@example.com` ([tools](#the-command-line-tools)) |
| A user is signed out right after two tabs refreshed | The second tab refreshed more than 10 seconds after the first (a tab asleep in the background) with the old cookie, which looks exactly like a stolen token | By design. If it is common for your users, the refresh grace is `refreshGraceMs` in `auth.module.ts` |
| The app refuses to start: `"... is required when "..." is set"` | One of a pair is set without the other: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, or the two Turnstile keys | Set both, or empty both |
| The app refuses to start: `AUTH_ENCRYPTION_KEY is the template's development key` or `JWT_SECRET still holds the template placeholder` | Production with the `.env.example` values | Generate real ones (`openssl rand -hex 32`) |
| The app refuses to start: `AUTH_ENCRYPTION_KEY_PREVIOUS is the same key as AUTH_ENCRYPTION_KEY` | A key change half done: the new key was not put in `AUTH_ENCRYPTION_KEY` | Step 2 of [changing the encryption key](#changing-the-encryption-key) |
| Codes from emails are always "not right" after a deploy | `JWT_SECRET` changed: pending codes died with it | Ask for a new code |

## Questions people ask

### How do I sign everyone out?

There is no command for it: end every session in the database. Open `psql`
in the database container:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yaml exec db \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

and run:

```sql
UPDATE "Session" SET "revokedAt" = now(), "revokedReason" = 'logout-all'
WHERE "revokedAt" IS NULL AND "expiresAt" > now();
```

Refresh stops working at once (each device is told
`signed_out_everywhere`). An access token already issued keeps working until
the session check's cached entry expires, at most 5 minutes. Do this after
restoring an old backup too: the restore brings back sessions that had been
ended since.

### How do I clear a limit for one person?

The counters are in Redis as `rl:<limit>:<sha256 of the lower-cased address,
IP or user id>`. For the sign-in limit on one address:

```bash
HASH=$(printf '%s' 'you@example.com' | sha256sum | cut -d' ' -f1)
docker compose --env-file .env.production -f docker-compose.prod.yaml exec redis \
  redis-cli del "rl:login-fail-email:$HASH"
```

The limit names are in [rate-limits.md](./rate-limits.md). In development,
`docker exec redis-hexagonal-auth sh -c "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del"`
clears them all.

### Where can I see who is signed in?

There is no session list in the app. Each sign-in is a row in `Session` with
its `userId`, `createdAt`, `lastUsedAt` (last refresh), `expiresAt`, `ip` and
`userAgent`; live ones have `revokedAt` null and `expiresAt` in the future.

### What happens when Redis goes down?

Signed-in users keep working: the session check reads Postgres instead, and
refresh works (without the two-tab grace). The auth limits and the global
throttler stop limiting. Google sign-in, signing in to an account with
two-step sign-in on, and every email (codes included) fail until Redis is
back. `RedisDown` alerts.
[sessions-and-tokens.md](./sessions-and-tokens.md) has the details.

### Can I make sessions last longer, or access tokens?

`AUTH_SESSION_TTL_DAYS` (up to 365) sets how long a sign-in lasts, however
often it refreshes. `JWT_ACCESS_TTL_SECONDS` (up to 3600) sets the access
token; longer means fewer refreshes, but a leaked access token works longer.
Signing out is immediate either way, because every request checks the session.

### Does restoring a database backup affect sign-in?

Yes: sessions, passwords, two-step setups and deletions go back to the moment
of the dump. Sign everyone out afterwards ([above](#how-do-i-sign-everyone-out)),
and keep the `AUTH_ENCRYPTION_KEY` that was current then, or the restored
two-step secrets cannot be read ([backups.md](../backups.md)).

### Is it safe to run the tools while the app is serving?

Yes. `auth:rotate-key` only replaces a secret that has not changed since it
read it; `auth:two-factor:off` and `user:promote` change one account each and
drop its cached copy.
