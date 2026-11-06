# Getting Started

This guide takes a fresh clone to a running API with an account you can sign
in to, in about ten minutes. Everything runs in Docker, so the only things to
install are Node, pnpm and Docker itself.

For what the starter actually *is* (the pieces, how they fit, and why), read
[the tour](./OVERVIEW.md). For the longer guided setup, with the optional
services (Google sign-in, S3 storage, Sentry, the web app), follow
[docs/setup/prepare-for-development.md](./docs/setup/prepare-for-development.md).
This page is only about getting it up.

## Prerequisites

- **Node.js 22** or newer (`.nvmrc` names the exact version this repository is
  tested with)
- **pnpm**: run `corepack enable` once, and it uses the version pinned in
  `package.json`
- **Docker Desktop**, or Docker Engine 25 or newer with the compose plugin
- **Git**

---

## Quick Start

### 1. Clone and install

```bash
git clone <repository-url>
cd Nest-Hexagonal-No-Keycloak
pnpm install
pnpm prisma:generate    # the database client, into generated/ (not committed)
```

The app in Docker generates its own client. The one on your machine is what
your editor's types, the tests and every command you run here (`pnpm dev`,
`pnpm test`, `pnpm user:promote`) use, so run `pnpm prisma:generate` again
after pulling a change to `prisma/`.

### 2. Make your environment file

```bash
cp .env.example .env.development
```

`.env.example` is the template for both `.env.development` and
`.env.production`, and every setting in it is explained by a comment above it.
**A plain copy runs as it is.** A few values are worth knowing about now:

| Variable | What it is | In development |
|---|---|---|
| `DB_NAME`, `DB_USERNAME`, `DB_PASSWORD` | The database Postgres creates on its first start | The template's values work. Change them now if you want, not later (Postgres reads them only once) |
| `DATABASE_URL` | How tools **on this machine** reach that database (`pnpm prisma:migrate`, `pnpm dev`, `pnpm user:promote`) | The template's line already uses the three values above. If you change any of them, change it here too. The app in Docker builds its own and ignores this one |
| `REDIS_PASSWORD` | Redis' password | Any value |
| `JWT_SECRET` | Signs sign-in tokens. At least 32 characters | The template's placeholder is long enough for development. Production needs `openssl rand -hex 32` |
| `FRONTEND_URL` | The web app's address: links in emails, and the return from Google sign-in, point there | `http://localhost:3001`, where the [React starter](https://github.com/StoriuSs/React-Starter-No-Keycloak) runs. Required in production |
| `CORS_ORIGINS` | The web pages allowed to call the API with cookies | `http://localhost:3001`, the same web app |
| `GRAFANA_ADMIN_PASSWORD` | The Grafana login (user `admin`) | `admin` is fine on your machine |
| `BULL_BOARD_PASSWORD` | The queue dashboard at `/admin/queues` (user `BULL_BOARD_USER`) | `admin` is fine on your machine |

Leave `GOOGLE_CLIENT_*` empty for now: Google sign-in stays off until you set
them. Every variable is in [docs/environment.md](./docs/environment.md).

To check the file against what the app expects, at any time:

```bash
pnpm env:check
```

### 3. Start everything

```bash
pnpm docker:dev
```

This builds the app image and starts, all in the `nezfocus-web-dev` Compose
project:

| Service | Where it is | Notes |
|---|---|---|
| The API | `http://localhost:8888` (`PORT`) | Hot reload: your edits restart it. Inside its container it listens on 3000 |
| API documentation | `http://localhost:8888/api-docs` | Every route, tried from the browser |
| Queue dashboard | `http://localhost:8888/admin/queues` | `BULL_BOARD_USER` / `BULL_BOARD_PASSWORD` |
| Mailpit | `http://localhost:8025` | An inbox that catches every email the app sends, sign-up codes included. Nothing is delivered for real |
| Postgres | `localhost:5432` (`DB_PORT`) | The app's database |
| Redis | `localhost:6379` (`REDIS_PORT`) | Cache, queues, rate limits, idempotency, the session check |
| Grafana | `http://localhost:3002` (`GRAFANA_PORT`) | `admin` / `GRAFANA_ADMIN_PASSWORD` |
| Prometheus | `http://localhost:9090` (`PROMETHEUS_PORT`) | Metrics |
| Alertmanager | `http://localhost:9093` (`ALERTMANAGER_PORT`) | Alerts |
| Loki, Alloy | through Grafana | Logs |
| RustFS | `pnpm test:services:up` starts it | S3 storage, for the tests and development avatars |

