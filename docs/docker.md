# Docker Setup

What the Dockerfile and the two compose files do, for anyone who needs to
change them or wonders what is running. To just start the stack, see
[GETTING_STARTED.md](../GETTING_STARTED.md); to deploy, see
[deploy.md](./deploy.md).

This project uses a **multi-stage Dockerfile** and **two separate compose
files**: one for development and one for production. Each includes the
monitoring services from `monitoring/compose/`, chosen by `MONITORING`.

- [Files](#files)
- [Dockerfile Stages](#dockerfile-stages)
- [Usage](#usage)
  - [Development](#development)
  - [Lighter ways to run](#lighter-ways-to-run)
  - [Production (Single VPS)](#production-single-vps)
- [Dev vs Prod Comparison](#dev-vs-prod-comparison)
- [Understanding the Port Mapping Problem](#understanding-the-port-mapping-problem)
- [Resource Budget (Production VPS)](#resource-budget-production-vps)
- [Common Operations](#common-operations)
- [Related](#related)

---

## Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage build with `dev` and `prod` targets |
| `.dockerignore` | Excludes unnecessary files from the build context |
| `docker-compose.dev.yaml` | Full dev stack with hot reload (project `nezfocus-web-dev`) |
| `docker-compose.prod.yaml` | Full prod stack, hardened for a single VPS (project `hexagonal-auth-prod`) |
| `monitoring/compose/{dev,prod}-{local,grafana-cloud}.yaml` | The monitoring services, included by the two files above |
| `monitoring/compose/dev-exporters.yaml` | The dev exporters, included by the two dev monitoring files |
| `monitoring/compose/dev-off.yaml` | Empty: what the dev file includes with `MONITORING=off` |
| `backup/Dockerfile` | The production backup service's image |

---

## Dockerfile Stages

```
base  →  deps  →  build
           ↘  dev (target)
base  →  prod (target, copies dist/ and generated/ from build)
```

| Stage | Based on | What it does |
|-------|----------|-------------|
| `base` | `node:22.23.2-alpine` | Installs system deps (OpenSSL for Prisma, libc6 for Sharp) |
| `deps` | `base` | Runs `pnpm install --frozen-lockfile --ignore-scripts`: all dependencies |
| `build` | `deps` | Runs `prisma generate` + `nest build` → produces `dist/` |
| **`dev`** | `deps` | Copies source, then `scripts/dev-start.sh`: installs only when the lockfile changed, generates the Prisma client, applies migrations, starts with hot reload |
| **`prod`** | `base` | Installs production dependencies only, copies `dist/` and the generated client. Runs as the non-root `nestjs` user. Starts with `prisma migrate deploy` unless `RUN_MIGRATIONS=false`, then `node dist/src/main` |

> [!NOTE]
> `--ignore-scripts` keeps install scripts (Husky among them) from running inside the build, where there is no `.git` directory. The packages that genuinely need a build step are listed in `pnpm-workspace.yaml` under `onlyBuiltDependencies`: that list is the approval, and the `prod` stage's install builds them.

> [!NOTE]
> `prisma generate` requires a `DATABASE_URL` to load `prisma.config.ts`, even though it doesn't connect to a database. A dummy URL is passed at build time: `DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy`.

---

## Usage

### Development

```bash
pnpm docker:dev
# which is:
docker compose --env-file .env.development -f docker-compose.dev.yaml up -d --build --remove-orphans
```

**What runs:**

- The NestJS app with hot reload (source bind-mounted into the container)
- PostgreSQL (with a healthcheck the app waits for) and Redis
- **Mailpit**, which catches every email the app sends. It is required, not
  optional: signing up is confirmed with an emailed code. The dev compose file
  sets `EMAIL_HOST=mailpit` for the app **whatever `.env.development` says**,
  so nothing is ever delivered for real from the container
- With `MONITORING=local` (the default): Prometheus, Grafana, Loki,
  Alertmanager and Alloy. With `grafana-cloud`: only Alloy. With either,
  node-exporter, postgres-exporter and redis-exporter (metrics for the alerts).
  With `off`: none of these ([Lighter ways to run](#lighter-ways-to-run))
- **RustFS** (S3-compatible storage) is under the `testing` profile, so
  `pnpm docker:dev` does not start it. `pnpm test:services:up` does, and
  creates `AWS_S3_BUCKET` in it

**Access** (the `.env.example` ports; every one bound to `127.0.0.1`):

| Service | URL |
|---------|-----|
| API | `http://localhost:${PORT}` (8888) |
| API docs | `http://localhost:${PORT}/api-docs` |
| Bull Board (queues) | `http://localhost:${PORT}/admin/queues` |
| Mailpit | `http://localhost:8025` (`TEST_MAILPIT_UI_PORT`) |
| Grafana | `http://localhost:${GRAFANA_PORT}` (3002) |
| Prometheus | `http://localhost:${PROMETHEUS_PORT}` (9090) |
| Alertmanager | `http://localhost:${ALERTMANAGER_PORT}` (9093) |
| RustFS console | `http://localhost:9101/rustfs/console/` (after `pnpm test:services:up`) |
| Node debug | `localhost:9229` |

Inside its container the app always listens on 3000; `PORT` is only the host
side of the mapping.

### Lighter ways to run

The full stack is heavy on a laptop, Docker Desktop on Windows above all. The
source is bind-mounted from the Windows drive, every file the app reads crosses
into the Linux VM, and the watcher has to poll for changes; the first start of
the app container takes minutes and keeps the CPU busy. Two lighter ways, for
when you don't need Grafana:

**The API on your machine, the services in Docker** (the lightest, for most
days):

```bash
pnpm docker:services   # db, redis, mailpit, rustfs; stops the app container if it runs
pnpm dev               # the API, on the host, with hot reload
```

`.env.development` already points at `localhost` and the host ports: the
compose file is what rewrites them for the container ([the port
mapping](#understanding-the-port-mapping-problem)). The API starts in seconds,
watches files natively and logs in colour, and the debugger attaches directly.
After pulling new migrations, apply them with `pnpm exec prisma migrate deploy`
(the container does that at each start). Two things differ from the container:

- **Grafana sees nothing of the API.** Prometheus scrapes `app:3000` on the
  Docker network and Alloy reads containers' output; neither reaches a process
  on the host. When you want the dashboards, run the full stack.
- **Windows file names ignore case; Linux's don't.** An import whose case is
  wrong works on the host and fails in the container, in CI and in production.
  Run `pnpm docker:dev` once before pushing, or let CI tell you.

**Everything in Docker, without the monitoring** (closest to production):
set `MONITORING=off` in `.env.development` (or `MONITORING=off pnpm docker:dev`).
No Prometheus, Grafana, Loki, Alertmanager, Alloy or exporters start, and the
app logs in colour, since nothing parses its output. Containers started
earlier with `local` keep running until `pnpm docker:down`, or the next
`pnpm docker:dev` or `pnpm docker:services`: their `--remove-orphans` removes
them. Their data volumes stay, for when you switch back. `off` is for development:
the production file and `deploy.sh` accept only `local` and `grafana-cloud`.

With monitoring on, the container logs JSON, which Alloy parses into labels
([logging.md](./logging.md#log-format-json-or-pretty)). `pnpm docker:logs`
shows it in colour either way.

### Production (Single VPS)

`./deploy.sh` is the normal way to start and update production
([deploy.md](./deploy.md)). By hand:

```bash
# First time: create your production env file from the template
cp .env.example .env.production
nano .env.production       # see setup/prepare-for-production.md

# Start everything
docker compose --env-file .env.production -f docker-compose.prod.yaml up -d --build --remove-orphans
```

**What's different in prod:**

- Builds from the `prod` Dockerfile target (compiled JS, no devDependencies, non-root user)
- Applies migrations when the container starts (`prisma migrate deploy`), unless
  `RUN_MIGRATIONS=false`. `deploy.sh` sets it to `false` and migrates once
  itself, before switching versions, so a failing migration stops the deploy
  while the old version keeps serving
- A **backup** service: nightly dumps, and a dump before each deploy that adds
  migrations ([backups.md](./backups.md))
- No Mailpit: email goes to your SMTP provider (`EMAIL_*`, required)
- Every published port binds to `127.0.0.1`: only nginx on the host is reachable
  from outside
- Healthchecks on the app, Postgres, Redis and the backup service, with
  `condition: service_healthy` ordering
- Resource limits on every service
- Log rotation (`json-file`, max 5-10 MB × 3 files)
- Redis AOF persistence and `noeviction`

---

## Dev vs Prod Comparison

| Aspect | Dev | Prod |
|--------|-----|------|
| Dockerfile target | `dev` | `prod` |
| Source code | Bind-mounted (hot reload) | Baked into image (`dist/`) |
| Node.js dependencies | All (devDeps included) | Prod only |
| Debug port (9229) | Exposed on `127.0.0.1` | Not exposed |
| Runs as | root | `nestjs` (non-root, UID 1001) |
| `NODE_ENV` | development | production |
| Email | Mailpit, forced by compose | Your SMTP provider |
| Backups | None | `backup` service |
| Service ports | `127.0.0.1` only, host side from `.env.development` | `127.0.0.1` only, host side from `.env.production` |
| Health checks | Postgres (the app waits for it); RustFS under `testing` | App, Postgres, Redis, backup |
| Resource limits | None | CPU + memory capped |
| Redis persistence | Default snapshotting, no volume | AOF on a volume |

---

## Understanding the Port Mapping Problem

When your `.env.development` has custom host ports (e.g. `REDIS_PORT=6501` to avoid local machine conflicts), Docker Compose maps `6501 → 6379` on the host. However, **container-to-container traffic bypasses port mappings entirely**: the app container connects directly to `redis:6379` inside Docker's network.

This is why both compose files have an `environment:` block that overrides the connection values:

```yaml
environment:
  PORT: 3000          # the app always listens on 3000 inside its container
  REDIS_HOST: redis   # Docker service name, not localhost
  REDIS_PORT: 6379    # internal container port, not host-mapped 6501
  # The database is reached through this one URL, built for the db service.
  DATABASE_URL: postgresql://${DB_USERNAME}:${DB_PASSWORD}@db:5432/${DB_NAME}?schema=public
```

The production file does the same, so a `.env.production` copied from `.env.example` works as it is: `pnpm env:check` lists these keys as ignored, because the compose file replaces them ([environment.md](./environment.md)). One exception to "works as it is": `PORT` is also the host port nginx forwards to, so set `PORT=3000` in `.env.production` ([environment.md](./environment.md#things-that-will-catch-you-out)).

---

## Resource Budget (Production VPS)

The limits in `docker-compose.prod.yaml` and `monitoring/compose/prod-local.yaml`:

| Service | Memory Limit | CPU Limit |
|---------|-------------|-----------|
| App (NestJS) | 512 MB | 1.0 |
| PostgreSQL | 512 MB | 1.0 |
| Redis | 300 MB | 0.5 |
| Backup | 256 MB | 0.5 |
| node-exporter, postgres-exporter, redis-exporter | 64 MB each | 0.2 each |
| Prometheus | 256 MB | 0.5 |
| Grafana | 256 MB | 0.5 |
| Loki | 256 MB | 0.5 |
| Alertmanager | 128 MB | 0.2 |
| Alloy | 256 MB | 0.25 |
| **Total** | **~2.9 GB** | **~5.55** |

These are ceilings, not what the services use day to day. With
`MONITORING=grafana-cloud`, Prometheus, Grafana, Loki and Alertmanager are gone
(about 900 MB less).

> [!TIP]
> A VPS with 4 GB RAM and 2 vCPUs is the recommended minimum with self-hosted monitoring. 8 GB / 4 vCPU gives comfortable headroom.

---

## Common Operations

```bash
# View app logs, in colour (the last 200 lines, then following)
pnpm docker:logs

# Create a migration after changing prisma/ (from the host, against the dev database)
pnpm prisma:migrate

# Open a shell in the container
docker compose --env-file .env.development -f docker-compose.dev.yaml exec app sh

# Rebuild only the app service (after code changes that need a fresh install)
docker compose --env-file .env.development -f docker-compose.dev.yaml up -d --build app

# Stop everything and remove volumes (full reset: deletes the dev database)
pnpm docker:reset
```

Pass `--env-file` on every `docker compose` command. Compose fills `${...}` in
the files from it, and the production file refuses to resolve without
`REDIS_PASSWORD` and the other required values, even for `logs` or `exec`.

---

## Related

- [environment.md](./environment.md): every setting, and how compose overrides some
- [deploy.md](./deploy.md): releases and rollback on the server
- [prisma-module.md](./prisma-module.md): database migrations
- [monitoring.md](./monitoring.md): Prometheus, Grafana, Loki setup
