# Environment configuration

This page is the full reference for the settings the starter reads from its
env files: every variable, whether you must set it, its default, what it does,
what reads it, and where to get its value. Read the first three sections once;
come back to the tables when you need one setting.

There are about 120 settings. In development a plain copy of `.env.example`
already works. In production about fifteen need a real value; the rest have
defaults that are right until you have a reason to change them.
`.env.example` carries a comment above each one.

- [The files](#the-files)
- [The ones you actually set](#the-ones-you-actually-set)
- [Checking a file](#checking-a-file)
- [The reference](#the-reference)
  - [Application](#application)
  - [Browsers and CORS](#browsers-and-cors)
  - [Authentication](#authentication)
  - [Database](#database)
  - [Redis and caching](#redis-and-caching)
  - [Limits and timeouts](#limits-and-timeouts)
  - [Admin pages](#admin-pages)
  - [Uploads and storage](#uploads-and-storage)
  - [Email](#email)
  - [Logging and error tracking](#logging-and-error-tracking)
  - [Monitoring and alerts](#monitoring-and-alerts)
  - [Backups](#backups)
  - [Deploys](#deploys)
  - [Development and test services](#development-and-test-services)
  - [Tools and load tests](#tools-and-load-tests)
  - [Not in an env file: GitHub settings](#not-in-an-env-file-github-settings)
- [Things that will catch you out](#things-that-will-catch-you-out)
- [Production is stricter](#production-is-stricter)
- [Adding a variable](#adding-a-variable)
- [Docker and env files](#docker-and-env-files)

## The files

```
.env.example        ← committed. The template, with a comment per setting
.env.development    ← gitignored. Yours, on your machine
.env.production     ← gitignored. Created on the server, by hand
```

Only `.env.example` is in git. The app loads the file that matches `NODE_ENV`:

| `NODE_ENV` | File |
| --- | --- |
| `development` (the default) | `.env.development` |
| `production` | `.env.production` |

```bash
cp .env.example .env.development      # a plain copy runs as it is
```

In Docker, compose passes the file's contents to the container as its
environment, and overrides a few connection values
([below](#docker-and-env-files)). The file path above is how the app finds its
settings when it runs on your machine without Docker (`pnpm dev`), and how the
command-line tools (`pnpm prisma:*`, `pnpm user:promote`, ...) find them.

## The ones you actually set

**In development**, nothing has to change: CI runs the whole check suite
against a plain copy of `.env.example`. Two things are worth knowing:

| | Why |
| --- | --- |
| `DATABASE_URL` must keep using the same user, password and database name as `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME` | Only tools you run on this machine read it (`pnpm prisma:migrate`, `pnpm dev`, the CLIs). The template's lines agree; change them together |
| Replace the template passwords if the machine is shared | `DB_PASSWORD`, `REDIS_PASSWORD`, `GRAFANA_ADMIN_PASSWORD`, `BULL_BOARD_PASSWORD`. Every port binds to `127.0.0.1`, so they are not reachable from the network either way |

`ALERT_WEBHOOK_URL` ships empty: in development alerts are then shown in
Alertmanager and Grafana and sent nowhere.

Optional services in development (Google sign-in, Turnstile, S3 storage, Sentry)
are switched on by their variables. [setup/prepare-for-development.md](./setup/prepare-for-development.md)
walks through each one.

**In production**, these need a value of your own. The app, compose or
`deploy.sh` refuses to start without the ones marked **required**:

| | What to put | Where it comes from |
| --- | --- | --- |
| `DB_NAME`, `DB_USERNAME`, `DB_PASSWORD` | **Required.** A name, a user and a generated password, URL-safe characters only | `openssl rand -hex 24` |
| `REDIS_PASSWORD` | **Required.** A generated password | `openssl rand -hex 24` |
| `BULL_BOARD_PASSWORD` | **Required.** A generated password for `/admin/queues` and `/api-docs` | `openssl rand -hex 24` |
| `GRAFANA_ADMIN_PASSWORD` | **Required** with `MONITORING=local` (compose) | `openssl rand -hex 24` |
| `JWT_SECRET` | **Required.** Signs access tokens | `openssl rand -hex 32` |
| `AUTH_ENCRYPTION_KEY` | **Required.** Seals two-step sign-in secrets. Back it up | `openssl rand -hex 32` (a second, different one) |
| `FRONTEND_URL` | **Required.** The web app's address, e.g. `https://app.example.com` | Your domain ([setup/domain-dns-tls.md](./setup/domain-dns-tls.md)) |
| `BASE_URL` | The API's public address, e.g. `https://api.example.com`. Required in production: the localhost default would break Google sign-in and upload links | Your domain |
| `CORS_ORIGINS` | The web app's exact origin, e.g. `https://app.example.com` | Your domain |
| `EMAIL_HOST` and the other `EMAIL_*` | **Required.** A real SMTP server: sign-up emails a code | [setup/email.md](./setup/email.md) |
| `ALERT_WEBHOOK_URL` | **Required.** Where alerts go | [setup/discord-alerts.md](./setup/discord-alerts.md) |
| `PORT` | `3000`, the port nginx forwards to (the template's `8888` is for development; anything else answers 502) | [The traps](#things-that-will-catch-you-out) |
| `NODE_ENV` | `production` (compose sets it anyway) | |

Then, if you use them: `GOOGLE_CLIENT_*`, `TURNSTILE_*`, `SUPPORT_EMAIL`,
`AWS_*` with `STORAGE_TYPE=s3`, `BACKUP_S3_*`, `SENTRY_DSN`, `DEPLOY_*`.
[setup/prepare-for-production.md](./setup/prepare-for-production.md) goes
through the file field by field, in order.

Generate secrets rather than inventing them:

```bash
openssl rand -hex 24    # a password: letters and digits only, so URL-safe
openssl rand -hex 32    # JWT_SECRET
openssl rand -hex 32    # AUTH_ENCRYPTION_KEY (run it again: a different value)
```

## Checking a file

```bash
pnpm env:check                      # .env.development
pnpm env:check .env.production      # any file, or several
```

It applies the same rules the app applies at boot
(`src/config/validation.ts`), and reports every problem at once rather than
the first. **Values are never printed.**

A file whose name contains `production` is checked with production's stricter
rules whatever `NODE_ENV` it sets, because that is how
`docker-compose.prod.yaml` will run it.

Beyond invalid values it warns about four things that are easy to miss:

- **A key nothing reads.** Not the app, not compose, not `deploy.sh`, not a
  tool. Almost always a typo, and a misspelled optional key silently leaves
  the default in force: nothing fails, so nobody notices.
- **A key set twice.** Only the last one counts.
- **A key compose overrides anyway** (`DATABASE_URL`, `REDIS_HOST`, `PORT`, ...),
  so the file's value never reaches the app.
- **A `$` outside single quotes.** Compose reads `$NAME` in an env file as a
  variable, so `aB3$kL9` silently becomes `aB3`. Quote it
  (`DB_PASSWORD='aB3$kL9'`) or double the `$`.

```
✗ .env.production (NODE_ENV=production)
    ✗ "BASE_URL" must be a valid uri
    ⚠ THROTLE_LIMIT is not read by the app, docker compose or deploy.sh (did you mean THROTTLE_LIMIT?)
```

`deploy.sh` runs the same check **on the server, inside the image it is about
to deploy**, before migrations. An invalid value stops the deploy with nothing
changed.

## The reference

How to read the tables:

- **Required**: `always` means the app refuses to start without it, in every
  environment. `prod` means only with `NODE_ENV=production`. `if s3`,
  `if cloud` and so on name the setting that makes it required. Empty means
  optional.
- **Read by**: `app` is the API itself (validated in
  [`validation.ts`](../src/config/validation.ts), read in the matching
  `src/config/*.config.ts`). `compose` is Docker Compose: the app cannot
  validate these for you. `deploy.sh`, `backup` (the backup container) and
  `tool` (a `pnpm` script) are named as such.
- **Set up**: the page that explains how to get the value, when it comes from
  outside.

### Application

Set up: the domain and its addresses, [setup/domain-dns-tls.md](./setup/domain-dns-tls.md).

| Variable | Required | Default | What it does | Read by | Set up |
| --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | | `development` | `development`, `production` or `test`. Picks the env file and turns on [the production rules](#production-is-stricter). `docker-compose.prod.yaml` sets `production` itself | app, tools | |
| `PORT` | | `3000` (template: `8888`) | Run on this machine (`pnpm dev`): the port the app listens on. In Docker: only the **host** side of the mapping; inside the container the app always listens on 3000. Production: the port nginx forwards to, `3000` unless you gave `bootstrap-nginx.sh` another `--api-port` | app, compose | [server.md](./server.md#the-reverse-proxy-and-https) |
| `API_PREFIX` | | `api` | The path prefix. URI versioning appends `/v1`, so `api/v1` here gives `/api/v1/v1/*`. Change the healthcheck path in `docker-compose.prod.yaml` with it | app, k6 | |
| `APP_NAME` | | `Test App` | Shown on `/api-docs`, in email subjects and texts, and as the account name in authenticator apps (two-step sign-in) | app | |
| `BASE_URL` | prod | `http://localhost:<PORT>` | The API's public address. Builds the links to locally stored uploads, is the issuer and audience of every access token, and the base of the Google redirect URI: `<BASE_URL>/api/v1/auth/google/callback`. Changing it signs every access token out (sessions refresh) and changes that URI | app | [setup/google-sign-in.md](./setup/google-sign-in.md) |
| `FRONTEND_URL` | prod | `http://localhost:3001` | The web app's address. Email links ("reset your password") and the Google sign-in return (`/auth/callback`) point there | app | |
| `SUPPORT_EMAIL` | | empty | An address people can write to. Named in the "two-step sign-in was turned on/off" and "account deleted" emails; empty, they say "contact support" without one | app | |
| `GRACEFUL_SHUTDOWN_TIMEOUT_MS` | | `5000` | How long cache clean-up may take during shutdown before it carries on ([graceful-shutdown.md](./graceful-shutdown.md)) | app | |
| `DELETED_ACCOUNT_RETENTION_DAYS` | | `30` | Days a deleted account keeps its personal data before the sweep erases it. Also stated in the "account deleted" email ([account-deletion.md](./account-deletion.md)) | app | |
| `UNVERIFIED_ACCOUNT_RETENTION_DAYS` | | `7` | Days an account may stay unconfirmed before it is deleted, freeing its address. At least 1 ([auth/accounts.md](./auth/accounts.md)) | app | |

### Browsers and CORS

CORS (Cross-Origin Resource Sharing) is how a browser decides whether a page
on one origin (`https://app.example.com`) may call an API on another
(`https://api.example.com`). These two settings also decide whether the
refresh cookie reaches the API at all.

| Variable | Required | Default | What it does | Read by | Set up |
| --- | --- | --- | --- | --- | --- |
| `CORS_ORIGINS` | | `http://localhost:3001` | Comma-separated origins allowed to call the API with credentials: your real frontend origins, nothing else, no trailing slash. Also the only pages allowed to refresh a session, sign out, and send the second step after Google (`403 AUTH_FORBIDDEN` from anywhere else) | app | [auth/sessions-and-tokens.md](./auth/sessions-and-tokens.md) |
| `CORS_CREDENTIALS` | | `true` | Must stay `true`: without it the browser never sends the refresh cookie, and every session ends after 15 minutes. Empty means `true`; production refuses `false` | app | |

### Authentication

How each one is used: [auth/operations.md](./auth/operations.md). Set up:
[setup/google-sign-in.md](./setup/google-sign-in.md) and
[setup/cloudflare-turnstile.md](./setup/cloudflare-turnstile.md). The concepts
behind them (tokens, cookies, encryption): [auth/concepts.md](./auth/concepts.md).

| Variable | Required | Default | What it does | Read by | Set up |
| --- | --- | --- | --- | --- | --- |
| `JWT_SECRET` | always | | Signs access tokens and keys the stored fingerprints (HMAC) of emailed codes. At least 32 characters; production also refuses known defaults and the template's placeholder. Changing it signs every access token out (sessions refresh and carry on) and makes every code already sent stop working | app | `openssl rand -hex 32` |
| `JWT_ACCESS_TTL_SECONDS` | | `900` | Access-token lifetime, 60 to 3600 seconds. Short on purpose: a token cannot be recalled once issued, only the session behind it | app | |
| `AUTH_SESSION_TTL_DAYS` | | `30` | How long a sign-in lasts however often it is refreshed, 1 to 365 days | app | |
| `AUTH_COOKIE_SAMESITE` | | `lax` | The refresh cookie's `SameSite`: `lax`, `strict` or `none`. `lax` works when the web app and the API share a registrable domain (`app.example.com` and `api.example.com`). On different domains use `none`, which needs HTTPS | app | [auth/sessions-and-tokens.md](./auth/sessions-and-tokens.md) |
| `AUTH_COOKIE_SECURE` | | on in production, or with `none` | The cookies' `Secure` flag (sent over HTTPS only). Empty picks the default. `false` is refused with `AUTH_COOKIE_SAMESITE=none`: browsers drop such a cookie | app | |
| `AUTH_ENCRYPTION_KEY` | always | template: 64 zeros | Seals two-step sign-in secrets (AES-256-GCM) and keys the recovery codes' fingerprints. At least 32 bytes of hex. The all-zero template key is for development; production refuses it. **Keep a copy**: losing it locks everyone with two-step sign-in out of the second step | app, `auth:rotate-key`, `auth:two-factor:off` | `openssl rand -hex 32`; [auth/two-step-sign-in.md](./auth/two-step-sign-in.md) |
| `AUTH_ENCRYPTION_KEY_PREVIOUS` | | empty | Only while changing `AUTH_ENCRYPTION_KEY`: the old key, read but never used to seal. Must differ from the current key; production refuses the all-zero key. Empty when no change is under way | app, `auth:rotate-key`, `auth:two-factor:off` | [auth/operations.md](./auth/operations.md) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | | empty | "Continue with Google". Both set turns it on, both empty leaves it off, one without the other is refused at boot. Register `<BASE_URL>/api/v1/auth/google/callback` with Google | app | [setup/google-sign-in.md](./setup/google-sign-in.md) |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | | empty | Cloudflare Turnstile (a CAPTCHA) on sign-up, forgot-password, and sign-in after two failures. Both or neither. The site key is public: the web app reads it from `GET /api/v1/auth/options` | app | [setup/cloudflare-turnstile.md](./setup/cloudflare-turnstile.md) |

Fixed in the code rather than settings: emailed codes last 10 minutes and allow
5 tries; the two-step challenge lasts 5 minutes; the session check's Redis copy
lasts at most 5 minutes; a replaced refresh token is still accepted for 10
seconds. [auth/in-the-code.md](./auth/in-the-code.md) says where to change them.

### Database

| Variable | Required | Default | What it does | Read by | Set up |
| --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | always | | For Prisma commands, the CLIs and the tests **on this machine** (`localhost` and `DB_PORT`). In Docker the app gets one built by compose instead ([the traps](#things-that-will-catch-you-out)) | app, tools | |
| `DB_NAME` | always | | The database name. Prod: URL-safe characters only | app, compose, backup | |
| `DB_USERNAME` | always | | The database user. Prod: URL-safe characters only | app, compose, backup | |
| `DB_PASSWORD` | always | | Prod: URL-safe **and** strong (see [the rules](#production-is-stricter)) | app, compose, backup | `openssl rand -hex 24` |
| `DB_PORT` | | `5432` | Host side of the db port mapping; must match `DATABASE_URL`. Keep it in the file: compose uses it without a default | app, compose | |
| `DB_POOL_MAX` | | `10` | Connections per app instance. × instances must stay under Postgres' `max_connections` (100 here) ([scaling.md](./scaling.md)) | app | |
| `DB_POOL_IDLE_TIMEOUT_MS` | | `30000` | How long an idle pooled connection is kept | app | |
| `DB_POOL_CONNECTION_TIMEOUT_MS` | | `10000` | How long to wait for a free connection before failing | app | |
| `SHADOW_DATABASE_URL` | for `prisma:check` | | An empty scratch database where `pnpm prisma:check` replays the migrations to compare them with the schema. Each run wipes it | tool (`prisma.config.ts`) | [prisma-module.md](./prisma-module.md) |

### Redis and caching

| Variable | Required | Default | What it does | Read by | Set up |
| --- | --- | --- | --- | --- | --- |
| `REDIS_HOST` | | `localhost` | Compose overrides it with `redis` for the app | app, tools | |
| `REDIS_PORT` | | `6379` | Host side of the mapping. Compose overrides it with `6379` for the app | app, compose, tools | |
| `REDIS_PASSWORD` | prod | | Redis holds the queues (with the codes in waiting emails), idempotency locks, rate-limit counters and the session check's cache. Optional in development but used: compose starts Redis with it. Prod: strong, and compose refuses an empty one | app, compose, tools | `openssl rand -hex 24` |
| `CACHE_TTL` | | `3600` | Seconds, for the general two-layer cache ([cache.md](./cache.md)) | app | |
| `CACHE_LRU_SIZE` | | `500` | Entries in the in-process layer of that cache | app | |

### Limits and timeouts

| Variable | Required | Default | What it does | Read by | Set up |
| --- | --- | --- | --- | --- | --- |
| `THROTTLE_TTL` | | `60` | The global rate limit's window, in seconds | app | |
| `THROTTLE_LIMIT` | | `100` | Requests per window **per IP, per route**. A refusal is `429` with `Retry-After`. The sign-in routes have their own, stricter limits on top ([auth/rate-limits.md](./auth/rate-limits.md)) | app | [rate-limit.md](./rate-limit.md) |
| `REQUEST_TIMEOUT_MS` | | `30000` | A request past this answers `408`. It does **not** cancel the work already started | app | |

### Admin pages

| Variable | Required | Default | What it does | Read by | Set up |
| --- | --- | --- | --- | --- | --- |
| `BULL_BOARD_USER` | | `admin` | Basic-auth user for `/admin/queues` (the queue dashboard), and for `/api-docs` in production. Not checked: choose one anyway | app | |
| `BULL_BOARD_PASSWORD` | prod | `admin` | Its password. Production refuses the default and anything weak: a waiting or failed email job on `/admin/queues` holds the sign-in or reset code it sends, so read access to that page is enough to take over an account | app | `openssl rand -hex 24` |

### Uploads and storage

Set up: [setup/storage-s3-r2.md](./setup/storage-s3-r2.md) (AWS S3 or Cloudflare R2).

| Variable | Required | Default | What it does | Read by | Set up |
| --- | --- | --- | --- | --- | --- |
| `STORAGE_TYPE` | | `local` | `local` (the server's disk) or `s3` | app | [file-uploads-and-s3.md](./file-uploads-and-s3.md) |
| `UPLOAD_DEST` | | `./uploads` | Local mode only: the folder | app | |
| `MAX_FILE_SIZE` | | `5242880` | Bytes. Enforced while streaming, so a larger file is cut off, not read whole | app | |
| `MAX_IMAGE_PIXELS` | | `40000000` | Decoded pixels per image, against decompression bombs | app | |
| `IMAGE_PROCESSING_TIMEOUT_MS` | | `15000` | Per image, at most an hour | app | |
| `IMAGE_PROCESSING_CONCURRENCY` | | `2` | Images resized at once per instance. Each holds a decoded image in memory | app | |
| `IMAGE_PROCESSING_QUEUE_LIMIT` | | `10` | Uploads that may wait for a slot. Past this, uploads get `503` | app | |
| `AWS_REGION` | if s3 | `us-east-1` | The bucket's region; `auto` for Cloudflare R2 | app | [setup/storage-s3-r2.md](./setup/storage-s3-r2.md) |
| `AWS_ACCESS_KEY_ID` | if s3 | | Access key | app | [setup/storage-s3-r2.md](./setup/storage-s3-r2.md) |
| `AWS_SECRET_ACCESS_KEY` | if s3 | | Its secret | app | [setup/storage-s3-r2.md](./setup/storage-s3-r2.md) |
| `AWS_S3_BUCKET` | if s3 | | Keep it private: the app signs read URLs. In development `pnpm test:services:up` creates it in RustFS | app, compose | [setup/storage-s3-r2.md](./setup/storage-s3-r2.md) |
| `AWS_S3_ENDPOINT` | | | For S3-compatible storage (R2, B2, RustFS, MinIO). Turns on path-style addressing, and checksums only where required | app | [setup/storage-s3-r2.md](./setup/storage-s3-r2.md) |
| `AWS_S3_PUBLIC_ENDPOINT` | | `AWS_S3_ENDPOINT` | Where **browsers** reach storage, when that differs from where the app does (a container name) | app | |
| `AWS_S3_FORCE_PATH_STYLE` | | on with an endpoint | Overrides the automatic choice | app | |

### Email

Nothing here names a provider. They are ordinary SMTP settings, so Brevo,
Resend, Amazon SES or your own server all work by changing the values.
**In development `docker-compose.dev.yaml` sends every email to Mailpit
(`http://localhost:8025`) whatever these say.** The values matter there only
when the app runs on your machine (`pnpm dev`), where the template points them
at Mailpit too (`localhost:1025`).

| Variable | Required | Default | What it does | Read by | Set up |
| --- | --- | --- | --- | --- | --- |
| `EMAIL_HOST` | prod | `localhost` | The SMTP server. Production refuses to start without it: sign-up and password reset email a code | app | [setup/email.md](./setup/email.md) |
| `EMAIL_PORT` | | `587` (template: `1025`, Mailpit) | `587` with STARTTLS, `465` with `EMAIL_SECURE=true` | app | [setup/email.md](./setup/email.md) |
| `EMAIL_SECURE` | | `false` | `true` for implicit TLS (port 465) | app | |
| `EMAIL_USER`, `EMAIL_PASSWORD` | | empty | The SMTP login. Both empty for a server without one (Mailpit, a private relay) | app | [setup/email.md](./setup/email.md) |
| `EMAIL_FROM_NAME` | | `Test App` | The sender's name | app | |
| `EMAIL_FROM_ADDRESS` | | `noreply@testapp.com` | The sender's address. Use one on a domain you have authenticated with your provider (SPF, DKIM), or mail lands in spam. The top-level domain is not checked, so `.test` and `.internal` pass | app | [setup/email.md](./setup/email.md) |

### Logging and error tracking

Set up: [setup/sentry.md](./setup/sentry.md) for `SENTRY_*`.

| Variable | Required | Default | What it does | Read by | Set up |
| --- | --- | --- | --- | --- | --- |
| `LOG_LEVEL` | | `info` | `debug`, `info`, `warn` or `error` ([logging.md](./logging.md)) | app | |
| `LOG_FORMAT` | | JSON in containers, pretty in a terminal | `json` or `pretty`. Pretty is not available in the production image | app | |
| `SENTRY_DSN` | | empty | Error tracking. Empty turns it off and nothing is sent anywhere. A value that is not a DSN, or still the template's placeholder, is refused | app, `sentry:check` | [setup/sentry.md](./setup/sentry.md) |
| `SENTRY_TRACES_SAMPLE_RATE` | | `0` | Share of requests traced for performance, 0 to 1. `0.1` samples a tenth | app | |
| `SENTRY_RELEASE` | | | Set by `docker-compose.prod.yaml` to the commit being deployed (`APP_TAG`). Not yours to put in the file | app (set by compose) | |

### Monitoring and alerts

Almost all of these are read by **compose**, not the app, so `pnpm env:check`
cannot validate their values. Set up: [setup/discord-alerts.md](./setup/discord-alerts.md),
[setup/uptime-check.md](./setup/uptime-check.md) and
[setup/grafana-cloud.md](./setup/grafana-cloud.md). `ALERT_WEBHOOK_URL` is the exception: it is
checked anyway, because alerts silently going nowhere is worse than a failed
start. [monitoring.md](./monitoring.md) explains the two modes.

| Variable | Required | Default | What it does | Read by | Set up |
| --- | --- | --- | --- | --- | --- |
| `MONITORING` | | `local` | `local`: Prometheus, Loki, Grafana and Alertmanager run beside the app. `grafana-cloud`: only Alloy runs, and sends everything to Grafana Cloud. `off` (development only): none of it, and the dev container logs in colour ([docker.md](./docker.md#lighter-ways-to-run)) | compose, deploy.sh, `monitoring:cloud-sync`, the app (log format) | [setup/grafana-cloud.md](./setup/grafana-cloud.md) |
| `GRAFANA_CLOUD_PROMETHEUS_URL` | if cloud | | The stack's Prometheus push URL | compose | [setup/grafana-cloud.md](./setup/grafana-cloud.md) |
| `GRAFANA_CLOUD_PROMETHEUS_USER` | if cloud | | Its numeric user id | compose | [setup/grafana-cloud.md](./setup/grafana-cloud.md) |
| `GRAFANA_CLOUD_LOKI_URL` | if cloud | | The stack's Loki push URL | compose | [setup/grafana-cloud.md](./setup/grafana-cloud.md) |
| `GRAFANA_CLOUD_LOKI_USER` | if cloud | | Its numeric user id | compose | [setup/grafana-cloud.md](./setup/grafana-cloud.md) |
| `GRAFANA_CLOUD_TOKEN` | if cloud | | An access-policy token with `metrics:write` and `logs:write` | compose | [setup/grafana-cloud.md](./setup/grafana-cloud.md) |
| `GRAFANA_CLOUD_GRAFANA_URL` | | | Your stack's Grafana, e.g. `https://yourstack.grafana.net`. Only for `pnpm monitoring:cloud-sync` | tool | [setup/grafana-cloud.md](./setup/grafana-cloud.md) |
| `GRAFANA_CLOUD_GRAFANA_TOKEN` | | | A service-account token (Admin) in that Grafana, for the same sync. Without it, `deploy.sh` warns and skips updating the rules and dashboards there | tool, deploy.sh | [setup/grafana-cloud.md](./setup/grafana-cloud.md) |
| `GRAFANA_ADMIN_PASSWORD` | prod, local mode | `admin` in development | The Grafana login (user `admin`). Read only when Grafana first creates its data volume. Compose refuses an empty one in production; it does not judge its strength | compose | `openssl rand -hex 24` |
| `GRAFANA_PORT` | | `3002` | Host port for Grafana. Not 3001: that is the web app's development server | compose | |
| `PROMETHEUS_PORT` | | `9090` | Host port for Prometheus | compose | |
| `LOKI_PORT` | | `3100` | Host port for Loki's API | compose | |
| `ALLOY_PORT` | | `12345` | Host port for Alloy's UI (the log and metrics collector) | compose | |
| `ALERTMANAGER_PORT` | | `9093` | Host port for Alertmanager | compose | |
| `ALERT_WEBHOOK_URL` | prod | | Where alerts are posted: a Discord webhook (Slack or Teams after changing the receiver). Must be `https` and not the template's placeholder. In development, empty means alerts are shown but not sent | app (checked), compose, `monitoring:cloud-sync` | [setup/discord-alerts.md](./setup/discord-alerts.md) |
| `ALERT_HEARTBEAT_URL` | | | A heartbeat URL called every minute while alerting works (production only; also uncomment the receiver in `alertmanager.yml`) | compose, `monitoring:cloud-sync` | [setup/uptime-check.md](./setup/uptime-check.md) |
| `COMPOSE_PROJECT_NAME` | | from `name:` in the compose file | A Compose built-in, not something to set: the project name (`hexagonal-auth-dev`, `hexagonal-auth-prod`) labels alerts and limits Alloy to this stack's containers | compose | [making-it-yours.md](./making-it-yours.md) |

All ports above are bound to `127.0.0.1`: reachable from the machine itself (or
an SSH tunnel), never from the network.

### Backups

Set up: [setup/offsite-backups.md](./setup/offsite-backups.md) for the `BACKUP_S3_*` bucket.

Read by the backup container in production ([backups.md](./backups.md)). All
optional; the defaults are in `.env.example`.

| Variable | Required | Default | What it does | Read by | Set up |
| --- | --- | --- | --- | --- | --- |
| `BACKUP_SCHEDULE` | | `0 3 * * *` | Cron schedule, UTC | backup | |
| `BACKUP_DATABASES` | | `DB_NAME` | Space-separated databases to dump | backup | |
| `BACKUP_KEEP_DAILY` | | `7` | Days with a dump to keep | backup | |
| `BACKUP_KEEP_WEEKLY` | | `4` | Weeks to keep one dump from | backup | |
| `BACKUP_KEEP_LABELLED` | | `5` | Labelled (pre-deploy) dumps to keep | backup | |
| `BACKUP_DB_HOST` | | `db` | The server to dump. Point at a managed Postgres when the database moves | backup | |
| `BACKUP_DB_PORT` | | `5432` | Its port | backup | |
| `BACKUP_DB_USER` | | `DB_USERNAME` | The user to dump as | backup | |
| `BACKUP_DB_PASSWORD` | | `DB_PASSWORD` | Its password | backup | |
| `BACKUP_DB_SSLMODE` | | `prefer` | `require` for most managed servers | backup | |
| `BACKUP_MAINTENANCE_DB` | | `postgres` | A database that always exists. DigitalOcean calls it `defaultdb` | backup | |
| `BACKUP_POSTGRES_IMAGE` | | `postgres:16.2-alpine` | The image the backup tools come from. `pg_dump` must be at least the server's major version | compose (build) | |
| `BACKUP_S3_BUCKET` | | | Turns on the off-server copy | backup | [setup/offsite-backups.md](./setup/offsite-backups.md) |
| `BACKUP_S3_ENDPOINT` | | AWS | For S3-compatible providers (R2, B2) | backup | [setup/offsite-backups.md](./setup/offsite-backups.md) |
| `BACKUP_S3_REGION` | | | The bucket's region; `auto` for R2 | backup | [setup/offsite-backups.md](./setup/offsite-backups.md) |
| `BACKUP_S3_ACCESS_KEY_ID` | with a bucket | | A key that may write (ideally only write) | backup | [setup/offsite-backups.md](./setup/offsite-backups.md) |
| `BACKUP_S3_SECRET_ACCESS_KEY` | with a bucket | | Its secret | backup | [setup/offsite-backups.md](./setup/offsite-backups.md) |
| `BACKUP_S3_PREFIX` | | | Folder in the bucket, e.g. `myapp/` | backup | |
| `BACKUP_S3_KEEP_DAYS` | | `30` | Delete uploaded dumps older than this; `0` never deletes (with a write-only key, use a bucket lifecycle rule) | backup | |

The scripts also read `BACKUP_DIR`, `BACKUP_METRICS_DIR` and
`BACKUP_UPLOADS_DIR` (`/backups`, `/metrics`, `/uploads`): paths inside the
container, set by its volumes. Leave them alone.

### Deploys

Set up: [setup/github.md](./setup/github.md) for registry images and the Deploy button.

Read by `deploy.sh` on the server ([deploy.md](./deploy.md)).

| Variable | Required | Default | What it does | Read by | Set up |
| --- | --- | --- | --- | --- | --- |
| `DEPLOY_IMAGE_SOURCE` | | `build` | `build` on the server, or `registry` to pull what CI published | deploy.sh | [setup/github.md](./setup/github.md) |
| `DEPLOY_IMAGE` | with `registry` | `hexagonal-auth-prod-app` | The image name without a tag; the registry path in `registry` mode (`ghcr.io/your-org/your-repo`). Must be lowercase | deploy.sh, compose | [setup/github.md](./setup/github.md) |
| `DEPLOY_KEEP_IMAGES` | | `3` | Releases kept for rollback, the live one included. At least 2 in `build` mode | deploy.sh | |
| `DEPLOY_HEALTH_TIMEOUT` | | `600` | Seconds to wait for a new release to become healthy before rolling back | deploy.sh | |
| `APP_TAG` | | `latest` | Set by `deploy.sh` to the commit being deployed: the image tag and `SENTRY_RELEASE`. Not yours to put in the file | compose | |
| `RUN_MIGRATIONS` | | `true` | Whether the production container applies migrations when it starts. `deploy.sh` sets `false` and migrates once itself, before switching. Not in the file | compose, Dockerfile | |

### Development and test services

`docker-compose.dev.yaml` reads these. None is in `.env.example`; the defaults
are fine unless a port is taken.

| Variable | Default | What it does |
| --- | --- | --- |
| `TEST_SMTP_PORT` | `1025` | Host port for Mailpit's SMTP |
| `TEST_MAILPIT_UI_PORT` | `8025` | Host port for Mailpit's web inbox |
| `TEST_S3_PORT` | `9100` | Host port for RustFS's S3 API (`pnpm test:services:up`) |
| `TEST_S3_CONSOLE_PORT` | `9101` | Host port for RustFS's web console |
| `TEST_S3_ACCESS_KEY` | `rustfsadmin` | RustFS's access key |
| `TEST_S3_SECRET_KEY` | `rustfsadmin123` | RustFS's secret key |

Compose also sets a few values for the development app container that never
come from the file: `PORT=3000`, `EMAIL_HOST=mailpit`, `EMAIL_PORT=1025`,
`EMAIL_SECURE=false` (so every email lands in Mailpit), `CI=true`, and
`TSC_WATCHFILE` / `TSC_WATCHDIRECTORY` (polling, so hot reload works on Docker
Desktop).

### Tools and load tests

| Variable | Read by | What it does |
| --- | --- | --- |
| `LOAD_EMAIL` | `pnpm load:accounts`, k6 | The load-test accounts' address pattern, e.g. `loadtest{n}@example.test` ([load-testing.md](./load-testing.md)) |
| `LOAD_PASSWORD` | `pnpm load:accounts`, k6 | Their password |
| `LOAD_USER_COUNT` | `pnpm load:accounts` | How many to create when no count is given (default 1) |

These may sit in `.env.development`; `env:check` knows them. k6 also takes
`API_URL` (default `http://localhost:8888`), `API_PREFIX`, `TOKEN`, `DURATION`,
`RAMP_UP`, `RAMP_DOWN`, `STEADY_RATE`, `SPIKE_RATE` and `UPLOAD_PEAK_VUS` as
`k6 run -e NAME=value` or from the shell, and `scripts/idempotency-race.ts`
takes `API_URL` and `TOKEN` from the shell. They are not env-file settings.

### Not in an env file: GitHub settings

The Deploy button reads these from the repository's **Settings → Secrets and
variables → Actions**, never from a file on disk:

| Name | Kind | What it is |
| --- | --- | --- |
| `DEPLOY_SSH_KEY` | secret | A private key that may log in to the server |
| `DEPLOY_HOST` | variable | The server's address |
| `DEPLOY_USER` | variable | The user to log in as |
| `DEPLOY_PATH` | variable | Where the repository is checked out on the server |
| `DEPLOY_HOST_KEY` | variable | The server's SSH host key |

[setup/github.md](./setup/github.md) and [deploy.md](./deploy.md#the-deploy-button)
explain each.

## Things that will catch you out

**`DATABASE_URL` in the file is not the one the app uses in Docker.** Compose
builds a different one pointing at the `db` service, from `DB_USERNAME`,
`DB_PASSWORD` and `DB_NAME`. The one in your file is for Prisma commands, the
CLIs and tests run on your machine, so it must use the same three values with
`localhost` and `DB_PORT`. `env:check` warns about the override in production
rather than letting you wonder why an edit had no effect.

**`PORT=8888` from the template, on a server, breaks the site.** In production
`PORT` chooses the host port the app is published on, and nginx forwards to
3000 unless `bootstrap-nginx.sh` was given another `--api-port`. Set `PORT=3000`
in `.env.production`, or give nginx the same number.

**The web app on a different domain than the API ends every session after 15
minutes.** The refresh cookie is `SameSite=Lax`, which only travels within one
site (`app.example.com` and `api.example.com` count as one). On different
domains set `AUTH_COOKIE_SAMESITE=none` and keep HTTPS
([auth/sessions-and-tokens.md](./auth/sessions-and-tokens.md)).

**Changing `BASE_URL` changes the Google redirect URI.** Google refuses a
sign-in whose return address is not registered exactly
(`redirect_uri_mismatch`). Register the new
`<BASE_URL>/api/v1/auth/google/callback` before you change it.

**Changing `AUTH_ENCRYPTION_KEY` without the old one locks people out.** Put
the old key in `AUTH_ENCRYPTION_KEY_PREVIOUS`, deploy, then run
`pnpm auth:rotate-key` ([auth/operations.md](./auth/operations.md)).

**`*_PORT` only chooses the host side.** Inside Docker the services always
reach each other on their standard ports. Changing `REDIS_PORT` to `6501`
changes where *you* connect from your machine, not what the app does.

**A `$` in a password is eaten.** Compose expands `$NAME` in env files. Quote
the value or double every `$`. `openssl rand -hex` never produces one.

**Setting `STORAGE_TYPE=s3` makes four other variables required.** The app
refuses to start with S3 selected and no bucket, rather than failing on the
first upload.

**`MONITORING=grafana-cloud` makes five more required**: the
`GRAFANA_CLOUD_PROMETHEUS_*`, `_LOKI_*` URLs and users, and `_TOKEN`. Compose,
not the app, refuses, and its error names the missing one. The other two
(`GRAFANA_CLOUD_GRAFANA_URL`, `_GRAFANA_TOKEN`) are only for the sync.

**`GRAFANA_ADMIN_PASSWORD` is read only once**, when Grafana first creates its
data volume. Changing it later does nothing until that volume is deleted. The
same is true of `DB_PASSWORD` and Postgres.

**Mail that never arrives stops every sign-up.** An account cannot sign in until
its address is confirmed with an emailed code. Send one real sign-up through
your SMTP settings before launch.

## Production is stricter

With `NODE_ENV=production` the app adds these rules on top of the ones that
always apply. Each exists because the default or the template value would be
unsafe, or would break something only later.

1. **Strong secrets**: `DB_PASSWORD`, `REDIS_PASSWORD` and
   `BULL_BOARD_PASSWORD` must be at least 12 characters, not empty, not a
   well-known default (`admin`, `password`, `secret`, `changeme`, `123456`,
   `12345678`), and not a template placeholder (anything starting with `your_`,
   `your-`, `change_me`, `changeme` or `change-me`, in any case). So
   `REDIS_PASSWORD` becomes required. The app refuses to boot rather than put
   `admin`/`admin` on an internet-facing dashboard.
2. **URL-safe database values**: `DB_NAME`, `DB_USERNAME` and `DB_PASSWORD` may
   only contain letters, digits and `.` `_` `~` `-`. Compose puts them into
   `DATABASE_URL` unescaped, where an `@`, `/`, `:` or `#` would be read as part
   of the address.
3. **`JWT_SECRET`** (at least 32 characters everywhere) must also not be a
   well-known default or start like a template placeholder.
4. **`AUTH_ENCRYPTION_KEY`** must not be the template's all-zero key, and
   neither may **`AUTH_ENCRYPTION_KEY_PREVIOUS`**: production never used it.
5. **`FRONTEND_URL` and `BASE_URL` are required** (`http` or `https` URLs):
   the links in auth emails point to the web app, and Google sign-in returns
   to the API, whose upload links also start with `BASE_URL`.
6. **`EMAIL_HOST` is required** and may not be empty: sign-up and password
   reset email a code.
7. **`CORS_CREDENTIALS` must be `true`** (empty counts as `true`): without it
   the refresh cookie never arrives and every session ends after 15 minutes.
8. **`ALERT_WEBHOOK_URL` is required**, must be `https`, and must not contain
   the template's `your_`/`your-` placeholder.
9. **`AUTH_COOKIE_SECURE` defaults to on**, so the cookies travel over HTTPS
   only (not a refusal, a different default).

These apply in every environment, and are worth knowing because they stop a
development start too:

- `JWT_SECRET` at least 32 characters; `AUTH_ENCRYPTION_KEY` at least 64 hex
  characters (32 bytes), and `AUTH_ENCRYPTION_KEY_PREVIOUS` the same shape when
  set.
- `AUTH_ENCRYPTION_KEY_PREVIOUS` may not equal `AUTH_ENCRYPTION_KEY`: the new
  key goes in `AUTH_ENCRYPTION_KEY`, the old one in `_PREVIOUS`.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set together or not at all;
  the same for `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`.
- `AUTH_COOKIE_SECURE=false` is refused with `AUTH_COOKIE_SAMESITE=none`.
- `STORAGE_TYPE=s3` requires `AWS_REGION`, `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY` and `AWS_S3_BUCKET`.
- `SENTRY_DSN`, when set, must look like a DSN and not the template's
  placeholder.

And compose, in production, refuses to start without `REDIS_PASSWORD`, and
with `MONITORING=local` without `GRAFANA_ADMIN_PASSWORD` and
`ALERT_WEBHOOK_URL` (non-empty is all it checks).

`pnpm env:check .env.production` applies all of the app's rules before you copy
the file anywhere.

## Adding a variable

1. Validate it in `src/config/validation.ts`, and read it in the matching
   `src/config/*.config.ts`.
2. Document it in `.env.example` with a comment. A commented-out
   `# NAME=default` line is enough for an optional setting.
3. Add it to your `.env.development`, to `.env.production` on the server, and
   to the tables on this page.

This holds for a variable that already exists, too: one that only compose or
`deploy.sh` read (`MONITORING`, say) needs a schema entry the day the app
starts reading it, even through `process.env` directly.

`pnpm test` fails if those drift apart (`src/config/env-check.spec.ts`): a
variable the code reads that the schema does not validate, a schema key or a
compose/`deploy.sh` variable missing from `.env.example`, or a key in
`.env.example` that nothing reads.

## Docker and env files

```yaml
# docker-compose.dev.yaml          # docker-compose.prod.yaml
env_file: [.env.development]       env_file: [.env.production]
```

Both compose files then **override** the connection values, because the env
files are written for reaching services from your machine rather than from
another container:

```yaml
environment:
  # The app always listens on 3000 inside its container.
  PORT: 3000
  # Built for the db service; the file's DATABASE_URL (localhost) is for
  # tools run on the machine, and never reaches the app.
  DATABASE_URL: postgresql://${DB_USERNAME}:${DB_PASSWORD}@db:5432/${DB_NAME}?schema=public
  REDIS_HOST: redis
  REDIS_PORT: 6379
```

The `--env-file` flag on every `docker compose` command
(`docker compose --env-file .env.production -f docker-compose.prod.yaml ...`)
is what fills in `${...}` in the compose file itself. Leave it out and compose
cannot resolve `REDIS_PASSWORD` and the other required values, so even an
`exec` into a running container fails.

With the database somewhere else (a managed server), replace that
`DATABASE_URL` line in `docker-compose.prod.yaml` with its URL
([scaling.md](./scaling.md#1-postgres)).

## Related

- [setup/prepare-for-development.md](./setup/prepare-for-development.md) and
  [setup/prepare-for-production.md](./setup/prepare-for-production.md): the
  guided walkthroughs
- [setup/README.md](./setup/README.md): every outside service, and which ones you need
- [deployment-guide.md](./deployment-guide.md): the checklist before you go live
- [docker.md](./docker.md): what the compose files do
- [auth/operations.md](./auth/operations.md): running sign-in in production
- [making-it-yours.md](./making-it-yours.md): what to change when you start a project from this
