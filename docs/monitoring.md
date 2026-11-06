<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**  *generated with [DocToc](https://github.com/thlorenz/doctoc)*

- [Metrics Monitoring (Prometheus + Grafana)](#metrics-monitoring-prometheus--grafana)
  - [Cloning checklist — what to rename in a new project](#cloning-checklist--what-to-rename-in-a-new-project)
  - [Quick Start](#quick-start)
  - [Available Metrics](#available-metrics)
    - [HTTP Metrics (Automatic)](#http-metrics-automatic)
    - [Database Metrics (Automatic via Prisma)](#database-metrics-automatic-via-prisma)
    - [Cache Metrics](#cache-metrics)
    - [Auth Metrics](#auth-metrics)
    - [Queue Metrics (BullMQ)](#queue-metrics-bullmq)
    - [Node.js Default Metrics](#nodejs-default-metrics)
    - [Postgres, Redis, the server](#postgres-redis-the-server)
  - [Grafana Dashboards](#grafana-dashboards)
  - [Adding Cache Metrics](#adding-cache-metrics)
  - [Adding Custom Business Metrics](#adding-custom-business-metrics)
  - [Architecture](#architecture)
  - [Configuration](#configuration)
    - [Environment Variables](#environment-variables)
  - [Key Files](#key-files)
  - [Grafana Cloud](#grafana-cloud)
  - [Checking the configuration](#checking-the-configuration)
  - [Versions](#versions)
  - [Upgrading from Promtail and Loki 2](#upgrading-from-promtail-and-loki-2)
  - [Troubleshooting](#troubleshooting)
    - [Prometheus can't reach NestJS](#prometheus-cant-reach-nestjs)
    - [No data in Grafana](#no-data-in-grafana)
    - [DB metrics not showing](#db-metrics-not-showing)
    - [Cache metrics always 0](#cache-metrics-always-0)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

# Metrics Monitoring (Prometheus + Grafana)

This guide explains how to set up metrics collection and visualization for your NestJS API.

Metrics show *that* something is slow or failing; the logs ([logging.md](./logging.md)) show *what* happened. Traces, which show *where the time went* inside one request, are off by default: [error-tracking.md, "Tracing"](./error-tracking.md#tracing) explains them and when to turn them on.

## Cloning checklist — what to rename in a new project

Almost the whole monitoring stack is generic: it keys on **Compose service names** (`app`, `db`, `loki`, …) and standard metric names, not on container names. When you clone the starter, one thing needs attention.

### The project name: nothing to change

Rename the Compose project (`name:` at the top of each compose file) freely. Alloy collects the containers of that project, and alerts carry it as their `project` label; both get it from compose (`COMPOSE_PROJECT: ${COMPOSE_PROJECT_NAME}` on the alloy and prometheus services), so it always matches, `-p` included.

### The service names stay `app`, `db`, `redis` (or update these places)

These refer to services by their Compose service names:

| File | Reference |
|---|---|
| `monitoring/prometheus/prometheus.yml` | scrape target `app:3000`, and the exporters |
| `monitoring/prometheus/rules/*.yml` | job names (`nestjs-app`, `postgres`, `redis`) and alert names; `monitoring/alertmanager/alertmanager.yml` routes those alert names; see [alerts.md](./alerts.md) |
| `docker-compose.*.yaml` | `postgres-exporter` connects to `db`, `redis-exporter` to `redis` |
| `monitoring/alloy/modules/container-logs.alloy` | JSON parsing for `{service="app"}` |
| `monitoring/loki/rules/app-logs.yml` | queries `{service="app"}` |
| `monitoring/grafana/provisioning/dashboards/nestjs-logs.json` | queries `{service="app"}` |

Keep the service names and nothing needs changing. Container names (`container_name:`) can be anything.

The app always listens on **3000 inside its container**. Both compose files set `PORT: 3000` on the app service, and `PORT` in the env file only chooses the host port. Prometheus and the production healthcheck rely on that.

### Things that do NOT need changing

- `monitoring/loki/loki-config.yml` — retention and storage only.
- `monitoring/grafana/provisioning/datasources/*.yml` — use the Docker service names `loki`, `prometheus` and `alertmanager`.
- `nestjs-api.json` — standard metric names (`http_requests_total`, `http_request_duration_seconds`, …).
- `docker-logs.json` — all services except `loki` and `alloy` (excluded to avoid logging Grafana's own queries back into Loki).

### Sanity check after cloning

```bash
# Prometheus scraping the app?
curl -s http://localhost:${PROMETHEUS_PORT}/api/v1/targets | grep -o '"health":"[a-z]*"'
# → "health":"up" for every job: nestjs-app, node-exporter, postgres, redis, ...

# Alloy found the stack's containers? Open http://localhost:${ALLOY_PORT}
# → loki.source.docker.containers lists them under targets_info

# Loki has streams per service?
curl -s http://localhost:${LOKI_PORT}/loki/api/v1/label/service/values
# → ["app","db","grafana",...]
```

Then open Grafana → Dashboards. The dashboards should show data within about 15 seconds of traffic.

---

For log aggregation, see [Logging Guide](./logging.md). For alerts (Discord, the alert rules, the outside uptime check), see [Alerts](./alerts.md).

## Quick Start

The monitoring services are part of the normal stack. They run on the server with `MONITORING=local` (the default); with `MONITORING=grafana-cloud` only Alloy does, and everything below lives in Grafana Cloud instead — see [Grafana Cloud](#grafana-cloud).

```bash
pnpm docker:dev      # dev: app, db, redis, mailpit, prometheus, alertmanager, grafana, loki, alloy, and the node, postgres and redis exporters
pnpm docker:prod     # prod equivalent (uses .env.production)
```

| UI | Dev URL | Notes |
|---|---|---|
| Grafana | `http://localhost:${GRAFANA_PORT}` (default 3002; 3001 is the web app's dev server) | Login `admin` / `GRAFANA_ADMIN_PASSWORD` |
| Prometheus | `http://localhost:${PROMETHEUS_PORT}` (default 9090) | Status → Targets shows scrape health; Alerts shows the alert rules |
| Alertmanager | `http://localhost:${ALERTMANAGER_PORT}` (default 9093) | Firing alerts and silences; see [alerts.md](./alerts.md) |
| Alloy | `http://localhost:${ALLOY_PORT}` (default 12345) | The log collector: what it reads and sends; see [logging.md](./logging.md#what-alloy-does-with-each-line) |

In production they all bind to `127.0.0.1`; reach them over an SSH tunnel.

Prometheus scrapes `app:3000/api/v1/metrics` every 5 seconds over the Docker network.

---

## Available Metrics

### HTTP Metrics (Automatic)

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `http_requests_total` | Counter | method, path, status_code | Total HTTP requests |
| `http_request_duration_seconds` | Histogram | method, path | Request duration distribution |
| `http_active_requests` | Gauge | — | Currently active requests |

### Database Metrics (Automatic via Prisma)

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `db_queries_total` | Counter | operation | Total database queries |
| `db_query_duration_seconds` | Histogram | operation | Query duration by operation type |

Operations include: `findMany`, `findUnique`, `create`, `update`, `delete`, etc.

### Cache Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `cache_hits_total` | Counter | Cache hits, by `cache` |
| `cache_misses_total` | Counter | Cache misses, by `cache` |

The auth guard's per-request check is recorded already, as two caches, both read on every signed-in request ([`redis-session-cache.adapter.ts`](../src/modules/auth/infrastructure/adapters/redis-session-cache.adapter.ts)):

| `cache` label | What is cached | A miss reads |
|---|---|---|
| `auth_session` | whether the session named in the access token is still live | the `Session` row in Postgres |
| `auth_user` | the signed-in user | the `User` row in Postgres |

For your own caches, see [Adding Cache Metrics](#adding-cache-metrics) below.

### Auth Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `auth_events_total` | Counter | event | Sign-in and account events, by what happened |

The `event` label is one of a fixed list ([`auth-events.port.ts`](../src/modules/auth/application/ports/auth-events.port.ts)):

| Group | `event` values |
|---|---|
| Signing in | `login_succeeded`, `login_failed`, `login_rate_limited`, `oauth_login_succeeded`, `oauth_login_failed` |
| Sessions | `refresh_reuse_detected` |
| Accounts | `registration`, `password_reset`, `password_set`, `oauth_account_linked`, `account_deleted` |

Every value starts at 0 when the app starts
([`prometheus-auth-events.adapter.ts`](../src/modules/auth/infrastructure/adapters/prometheus-auth-events.adapter.ts)).
That matters for alerts: Prometheus' `increase()` cannot count a series' first
sample, so a counter that first appeared at 1 (the first refresh-token reuse
since a restart) would never fire.

Where you see it:

- **Dashboard:** the NestJS API dashboard's **Sign-in and accounts** row:
  sign-ins, failed sign-ins, sign-ins refused by the limits, refresh-token
  reuse, every sign-in outcome per minute, and account changes per minute.
- **Alerts** (the `auth` group in `monitoring/prometheus/rules/app.yml`,
  explained in [alerts.md](./alerts.md)):
  - `AuthFailedLoginSpike`: more than 50 `login_failed` in 10 minutes, for 5
    minutes. Someone may be guessing passwords across many addresses or IPs.
  - `AuthRefreshTokenReuse`: any `refresh_reuse_detected` in 15 minutes. A
    session was ended because its refresh token came back after being
    replaced; Sentry has the user id.

[auth/operations.md](./auth/operations.md) says what to do when either fires.

### Queue Metrics (BullMQ)

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `bullmq_jobs` | Gauge | queue, state | Jobs in each queue by state (`waiting`, `active`, `delayed`, `failed`, `completed`, …) |

Read from Redis each time Prometheus scrapes, for every BullMQ queue a module registers: a new queue appears without further code. The starter has three: `auth` (sign-in emails and the hourly auth clean-up), `file-cleanup` (deleting replaced and deleted avatars) and `maintenance` (the deleted-account sweep). All three show on the Redis dashboard. If Redis doesn't answer within 2 seconds, the queue is left out of that scrape rather than reported with old numbers. Every app instance reports the same queues, so aggregate with `max`, not `sum`.

### Node.js Default Metrics

All standard Node.js metrics are exposed automatically:
- `process_cpu_seconds_total` — CPU usage
- `process_resident_memory_bytes` — Memory usage
- `nodejs_eventloop_lag_p99_seconds` — Event loop lag
- And more...

### Postgres, Redis, the server

Scraped from `postgres-exporter`, `redis-exporter` and `node-exporter`. [alerts.md](./alerts.md#1-metrics-numbers-measured-over-time) explains exporters; each dashboard panel's ⓘ explains its metric.

---

## Grafana Dashboards

Grafana → Dashboards. Each dashboard links to the others (**Other dashboards**, top right), and every panel has an ⓘ that says what it measures, what a healthy value looks like, and which alert relates to it.

| Dashboard | Shows | Rows |
|---|---|---|
| **NestJS API Metrics** | The app, from inside | Overview (requests/s, 5xx and 4xx share, p95, in flight, up) · Traffic and latency (by status, p50/p95/p99) · Endpoints (a table per route with 4xx, 5xx, p95 and average; busiest and slowest routes) · Sign-in and accounts (sign-ins, failures, refused by the limits, refresh-token reuse, outcomes and account changes per minute; see [Auth Metrics](#auth-metrics)) · Database as the app sees it (Prisma queries, p95 by operation) and cache hit rate per cache · Node.js process (event loop lag, memory against the container limit, CPU, restarts) |
| **Postgres** | The database server | Overview (up, connections used of max, transactions/s, cache hit ratio, longest transaction, deadlocks) · Connections by state and database · Activity (transactions, rows, locks, temporary files) · Storage and tables (sizes, WAL, sequential scans, a table of every app table with dead rows and last autovacuum) · Backups (age, last attempt, bucket copy, dump size). Filter by database at the top. |
| **Redis** | Redis and the job queues | Overview (up, memory of maxmemory, commands/s, waiting and failed jobs) · Queues (jobs per queue and state, waiting/active, delayed/failed) · Memory and keys · Clients and traffic (commands, latency, clients, network, saves to disk) |
| **Server** | The machine | Overview (uptime, CPU, load per core, memory, fullest disk, out-of-memory kills) · CPU and memory · Disks (space, inodes, throughput, busy) · Network |
| **NestJS Logs**, **Docker Logs** | Logs, from Loki | See [logging.md](./logging.md) |

Dashboard files are in `monitoring/grafana/provisioning/dashboards/`, and Grafana loads them from there. Grafana won't save edits to them from the UI: edit freely, then copy the dashboard's JSON (Save dashboard → Save JSON to file, or Share → Export) over its file and commit it.

Grafana doesn't notice when a dashboard file changes. After editing one, reload them (or restart Grafana):

```bash
curl -u admin:<GRAFANA_ADMIN_PASSWORD> -X POST http://localhost:${GRAFANA_PORT}/api/admin/provisioning/dashboards/reload
```

Some panels show a ⚠ next to the title. Hover it: usually it is Prometheus noting that an exporter's counter doesn't end in `_total`, so it can't be sure `rate()` fits; the values are correct.

Per-container CPU and memory are not collected (that needs cAdvisor, which is heavy for a small server): `docker stats` shows them. The app's own memory is on the NestJS API dashboard.

---

## Adding Cache Metrics

Cache metrics require manual instrumentation since cache usage is application-specific.

```typescript
import { MetricsService } from '@/shared/infrastructure/monitoring/metrics.service'
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager'

@Injectable()
export class YourService {
    constructor(
        @Inject(CACHE_MANAGER) private cache: Cache,
        private metricsService: MetricsService
    ) {}

    async getData(key: string) {
        const cached = await this.cache.get(key)
        
        if (cached) {
            this.metricsService.recordCacheHit('your_cache')
            return cached
        }
        
        this.metricsService.recordCacheMiss('your_cache')
        
        // Fetch from database and cache
        const data = await this.fetchFromDb()
        await this.cache.set(key, data, 300000) // 5 min TTL
        
        return data
    }
}
```

---

## Adding Custom Business Metrics

You can add custom metrics by extending the `PrometheusModule`:

```typescript
// 1. Add metric provider in prometheus.module.ts
makeCounterProvider({
    name: 'orders_created_total',
    help: 'Total orders created',
    labelNames: ['status']
})

// 2. Inject and use in MetricsService
@InjectMetric('orders_created_total')
public ordersCreated: Counter<string>

recordOrderCreated(status: string) {
    this.ordersCreated.inc({ status })
}

// 3. Use in your service
this.metricsService.recordOrderCreated('completed')
```

---

## Architecture

```
NestJS App ─────→ /metrics endpoint
                       ↓
              Prometheus (scrapes every 5s)
                       ↓
                 Grafana (visualizes)
```

**Metrics Collection Chain:**

1. **HTTP Metrics** — `HttpMetricsMiddleware`, which counts every response as it finishes, failed ones included
2. **DB Metrics** — Prisma `$extends` middleware in `PrismaService`
3. **Queue Metrics** — `QueueMetricsCollector`, read from Redis at scrape time

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PROMETHEUS_PORT` | `9090` | Prometheus web UI host port |
| `GRAFANA_PORT` | `3002` | Grafana web UI host port (not 3001: that is the web app's dev server) |
| `ALERTMANAGER_PORT` | `9093` | Alertmanager web UI host port |
| `ALERT_WEBHOOK_URL` | — | Where alerts are sent; required in production ([alerts.md](./alerts.md)) |
| `GRAFANA_ADMIN_PASSWORD` | `admin` | Grafana admin password |
| `LOKI_PORT` | `3100` | Loki API host port |
| `ALLOY_PORT` | `12345` | Alloy web UI host port |
| `MONITORING` | `local` | `local` or `grafana-cloud` ([Grafana Cloud](#grafana-cloud)); in development also `off` ([docker.md](./docker.md#lighter-ways-to-run)) |
| `GRAFANA_CLOUD_*` | — | The stack, its tokens and its endpoints ([Grafana Cloud](#grafana-cloud)) |

---

## Key Files

```
├── monitoring/
│   ├── prometheus/prometheus.yml        # Prometheus scrape config
│   ├── prometheus/rules/, alertmanager/ # Alerts (see alerts.md)
│   ├── alloy/                           # Log collection (see logging.md)
│   ├── compose/                         # The monitoring services, per destination
│   ├── loki/                            # Log storage, log alert rules
│   ├── grafana/provisioning/
│   │   ├── datasources/                 # Prometheus, Loki, Alertmanager
│   │   └── dashboards/
│   │       ├── dashboard.yml            # Dashboard provider config
│   │       ├── nestjs-api.json          # The app
│   │       ├── nestjs-logs.json, docker-logs.json  # Logs
│   │       ├── postgres.json            # Postgres and backups
│   │       ├── redis.json               # Redis and BullMQ queues
│   │       └── server.json              # CPU, memory, disks, network
├── src/config/
│   └── prometheus.config.ts             # Prometheus config
├── src/shared/infrastructure/
│   ├── persistence/database/prisma.service.ts  # DB metrics via $extends
│   ├── queue/queue-metrics.ts           # bullmq_jobs
│   └── monitoring/
│       ├── prometheus.module.ts         # Metric providers
│       └── metrics.service.ts           # Recording methods
├── src/shared/presentation/
│   └── middlewares/http-metrics.middleware.ts  # HTTP metrics
├── src/modules/auth/infrastructure/
│   ├── prometheus-auth-events.adapter.ts        # auth_events_total
│   └── redis-session-cache.adapter.ts           # auth_session and auth_user cache hits and misses
```

---

## Grafana Cloud

`MONITORING` decides where metrics, logs and alerts go:

| | `MONITORING=local` (the default) | `MONITORING=grafana-cloud` |
|---|---|---|
| On the server | Prometheus, Loki, Grafana, Alertmanager, Alloy, the exporters | Alloy and the exporters |
| Memory for monitoring | about 600 MB | about 100 MB |
| Where you look | Grafana on the server, over an SSH tunnel | grafana.net, from anywhere |
| When the server is down | nothing is left to alert you, except the [outside checks](./external-monitoring.md) | alerts still fire, including "no metrics are arriving" |
| Alert rules, dashboards | read from `monitoring/` on the server | uploaded by `pnpm monitoring:cloud-sync` |
| Costs | nothing | nothing on the free plan, within its limits (below) |

Everything else stays the same: the same files describe both, the app is unaware of either, and switching is an env change plus a restart.

### What it costs

Grafana Cloud's free plan includes 10,000 metric series, 50 GB of logs a month, 14-day retention and 3 users. Measured on this starter: **about 5,000 series per stack**, so one stack fits comfortably and a second one (a development stack sending to the same account) fills the plan. Logs depend on your traffic; the dev stack above wrote a few MB a day.

Grafana Cloud counts one data point per minute per series, so in this mode Alloy scrapes **every 60 seconds** — rather than every 5 for the app and every 15 for everything else. Graphs are coarser than the local stack's; alerts are unaffected (the shortest rule window is 5 minutes).

### Setting it up

1. **Create a stack** at grafana.com (a free account gives you one).
2. **An access policy token**, for the server: Administration → Cloud access policies → create a policy with the scopes `metrics:write` and `logs:write`, then a token for it.
3. **A service account token**, for `monitoring:cloud-sync`: in your stack's Grafana, Administration → Users and access → Service accounts → add one with the **Admin** role, then a token. Admin is needed to import the notification configuration, which is the first thing the sync sends: without it nothing is uploaded at all.
4. **The endpoints**, in your stack's Grafana (`https://<stack>.grafana.net`): **Connections → Data sources**. Grafana Cloud created two there for you:

   | Data source | Its URL (Connection) | Its user (Authentication → Basic authentication) |
   |---|---|---|
   | `grafanacloud-<stack>-prom` | `https://prometheus-prod-….grafana.net/api/prom` | a number |
   | `grafanacloud-<stack>-logs` | `https://logs-prod-….grafana.net` | another number |

   The settings need the *push* addresses, so add a suffix to each URL: `GRAFANA_CLOUD_PROMETHEUS_URL` is the Prometheus one followed by `/push` (it ends in `/api/prom/push`), and `GRAFANA_CLOUD_LOKI_URL` the Loki one followed by `/loki/api/v1/push`. The two users go in `GRAFANA_CLOUD_PROMETHEUS_USER` and `GRAFANA_CLOUD_LOKI_USER`.

5. **Fill in `.env.production`** (`.env.development` works the same way; either file also needs `ALERT_WEBHOOK_URL`, which becomes the contact point — only `--remove` works without it):

   ```bash
   MONITORING=grafana-cloud
   GRAFANA_CLOUD_PROMETHEUS_URL=https://prometheus-prod-01-eu-west-0.grafana.net/api/prom/push
   GRAFANA_CLOUD_PROMETHEUS_USER=1234567
   GRAFANA_CLOUD_LOKI_URL=https://logs-prod-000.grafana.net/loki/api/v1/push
   GRAFANA_CLOUD_LOKI_USER=1234567
   GRAFANA_CLOUD_TOKEN=glc_...
   GRAFANA_CLOUD_GRAFANA_URL=https://yourstack.grafana.net
   GRAFANA_CLOUD_GRAFANA_TOKEN=glsa_...
   ```

6. **Deploy** (`./deploy.sh`). It starts only Alloy and the exporters, and then uploads the rules, notifications and dashboards itself. Without a deploy: `pnpm docker:prod`, then `pnpm monitoring:cloud-sync`.

Within a minute or two, Grafana Cloud → Dashboards → *your project name* shows the same six dashboards, and Alerting → Alert rules the same alerts.

### What `pnpm monitoring:cloud-sync` uploads

```bash
pnpm monitoring:cloud-sync                  # .env.production
pnpm monitoring:cloud-sync .env.development # another env file
pnpm monitoring:cloud-sync --dry-run        # print what it would send
pnpm monitoring:cloud-sync --only rules     # rules, notifications or dashboards
pnpm monitoring:cloud-sync --dump <dir>     # write what it would send to files
pnpm monitoring:cloud-sync --remove         # delete all of it again (see Switching back)
```

- **The alert rules** of `monitoring/prometheus/rules` and `monitoring/loki/rules`, as Grafana-managed rules in a folder named after the Compose project. Two are left out (`PrometheusRuleFailures`, `AlertmanagerNotificationsFailing`): they watch a local Prometheus and Alertmanager, and Grafana Cloud watches its own. One is added: **`MetricsStopped`**, which fires when nothing has arrived for 10 minutes — the case where Alloy or the whole server is gone, and no other rule can fire.
- **The six dashboards**, in that same folder.
- **A contact point** named after the project, of the same kind as the `notify` receiver in `alertmanager.yml` (Discord as shipped; Slack, Teams or a plain webhook once you switch that receiver — [alerts.md](./alerts.md), "Another chat or email"), with `ALERT_WEBHOOK_URL` inline (Grafana has no file to read it from), the message template, and a mute timing it uses for the alerts the routes drop (Grafana has no receiver that discards). Each rule names the contact point it notifies, worked out from the routes in `alertmanager.yml` — so the same alerts reach the same places, and the stack's own notification policy is left alone. The inhibitions are not carried over: Grafana has none (see Notes).

Everything is narrowed to one project on the way up: each query gets a `project="…"` matcher, and each rule the `project` and `environment` labels. So one Grafana Cloud stack can hold several projects (and a development and a production stack) without their data, alerts or dashboards mixing.

The files in `monitoring/` stay as they are, and remain the source. What was uploaded stays in Grafana Cloud across restarts, so the command is not part of starting the stack: run it once after switching to Grafana Cloud, and again after changing a rule, a dashboard, a route in `alertmanager.yml`, the message template or `ALERT_WEBHOOK_URL`. Running it with nothing changed uploads the same again, and does no harm. In production `deploy.sh` runs it on every successful deploy, so there it never needs running by hand.

### Switching back

1. Set `MONITORING=local`, and deploy (in development: `pnpm docker:dev`). The local stack starts again with its own storage, and reads the same files from disk.
2. Remove what the sync put in Grafana Cloud:

   ```bash
   pnpm monitoring:cloud-sync .env.production --remove   # or .env.development
   ```

   It deletes the project's folder (its alert rules and dashboards), its contact points, message template and mute timing, and nothing of other projects. `--dry-run` lists them first. Left in place, the rules no longer get data: `MetricsStopped` fires ten minutes later and keeps firing. The data already sent stays until Grafana Cloud's retention drops it.

### Notes

- **Alloy is the only collector.** It reads container logs and scrapes the exporters and the app, exactly as `prometheus.yml` does locally; a unit test keeps the two lists equal.
- **Alerts arrive the same way**, through the same routes and the same Discord webhook, but Grafana Cloud delivers them. The dev-noise routes still apply through the `environment` label.
- **The heartbeat** (`ALERT_HEARTBEAT_URL`) works in both modes. In Grafana Cloud the Watchdog is evaluated in the cloud, so it keeps arriving while the server is down; `MetricsStopped` is what tells you the server is gone.
- **Alerts are not held back by each other.** The local Alertmanager suppresses an alert that follows from another (the errors after `AppDown`, the warning under a critical). Grafana has no such rule, so where the local stack sends one message, Grafana Cloud sends each alert: stopping Redis in a test sent `RedisDown`, `AppDown` and `AppErrorLogs`. The grouping (one message per alert name and severity) still applies.
- **Metric alerts arrive a little later than locally.** Alloy scrapes every 60 seconds (instead of 5 or 15) and Grafana evaluates the rules once a minute, before the rule's own `for` starts counting. So `RedisDown` (`for: 1m`) reaches Discord two to three minutes after Redis stops. Logs arrive within seconds, so `AppErrorLogs`, caused by the same outage, usually comes first.
- **Nothing is public.** Alloy sends out; nothing needs to be reachable from the internet.

---

## Checking the configuration

```bash
pnpm monitoring:check
```

It validates Alloy's and Loki's configuration with their own tools, then runs `pnpm alerts:test` (the Prometheus configuration, every alert rule, and Alertmanager's routes). A unit test also checks that these scripts use the image versions of the compose files, and that every file the compose files mount exists.

What it can't check: what Alloy does to a line (see the live debugging in [logging.md](./logging.md#what-alloy-does-with-each-line)), the queries in Loki's rules and in the dashboards. After changing those, look at the result in Grafana.

---

## Versions

Every image is pinned to an exact version: the monitoring services in `monitoring/compose/*.yaml`, the three exporters in `docker-compose.dev.yaml` and `docker-compose.prod.yaml`, and the tools the `monitoring:check` and `alerts:test` scripts of `package.json` run. Renovate keeps them current: the minor and patch versions in its weekly pull request, a major version when you ask for it ([renovate.md](./renovate.md)). Alertmanager and postgres-exporter are still below 1.0, so their minor versions come as their own pull requests rather than in the weekly group.

| Service | Major version | Notes |
|---|---|---|
| Prometheus | 3 | |
| Alertmanager | 0.x | |
| Loki | 3 | Schema v13, tsdb index |
| Alloy | 1 | Replaced Promtail, which reached its end of life in March 2026 |
| Grafana | 12 | Not 13: Grafana 13.2 grew past 1 GB while showing these dashboards and was killed at the production limit (256 MB); 12.4 stays near 150 MB. Check memory before moving to a newer major. |
| node-exporter | 1 | |
| postgres-exporter | 0.x | |
| redis_exporter | 1 | |

Loki, Alloy and Grafana are set not to send usage statistics to Grafana Labs.

## Upgrading from Promtail and Loki 2

A stack started from an earlier version of this starter runs Promtail, Loki 2.9, Prometheus 2.50 and Grafana 11.0. What happens to it when it moves to this version:

**1. Loki's stored logs need a decision first.** Loki 3 can't read Loki 2's index under the new schema. With the new `loki-config.yml` and the old volume, Loki starts but logs `invalid tsdb path` errors over and over, and the old logs can't be queried. Choose one:

- **Drop the old logs** (development, or when the history doesn't matter). Before starting the new version:

  ```bash
  docker compose -f docker-compose.dev.yaml --env-file .env.development rm -sf loki
  docker volume rm nezfocus-web-dev_loki-data
  ```

- **Keep them** (production). In `monitoring/loki/loki-config.yml`, put the old period back in front of the new one, and start the new one on a date (UTC) after the day you deploy. Until that date Loki also needs structured metadata off, which only schema v13 supports:

  ```yaml
  schema_config:
    configs:
      - from: 2020-10-24          # the old period, as it was
        store: boltdb-shipper
        object_store: filesystem
        schema: v11
        index:
          prefix: index_
          period: 24h
      - from: 2026-10-01          # a date after the deploy
        store: tsdb
        object_store: filesystem
        schema: v13
        index:
          prefix: index_
          period: 24h

  limits_config:
    allow_structured_metadata: false   # until the date above
    # ...the rest as it is
  ```

  Once that date has passed, remove `allow_structured_metadata: false` and restart Loki. Keep the old period: Loki uses it to find the logs written before the date. When retention has deleted all of them (14 days later), you can remove it.

**2. Start the new version.** `pnpm docker:dev` and `deploy.sh` remove the Promtail container (`--remove-orphans`). If you start the stack another way, remove it yourself (`docker rm -f promtail-hexagonal-auth-prod`): left running, it sends every line a second time. Its volume is no longer used: `docker volume rm hexagonal-auth-prod_promtail-positions`.

**3. The last hour of logs appears twice.** Alloy starts without a read position, so it reads each container's retained Docker log from the start. Loki rejects the lines older than about an hour, and stores the rest again. The log dashboards count that hour double; nothing else is affected. The same happens if Alloy's volume (`alloy-data`) is ever deleted.

**4. Prometheus and Grafana upgrade their data in place.** Prometheus 3 reads the metrics Prometheus 2.50 stored. Once it has written to them, Prometheus older than 2.55 can't read them. Grafana 12 migrates its database on first start, keeping the admin password and anything saved in it. Both were tested from the old versions.

What didn't change: the labels logs get (`service`, `project`, `container`, `level`), the alert rules, and the dashboards.


---

## Troubleshooting

### Prometheus can't reach NestJS

Prometheus → Status → Targets shows `nestjs-app` as down with "connection refused":

- The app container must listen on 3000. Check that the app service in the compose file still sets `PORT: 3000` under `environment:`. Without it, the app uses `PORT` from the env file (e.g. 8888), which Prometheus doesn't scrape.
- The app and Prometheus must share the `backend` network, and the service must be named `app`.

### No data in Grafana

1. Check Prometheus targets: http://localhost:9090/targets (should be "UP")
2. Verify the metrics endpoint from the host: `curl http://localhost:${PORT}/api/v1/metrics`
3. Make some API requests to generate traffic
4. Wait 30 seconds for data to populate

### DB metrics not showing

1. Ensure PrismaService is properly initialized
2. Make database queries (e.g., login, fetch users)
3. Check the `/api/v1/metrics` endpoint for `db_queries_total`

### Cache metrics always 0

The app records the auth guard's two caches (`cache="auth_session"` and `cache="auth_user"`), which need signed-in requests. For your own caches, call `recordCacheHit('name')` / `recordCacheMiss('name')` where you read them.