Port 3001 is left free for the web app's development server.

The app container installs dependencies when the lockfile changed, applies any
pending migrations, then starts. The first start takes a few minutes.

`pnpm docker:down` stops everything; `pnpm docker:reset` also deletes the
development data. `pnpm docker:logs` follows the app's output.

### 4. Check that it works

```bash
curl http://localhost:8888/api/v1/health/ready
```

`ready` means the database and Redis answered. `/api/v1/health` checks
everything, `/api/v1/health/live` only that the process is up.

### 5. Make yourself an account

Every route that is not marked `@Public()` needs a signed-in user. Sign-up
works like this: you register, the API emails a 6-digit code (it lands in
Mailpit), and confirming that code signs you in.

With the [React starter](https://github.com/StoriuSs/React-Starter-No-Keycloak)
running on port 3001, sign up there. Or by hand, with `curl`:

```bash
API=http://localhost:8888/api/v1

# 1. Register. The answer is 202 AUTH_CODE_SENT, whatever the address: the API
#    never says whether an account exists.
curl -X POST $API/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"Harbour-Lantern-42"}'
```

2. Open **http://localhost:8025**. The newest email, "Verify your ... account",
   holds the code. It works for 10 minutes and allows 5 tries.

```bash
# 3. Confirm the address with that code. This signs you in: the answer's
#    data.access_token is your access token, valid for 15 minutes. -c keeps
#    the refresh cookie in a file.
curl -c cookies.txt -X POST $API/auth/verify-email -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","code":"123456"}'

# 4. Call a protected route with the token.
TOKEN=<data.access_token from the answer above>
curl $API/users/me -H "Authorization: Bearer $TOKEN"

# Later: sign in again, or swap the refresh cookie for a new access token.
curl -c cookies.txt -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"Harbour-Lantern-42"}'
curl -b cookies.txt -c cookies.txt -X POST $API/auth/refresh
```

Bodies and answers are `snake_case` on the wire. A password needs at least 8
characters with a lower-case letter, an upper-case letter, a digit and a
symbol, and may not be a common one: a refused password answers
`422 AUTH_PASSWORD_REJECTED` and `data.rules` names each broken rule.

To make that account an administrator (from this machine: it uses the
`DATABASE_URL` from step 2 and the client from `pnpm prisma:generate`):

```bash
pnpm user:promote you@example.com
```

**Google sign-in** is a browser redirect, so try it from the web app:
[docs/setup/google-sign-in.md](./docs/setup/google-sign-in.md), with `http://localhost:8888/api/v1/auth/google/callback` as the redirect URI.

How all of it works: [docs/auth/README.md](./docs/auth/README.md), and
[docs/auth/api-reference.md](./docs/auth/api-reference.md) for every route.

---

## Working on the code

You can work entirely in Docker (step 3), or run the app on this machine
against the services in Docker:

```bash
docker compose --env-file .env.development -f docker-compose.dev.yaml stop app   # frees port 8888
pnpm test:services:up   # Postgres, Redis, RustFS, Mailpit
pnpm prisma:generate    # once, and after every change to prisma/
pnpm prisma:migrate     # apply migrations, using DATABASE_URL
pnpm dev                # the app, with hot reload, on PORT (8888)
```

On this machine the app reads `.env.development` directly, so `DATABASE_URL`,
`REDIS_HOST=localhost` and `EMAIL_HOST=localhost` / `EMAIL_PORT=1025` (Mailpit)
are the values it uses.

Day-to-day commands:

```bash
pnpm lint               # ESLint, with --fix available as pnpm lint:fix
pnpm format             # Prettier
pnpm test               # unit tests
pnpm test:e2e           # end-to-end tests
pnpm test:integration   # against Postgres, Redis, RustFS and Mailpit (test:services:up first)
pnpm openapi:check      # the committed openapi.json still matches the code
```

Git hooks run some of these for you: `lint-staged` on the staged files before
each commit, and the unit and e2e suites before each push
([docs/git-hooks.md](./docs/git-hooks.md)).

---

## Common changes

### A port is already taken

Change it in `.env.development` (`PORT`, `DB_PORT`, `REDIS_PORT`,
`GRAFANA_PORT`, ...) and run `pnpm docker:dev` again. Those values are the
**host** side only: inside Docker the services always talk to each other on
their standard ports, so nothing else needs changing. If you move `PORT`, also
change `BASE_URL`, and the redirect URI registered with Google if you use it.

### Different database credentials

Change `DB_USERNAME`, `DB_PASSWORD` or `DB_NAME` in `.env.development` (and
`DATABASE_URL` to match), then `pnpm docker:reset` (which deletes the data) or
create the role yourself. Postgres reads them only when it first creates its
data directory.

### Less monitoring while you work

Stop what you don't need; nothing else depends on it:

```bash
docker compose --env-file .env.development -f docker-compose.dev.yaml stop grafana prometheus loki alloy alertmanager
```

To send metrics and logs to Grafana Cloud instead of running the stack
locally, set `MONITORING=grafana-cloud`: see
[docs/monitoring.md](./docs/monitoring.md).

---

## Project structure

```
├── src/
│   ├── bootstrap/      # Scripts: env check, OpenAPI export, user roles,
│   │                   # monitoring cloud sync
│   ├── config/         # Settings and their validation schema
│   ├── health/         # Health endpoints
│   ├── modules/        # Feature modules (hexagonal: domain/application/…)
│   │   ├── auth/       # Sign-up, sign-in, sessions, Google, account deletion
│   │   └── users/      # Profiles, usernames, avatars, account deletion
│   ├── shared/         # Guards, interceptors, filters, infrastructure
│   └── main.ts         # Entry point
├── prisma/             # Schema (models/auth.prisma, models/users.prisma) and migrations
├── test/               # e2e and integration suites
├── monitoring/         # Prometheus, Loki, Alloy, Grafana, Alertmanager
├── backup/             # Nightly backups and restore.sh
├── nginx/              # The host web server's configuration for a server
├── k6/                 # Load-test scripts, run by hand before a launch
├── scripts/            # Helpers used by the package scripts and CI
├── deploy.sh           # Deploys a release on a server
├── docker-compose.dev.yaml
└── docker-compose.prod.yaml
```

---

## Next steps

- **The full guided setup**: [Prepare for development](./docs/setup/prepare-for-development.md),
  then [Prepare for production](./docs/setup/prepare-for-production.md)
- **Authentication**: [docs/auth/](./docs/auth/README.md)
- **Architecture**: [Hexagonal Architecture](./docs/hexagonal-architecture.md),
  [CQRS](./docs/cqrs-guide.md), [Adding a module](./docs/adding-a-module.md)
- **Data**: [Prisma Module](./docs/prisma-module.md),
  [Cache](./docs/cache.md), [Rate Limiting](./docs/rate-limit.md)
- **Operations**: [Docker](./docs/docker.md),
  [Environment](./docs/environment.md), [Deploy](./docs/deploy.md),
  [Backups](./docs/backups.md), [CI](./docs/ci.md)
- **Observability**: [Monitoring](./docs/monitoring.md),
  [Logging](./docs/logging.md), [Alerts](./docs/alerts.md),
  [Error tracking](./docs/error-tracking.md)
- **Testing**: [Testing Guide](./docs/testing.md),
  [Load testing](./docs/load-testing.md)
- **Going live**: [Going to production](./docs/deployment-guide.md),
  [Preparing a server](./docs/server.md), [Scaling](./docs/scaling.md)
- **What is not here**: [Extensions](./docs/extensions.md)

---

## Troubleshooting

### A container won't start

```bash
docker compose --env-file .env.development -f docker-compose.dev.yaml ps
docker logs nestapp-nezfocus-web-dev     # or postgres-nezfocus-web, redis-nezfocus-web
```

A port already in use is the usual cause ("port is already allocated"): see
"A port is already taken" above. An invalid setting stops the app at boot with
a message naming it; `pnpm env:check` lists all of them at once.

### The app can't reach the database

```
Error: P1000: Authentication failed against database server, the provided
database credentials for `your_db_user` are not valid.
```

with Postgres itself showing as **healthy** in `docker ps`.

That combination almost always means one thing: **Postgres already has a data
directory, created with different credentials.** `POSTGRES_USER` and
`POSTGRES_PASSWORD` are read only when the volume is first created, and are
ignored on every start after that. So changing `DB_USERNAME` or `DB_PASSWORD`
in `.env.development`, or reusing the volume from an earlier project, leaves
the database expecting the old ones.

It is healthy because it is running perfectly well. It just does not have the
account you are asking for.

The fix, if the data is disposable:

```bash
pnpm docker:reset     # down -v: deletes the development database
pnpm docker:dev
```

**`docker:reset` deletes data.** If you want to keep it, create the role
instead:

```bash
docker exec -it postgres-nezfocus-web psql -U <the original user> -c \
    "CREATE ROLE your_db_user LOGIN PASSWORD 'your_db_password' SUPERUSER"
```

Other things to check: is Postgres healthy at all (`docker ps`), and
`docker logs postgres-nezfocus-web`. When the error comes from a command you
ran on this machine (`pnpm prisma:migrate`), it is `DATABASE_URL` that does not
match.

### Every request comes back 401

Every route except the `@Public()` ones needs `Authorization: Bearer <token>`.
`meta.type` in the answer says which case it is: `AUTH_TOKEN_MISSING` (no
header), `AUTH_TOKEN_EXPIRED` (refresh or sign in again: tokens last 15
minutes), `AUTH_TOKEN_REVOKED` (that session was signed out). See
[step 5](#5-make-yourself-an-account), and
[docs/auth/api-reference.md](./docs/auth/api-reference.md) for every error.

### The confirmation email never arrives

Open Mailpit at http://localhost:8025. In Docker every email goes there,
whatever `EMAIL_*` says. If it is not there either, look at the `auth` queue on
`/admin/queues` for a failed `send-code` job and its error. Running the app
outside Docker (`pnpm dev`), `EMAIL_HOST` must be `localhost`, `EMAIL_PORT`
`1025`, and Mailpit must be running (`pnpm test:services:up` starts it).

### `429` on sign-up or sign-in

The sign-in routes have their own limits: one sign-up email per address per
minute, five failed sign-ins per address per 15 minutes, and more. The answer's
`Retry-After` header says how long to wait, and `data.reason` which limit it
was ([docs/auth/rate-limits.md](./docs/auth/rate-limits.md)). In development
you can delete the counters (`rl:*` keys) rather than wait:

```bash
docker exec redis-nezfocus-web sh -c "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del"
```

### pnpm says "Unsupported environment"

Your Node is not the version this project needs (`.nvmrc`, and `engines` in
`package.json`). pnpm refuses rather than letting you install or run with it,
because the difference shows up later as tests that fail here and pass in CI.

```bash
node -v                 # what you have
cat .nvmrc              # what this project wants
```

Then switch: `nvm use`, `fnm use`, or `volta pin node@22`.

### Migrations are in a mess locally

This deletes all local data and replays every migration:

```bash
pnpm prisma:reset
```

---

## Additional resources

- [NestJS Documentation](https://docs.nestjs.com)
- [Prisma Documentation](https://www.prisma.io/docs)
