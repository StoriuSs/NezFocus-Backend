# Running auth in production

What the person who deploys and looks after the API needs to know about
sign-in: what to set before the first deploy, how to change `JWT_SECRET`
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
- [The command-line tools](#the-command-line-tools)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)
- [Questions people ask](#questions-people-ask)

## Before the first deploy

Tick each one. Most are refused at start-up when wrong (the app prints which
variable and why), but the ones marked **not checked** only show up when
someone tries to sign in.

**The secret to generate.** A fresh random value, never one from
`.env.example`, never the same in two environments:

```bash
openssl rand -hex 32   # JWT_SECRET
```

- [ ] `JWT_SECRET`: at least 32 characters. Production refuses weak values
      (`password`, `changeme`, ...) and the template's `your_...` placeholder.
      It signs access tokens and keys the emailed codes.
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
- [ ] `SUPPORT_EMAIL` (optional): named in the "account will be deleted"
      email, where only a person can help.
- [ ] `APP_NAME`: in every email subject.

**The server.**

- [ ] nginx in front of the app, as `nginx/bootstrap-nginx.sh` sets it up
      ([server.md](../server.md)). The app trusts exactly one proxy hop to tell
      it the client's IP, and every per-IP limit depends on it
      ([429s for everyone](#troubleshooting)).

**After deploying**, with a real address:

- [ ] Ask for a code, receive it, send it back: the account is made and you are signed in.
- [ ] Reload the web app: you are still signed in (the refresh cookie works).
- [ ] Wait 16 minutes, use the app: still signed in (refresh works after the
      first access token expired).
- [ ] Sign in with Google, if on.
- [ ] Make yourself an administrator with `user:promote`, if your app has
      admin routes.

The whole first deploy, every service included, is in
[../setup/prepare-for-production.md](../setup/prepare-for-production.md).

## The auth settings

The variables the auth module reads. Every variable, with validation details,
is in [environment.md](../environment.md#authentication). Where they are used:
[sessions-and-tokens.md](./sessions-and-tokens.md),
[google-sign-in.md](./google-sign-in.md).

| Variable | Default | Production | Changing it later |
|---|---|---|---|
| `JWT_SECRET` | none: required | At least 32 characters, not weak, not the placeholder | Every access token and every pending emailed code stops working. [Changing JWT_SECRET](#changing-jwt_secret) |
| `JWT_ACCESS_TTL_SECONDS` | `900` | 60 to 3600 | Applies to new tokens |
| `AUTH_SESSION_TTL_DAYS` | `30` | 1 to 365 | Applies to new sessions; existing ones keep their end |
| `AUTH_COOKIE_SAMESITE` | `lax` | `lax`, `strict` or `none` | Applies to the next cookie set (next refresh) |
| `AUTH_COOKIE_SECURE` | on in production, or with `none` | Cannot be `false` with `none` | |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | empty (off) | Both or neither | Emptying both turns Google off; people with no password must then use "forgot password" |
| `BASE_URL` | `http://localhost:<PORT>` | The public `https://` address | Access tokens become invalid (clients refresh); Google's redirect URI changes: register the new one |
| `FRONTEND_URL` | `http://localhost:3001` | Required | Email links and Google's return |
| `CORS_ORIGINS` | `http://localhost:3001` | The web app's exact origin(s) | |
| `CORS_CREDENTIALS` | `true` | Must be true | |
| `APP_NAME` | `Test App` | Your product's name | New emails only |
| `SUPPORT_EMAIL` | empty | Recommended | |
| `THROTTLE_TTL`, `THROTTLE_LIMIT`, `THROTTLE_ANONYMOUS_LIMIT` | `60`, `100`, `300` | | The global per-route throttler: `THROTTLE_LIMIT` per signed-in user, `THROTTLE_ANONYMOUS_LIMIT` per IP for requests without a valid access token (D-135, [rate-limits.md](./rate-limits.md)) |
| `EMAIL_*` | Mailpit in development | `EMAIL_HOST` required | |

Not configurable, by design: code lifetime 10 minutes, 5 tries per code, the
10-second refresh grace, 10 minutes for a Google sign-in, and every auth rate
limit
([rate-limits.md](./rate-limits.md) says where to change them in code).

**Applying a change.** Edit `.env.production` on the server, then redeploy:
`./deploy.sh`, or `./deploy.sh --skip-build` when only the env file changed
and the server builds its own image ([deploy.md](../deploy.md)). With more
than one app instance, every instance must have the same `JWT_SECRET` and
`BASE_URL`.

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

Steps:

1. `openssl rand -hex 32`.
2. Put it in `JWT_SECRET` in `.env.production`.
3. Redeploy. Expect a short burst of refreshes as every open tab gets a new
   access token.

If you also want everyone signed out (the leak may have been used), end every
session as in [the FAQ](#how-do-i-sign-everyone-out).

## The command-line tools

Each runs on your machine with `pnpm` (it reads `.env.development`, or
`.env.<NODE_ENV>`, and needs the database reachable), and on the server inside
the running app container with `node dist/src/bootstrap/<file>.js`.

| What | On your machine | On the server |
|---|---|---|
| Give a role (default `admin`) | `pnpm user:promote you@example.com [--role editor]` | `docker compose --env-file .env.production -f docker-compose.prod.yaml exec app node dist/src/bootstrap/user-roles.js you@example.com [--role editor]` |
| Take a role away | `pnpm user:promote you@example.com --remove [--role editor]` | `docker compose --env-file .env.production -f docker-compose.prod.yaml exec app node dist/src/bootstrap/user-roles.js you@example.com --remove` |

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
reuse, and over time, sign-in attempts and account changes (resets,
deletions). All of it is `auth_events_total{event}`
([in-the-code.md](./in-the-code.md#metrics-alerts-and-logs) lists the events).

**Alerts.**

| Alert | Means | Do |
|---|---|---|
| `AuthFailedLoginSpike` (more than 50 failed sign-ins in 10 minutes) | Someone is probably guessing passwords across many addresses or IPs. The per-address and per-IP limits slow each source; this sees the total | Look at the "Failed sign-ins" and "Refused by the limits" panels and the API logs for the IPs. Raise the threshold in `monitoring/prometheus/rules/app.yml` if your user base makes 50 normal |
| `AuthRefreshTokenReuse` | A refresh token came back after it was replaced, and the app ended that session. Usually a stolen cookie; sometimes a device restoring an old one | Sentry has the user id and session id (tag `auth: refresh-reuse`). Contact the user if it repeats; check for an XSS hole or a compromised device |
| `AppErrorLogs` (any error line) | Among other things, the auth errors below | Read the line |

**Log lines that need a person.** In Grafana → NestJS Logs, or Loki with
`{service="app"} |= "<text>"`.

| Line contains | Means | Do |
|---|---|---|
| `sign-in did not complete` (warn) | A Google return failed, with the reason (`state does not match`, `no attempt with this state`, `the code could not be redeemed: ...`) | Only worth acting on if it repeats; see [troubleshooting](#troubleshooting) |
| `sign-in failed:` (error) | A Google return failed on the database or Redis | Check those |
| `an account deletion's event was not handled` | The hourly clean-up finished a deletion whose event was lost (a crash at the wrong moment). Nothing was exposed meanwhile | None, unless it repeats |
| `Session cache unavailable, reading from the database` | Redis is down; sign-in checks fall back to Postgres | Fix Redis (`RedisDown` will be firing) |
| `Rate limiting unavailable, refusing the request` | Redis is down; the auth limits fail closed (D-137), so **nobody can sign in**, ask for a code or change a password (503) until it is back. Signed-in sessions carry on | Fix Redis (`RedisDown` will be firing) |
| `Could not queue a password reset email` | "Forgot password" for an address with an account could not queue the email; the person was still answered 202 | Check Redis and the `auth` queue; the person can ask again |
| `a step after the change failed` (`Password reset:` or `Account completion:`) | The change was made, but dropping a cached copy or queueing the notice email failed. The request still succeeded | Check Redis and the `auth` queue. A cached copy left behind expires within minutes |
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
| `403 AUTH_FORBIDDEN` on `/auth/refresh` or `/auth/logout` | The page's origin is not in `CORS_ORIGINS` | Add the exact origin (`https://app.example.com`: scheme, no trailing slash) and redeploy. A `www.` variant is a different origin |
| The browser console says a CORS request was blocked (credentials) | `CORS_ORIGINS` does not list the page's origin, or `CORS_CREDENTIALS` is off | As above |
| No sign-up or reset email arrives | SMTP settings, or the email is in spam, or the per-address limit was hit | Open `/admin/queues`, queue `auth`: failed `send-code` jobs carry the SMTP error. `Missing credentials for "PLAIN"`: `EMAIL_USER` set but `EMAIL_PASSWORD` empty (leave both empty for a server without login). Delivered but in spam: SPF, DKIM and DMARC ([../setup/email.md](../setup/email.md)). In development every email goes to Mailpit, `http://localhost:8025`, whatever `EMAIL_*` says |
| Google shows "Error 400: redirect_uri_mismatch" | The redirect URI the API sends is not in the client's **Authorized redirect URIs** | Register exactly `<BASE_URL>/api/v1/auth/google/callback`: in development `http://localhost:8888/api/v1/auth/google/callback`, in production `https://api.example.com/api/v1/auth/google/callback`. Check the scheme, the port and a trailing slash. A change at Google can take a few minutes |
| Google shows "Access blocked" or "has not completed the Google verification process" | The consent screen is in Testing and this Google account is not a test user | Add it under Audience → Test users, or publish the app ([../setup/google-sign-in.md](../setup/google-sign-in.md)) |
| Back in the web app with `?error=failed` after Google | The API log's `sign-in did not complete (failed): <detail>` says which: the browser did not send back the `oauth_state` cookie (blocked cookies, or a different browser), the attempt took more than 10 minutes, Google refused the code, or Google or Redis could not be reached | Act on the detail; a single occurrence is usually the person, not the server |
| The "Continue with Google" button is missing | `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` is empty (`GET /auth/options` lists no providers) | Set both and redeploy |
| Many people get `429` with `data.reason: "network"`, or `429 THROTTLE_ERROR`, at the same time | The API sees every request as coming from one IP, so everyone shares one per-IP count. Signed-in requests are not part of it: the global throttler counts them per user (D-135), so this hits signing in, codes and refresh. The app trusts exactly **one** proxy hop (`trust proxy 1` in [configure-app.ts](../../src/bootstrap/configure-app.ts)) and expects that proxy (nginx) to set `X-Forwarded-For` to the real client | Keep the shipped nginx config: it sets `X-Forwarded-For $remote_addr` and, behind Cloudflare's proxy, takes the client IP from `CF-Connecting-IP`. With another load balancer in front of nginx, set the real IP from it in nginx, or change the hop count in `configure-app.ts`. Check: the `ip` column of recent rows in the `Session` table should show real client addresses. A whole office behind one IP may also simply need a higher limit: `THROTTLE_ANONYMOUS_LIMIT`, or the auth limits per IP in code ([rate-limits.md](./rate-limits.md)). An allowlist of exempt IPs is not available; see D-135 |
| Sign-in, codes and password changes answer `503 SERVICE_UNAVAILABLE_ERROR` | Redis cannot be reached, and the auth limits fail closed (D-137) | Fix Redis. Signed-in users are not affected |
| One person is told to wait 15 minutes after a few wrong passwords | `login-fail-email`: 5 failures per address per 15 minutes | Working as intended. To unlock now, see [the FAQ](#how-do-i-clear-a-limit-for-one-person) |
| Every request answers `401 AUTH_TOKEN_INVALID` after a deploy, and refresh fixes it | `JWT_SECRET` or `BASE_URL` changed: existing access tokens no longer verify | Expected once. If it keeps happening, the app instances disagree on `JWT_SECRET` or `BASE_URL` |
| A user is signed out right after two tabs refreshed | The second tab refreshed more than 10 seconds after the first (a tab asleep in the background) with the old cookie, which looks exactly like a stolen token | By design. If it is common for your users, the refresh grace is `refreshGraceMs` in `auth.module.ts` |
| The app refuses to start: `"... is required when "..." is set"` | One of a pair is set without the other: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` | Set both, or empty both |
| The app refuses to start: `JWT_SECRET still holds the template placeholder` | Production with the `.env.example` value | Generate a real one (`openssl rand -hex 32`) |
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

Refresh stops working at once. `logout-all` is the value the
"Sign out the other devices" button stores (D-75), so each device is told
`signed_out_everywhere`, as if the user had pressed it elsewhere. To have the
devices show only the generic "your session has ended" sentence instead, store
`'revoked'` (what signing out one device from the list stores). An access token already issued keeps working until
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
`docker exec redis-nezfocus-web sh -c "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del"`
clears them all.

### Where can I see who is signed in?

Each user sees their own on the settings page's list of devices
(`GET /auth/sessions`, D-75), with the IP masked. There is no list across
users in the app. In the database each sign-in is a row in `Session` with
its `userId`, `createdAt`, `lastUsedAt` (last refresh), `expiresAt`, `ip` and
`userAgent` (both of the last refresh, D-138); live ones have `revokedAt`
null and `expiresAt` in the future.

### What happens when Redis goes down?

Signed-in users keep working: the session check reads Postgres instead, and
refresh works (without the two-tab grace). The global throttler stops
limiting. The auth limits fail closed (D-137): signing in, asking for a code,
resetting or changing a password and deleting the account answer 503. Google
sign-in and every email (codes included) fail until Redis is back. `RedisDown` alerts.
[sessions-and-tokens.md](./sessions-and-tokens.md) has the details.

### Can I make sessions last longer, or access tokens?

`AUTH_SESSION_TTL_DAYS` (up to 365) sets how long a sign-in lasts, however
often it refreshes. `JWT_ACCESS_TTL_SECONDS` (up to 3600) sets the access
token; longer means fewer refreshes, but a leaked access token works longer.
Signing out is immediate either way, because every request checks the session.

### Does restoring a database backup affect sign-in?

Yes: sessions, passwords and deletions go back to the moment of the dump.
Sign everyone out afterwards ([above](#how-do-i-sign-everyone-out),
[backups.md](../backups.md)).

### Is it safe to run the tools while the app is serving?

Yes. `user:promote` changes one account and drops its cached copy.
