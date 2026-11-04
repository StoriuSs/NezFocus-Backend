# Logging

How logs flow from the app and every other container into Grafana, what survives a Loki outage, and how to query them.

## Table of contents

- [One pipeline](#one-pipeline)
- [Log format: JSON or pretty](#log-format-json-or-pretty)
- [What Alloy does with each line](#what-alloy-does-with-each-line)
- [Labels](#labels)
- [The two log tiers](#the-two-log-tiers)
- [Docker log rotation](#docker-log-rotation)
- [Loki retention](#loki-retention)
- [Dashboards](#dashboards)
- [Querying with LogQL](#querying-with-logql)
- [What gets redacted](#what-gets-redacted)
- [What is not logged](#what-is-not-logged)
- [Configuration files](#configuration-files)
- [Troubleshooting](#troubleshooting)

---

## One pipeline

```
┌─────────────────┐  ┌──────────────────────────────────────────┐
│ NestJS app      │  │ db, redis, prometheus, grafana,           │
│ (pino → stdout) │  │ loki, alloy, node-exporter ...            │
└────────┬────────┘  └────────────────────┬─────────────────────┘
         │ stdout                         │ stdout / stderr
         ▼                                ▼
┌──────────────────────────────────────────────────────────────┐
│ Docker json-file log driver (rotated per container)          │  ← `docker logs`
└──────────────────────────────┬───────────────────────────────┘
                               │ Docker API
                               ▼
                        ┌─────────────┐
                        │    Alloy    │  labels by Compose service,
                        │             │  parses the app's JSON lines
                        └──────┬──────┘
                               │ push
                               ▼
                        ┌─────────────┐        ┌─────────────┐
                        │    Loki     │ ◀───── │   Grafana   │
                        └─────────────┘        └─────────────┘
```

With `MONITORING=grafana-cloud` the same Alloy sends the same entries to Grafana Cloud instead of the Loki next to it; nothing else about logging changes. See [monitoring.md](./monitoring.md#grafana-cloud).

**The app only writes to stdout.** It does not know where Loki is. [Grafana Alloy](https://grafana.com/docs/alloy/latest/) collects the output of every container in the Compose project, including the app, and ships it to Loki.

This is the standard container logging model: the application logs to stdout, and the platform collects. It means:

- Every container is collected the same way, and a line is stored once.
- A Loki outage never affects the app. Logs keep going to `docker logs`, and Alloy sends them when Loki is back. It retries a batch for about eight minutes before giving up on it: in tests, no app line was lost through a 1-minute or a 12-minute outage, but a longer one can leave gaps in Loki, which `docker logs` still covers until rotation.
- Output written before the logger exists is captured too: crashes, Prisma migration failures, pnpm install output.

> Earlier versions also pushed app logs straight to Loki with `pino-loki`. That stored every app line twice, tied the app to Loki's address, and lost the in-memory batch whenever the process was killed. It was removed in favour of this single path.
>
> The collector used to be Promtail, which reached its end of life in March 2026. Alloy replaced it with the same behaviour; see [monitoring.md](./monitoring.md#upgrading-from-promtail-and-loki-2).

---

## Log format: JSON or pretty

Configured in [`src/config/pino.config.ts`](../src/config/pino.config.ts) by `resolveLogFormat()`:

| Situation | Format | Why |
|---|---|---|
| `NODE_ENV=production` | **json**, always | Alloy parses it; `pino-pretty` is a devDependency and is not in the production image |
| Running in a container (stdout is not a terminal) | **json** | So the dev stack's Grafana dashboards work too |
| The dev container with `MONITORING=off` | **pretty** | No Alloy reads it, so nothing needs JSON |
| `pnpm dev` in your own terminal | **pretty** | Human-readable while developing |
| `LOG_FORMAT=json` or `LOG_FORMAT=pretty` | as set | Override (ignored in production) |

JSON is written directly to stdout with no transport, synchronously on the main thread, so nothing is buffered and lost if the process dies.

Reading a dev container's JSON output as pretty text: `pnpm docker:logs` (the
last 200 lines through `pino-pretty`, then following). Lines that are already
pretty pass through unchanged. Ways to run without the container at all:
[docker.md](./docker.md#lighter-ways-to-run).

---

## What Alloy does with each line

[`monitoring/alloy/modules/container-logs.alloy`](../monitoring/alloy/modules/container-logs.alloy), used by `local.alloy` and `grafana-cloud.alloy` next to it:

1. **Discovery.** Alloy asks the Docker API for containers with the label `com.docker.compose.project=${COMPOSE_PROJECT}`. `COMPOSE_PROJECT` is set on the alloy service, which lives in `monitoring/compose/<dev|prod>-<mode>.yaml` (the compose files include one of them), from compose's own project name (`${COMPOSE_PROJECT_NAME}`: `hexagonal-auth-dev` / `hexagonal-auth-prod`, or whatever `-p` says), so each stack ships only its own containers. Other containers on the host are never picked up.
2. **Labels.** Each stream gets `service`, `project` and `container`, taken from Docker and Compose metadata.
3. **App lines only** (`{service="app"}`):
   - join multi-line output into one entry (below),
   - parse the JSON,
   - turn pino's numeric level into a `level` label (`30` → `info`, `40` → `warn`, `50` → `error`, …),
   - use pino's `time` field as the log timestamp, so ordering reflects when the event happened, not when Alloy read it.

   Lines that are not JSON pass through untouched, with no `level` label, except stack traces, which get `level="error"`.

### How Alloy is put together

Alloy runs one configuration file, which is a list of components wired to each
other — no YAML pipelines, no agent-wide settings. Three files in
[`monitoring/alloy`](../monitoring/alloy):

| File | What it is |
|---|---|
| `modules/container-logs.alloy` | The log pipeline above, as a reusable block (`declare "container_logs"`) that takes one argument: where to send the entries |
| `local.alloy` | Used with `MONITORING=local`: that block, sending to `http://loki:3100` |
| `grafana-cloud.alloy` | Used with `MONITORING=grafana-cloud`: the same block sending to Grafana Cloud's Loki, plus the metric scrapes Prometheus would do, sending to Grafana Cloud |

Which of the two runs is decided by the file the compose `include` picks:
`monitoring/compose/<dev|prod>-local.yaml` starts Alloy with
`/etc/alloy/local.alloy`, `…-grafana-cloud.yaml` with
`/etc/alloy/grafana-cloud.alloy`. The whole directory is mounted, so both
files and the module are there.

Reading it: a component is `kind "name" { … }`, and components refer to each
other by `kind.name.export`. In `local.alloy`:

```alloy
modules.container_logs "default" {
    forward_to = [loki.write.default.receiver]   // hand entries to the writer below
}

loki.write "default" {
    endpoint { url = "http://loki:3100/loki/api/v1/push" }
}
```

Inside the module, the chain is: `discovery.docker` (which containers) →
`discovery.relabel` (the labels) → `loki.source.docker` (read their output) →
`loki.process` (the parsing above) → whatever `forward_to` points at.

In `grafana-cloud.alloy` there is a second chain for metrics:
`prometheus.scrape` components, one per job, all forwarding to a single
`prometheus.remote_write` that sends to Grafana Cloud with the `project` and
`environment` labels. The jobs mirror `monitoring/prometheus/prometheus.yml`,
job names included, because the alert rules select by job; a unit test compares
the two lists.

```bash
pnpm monitoring:check   # both files, through Alloy's own validator
```

The UI at http://localhost:12345 (`ALLOY_PORT`) shows the components as a
graph, each one's health, and — through **Live debugging** on
`loki.process` — the lines going in and out.

### Output that isn't the logger's

Everything the app logs goes through pino: one JSON object per line. Some output bypasses it: a crash printed by Node, a library calling `console.error`. That output spans lines (`Error: …`, then indented `at …` frames, then `}`), and Docker stores every line separately, so each used to become its own entry in Loki: a stack trace showed up as a dozen unrelated lines, none of them counted as an error.

Alloy joins them: a line that starts with whitespace or `}` belongs to the entry before it. A joined entry with a stack trace (`…\n    at …`) is labelled `level="error"`, so it counts in the NestJS Logs dashboard and in the `AppErrorLogs` alert. The NestJS Logs dashboard's **Unstructured output** counts these entries; many of them outside startup mean something writes around the logger.

The app's own sources of such output are handled at the source:

- BullMQ queues and workers print Redis connection errors to the console unless something listens to them: `QueueErrorLogger` logs them through pino instead, once a minute per queue while they repeat.
- Nest's own startup logs (module and route registration, a failure to start) wait for pino (`bufferLogs` in `main.ts`) instead of going out as coloured text.
- The startup banner and the shutdown messages go through the logger.

What is still plain text, by design: the Prisma CLI's short summary when migrations run at container start (`RUN_MIGRATIONS`, and `deploy.sh`'s migration step), and in development the `pnpm install` and `nest start --watch` output. The CLI's update check, which printed a ten-line box and called Prisma's servers, is off (`CHECKPOINT_DISABLE` in the Dockerfile).

> **Renaming the project** (`name:` in a compose file) needs no change here: Alloy follows it.

**Seeing what Alloy does.** Its UI, at http://localhost:12345 (`ALLOY_PORT`; on a server, through an SSH tunnel), shows each step of the pipeline above, its state and its errors. **Live debugging** on `loki.process.app` shows lines as they pass through.

---

## Labels

| Label | Source | Example values |
|---|---|---|
| `service` | Compose service name | `app`, `db`, `redis`, `loki` |
| `project` | Compose project | `hexagonal-auth-dev`, `hexagonal-auth-prod` |
| `container` | Container name | `nestapp-hexagonal-auth-dev` |
| `level` | Parsed from app JSON (app lines only); `error` for a stack trace printed around the logger | `info`, `warn`, `error` |
| `environment` | development or production | `production` |
| `service_name` | Added by Loki, a copy of `service`; Grafana's Logs Drilldown groups by it | `app` |

Loki also attaches `detected_level` to each entry as metadata, not as a label: its own guess at the level, from the line's text. For the app, filter on `level`, which comes from pino.

There is no `image` label: Docker's discovery API doesn't give the image name. (The Promtail setup configured one, but it was always empty, so no entry had it.)

**Keep label cardinality low.** Every distinct combination of label values is a separate stream in Loki, and Loki slows down badly with many streams. Never make `userId`, `requestId`, `url` or an IP a label. They stay inside the JSON line, and you filter with `| json | requestId="…"`.

---

## The two log tiers

| Tier | Where it lives | Retention | What it's for |
|---|---|---|---|
| **`docker logs`** | Docker's json-file on the host, rotated | Bounded by size, not time: the last few hours to days | Live tailing while reproducing a bug; the fallback when Grafana or Loki is down |
| **Loki (Grafana)** | Loki's volume | 14 days | Day-to-day debugging, dashboards, anything older than a few hours |

A third tier, a long-term archive such as S3, is not set up. Add one only if you need logs kept for months: compliance, audits.

---

## Docker log rotation

Each service has a `logging:` block — the app and its dependencies in [`docker-compose.prod.yaml`](../docker-compose.prod.yaml), the monitoring services in `monitoring/compose/prod-*.yaml`:

```yaml
logging:
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"
```

When the current file reaches `max-size`, Docker rotates it. At most `max-file` files are kept, so a container never uses more than `max-size × max-file` on disk.

| Services | Cap per container |
|---|---|
| app, db | 10 MB × 3 = 30 MB |
| redis, prometheus, grafana, loki, alloy, node-exporter | 5 MB × 3 = 15 MB |

**Rotation caps size; retention caps age.** Docker rotation can drop a one-hour-old line under heavy traffic, and can keep a week-old line when traffic is quiet. For anything older than a few hours, use Loki.

---

## Loki retention

[`monitoring/loki/loki-config.yml`](../monitoring/loki/loki-config.yml):

```yaml
limits_config:
  retention_period: 336h   # 14 days — Loki wants hours, not days

compactor:
  retention_enabled: true
  compaction_interval: 10m
  retention_delete_delay: 2h
```

The compactor marks expired chunks every 10 minutes and deletes them 2 hours later, so expired data can stay on disk for up to about 2h10m past the retention window.

**Rough disk use.** A request log line is ~300–500 bytes, and Loki typically compresses it 5–10×.

| Traffic | Lines/day (≈ requests, successful healthchecks excluded) | 14 days in Loki |
|---|---|---|
| 1k requests/day | ~1k | ~1–2 MB |
| 100k requests/day | ~100k | ~200–400 MB |
| 1M requests/day | ~1M | ~2–4 GB |

- **Raise retention** (e.g. `720h`) when incidents span weeks.
- **Lower it** (e.g. `168h`) under disk pressure.
- Don't go below about 3 days: a bug that only shows up at weekends needs that window.

---

## Dashboards

Provisioned from `monitoring/grafana/provisioning/dashboards/`:

| Dashboard | Shows |
|---|---|
| **NestJS Logs** | The app. Overview: errors, warnings, 5xx and 4xx responses, unstructured output. Over time: entries by level, and **errors by component** (the `context` of each log: `HTTP`, `RedisClient`, `QueueErrorLogger`, …). What went wrong: the most frequent error messages, and failed requests by URL and status. The log, one readable line per entry. |
| **Docker Logs** | Every container of the stack except Loki and Alloy (Loki logs the dashboards' own queries): entries and errors per service, over time, and the log |
| **NestJS API Metrics**, **Postgres**, **Redis**, **Server** | Metrics, not logs: see [monitoring.md](./monitoring.md#grafana-dashboards) |

Both log dashboards have a **Search** box (a case-insensitive regular expression: a request id, a URL, `timeout`), and NestJS Logs a **Level** filter. The log panel shows each app entry as

```
[HTTP] Exception caught  GET /api/v1/users/me → 503 in 220ms  Service Unavailable Exception
[QueueErrorLogger] Queue file-cleanup: connect ETIMEDOUT
```

Lines that are not JSON (install output, a crash printed by Node) are shown as they are. Click a line for every field of the entry: `requestId`, `error_stack`, … The Errors count is what the [`AppErrorLogs`](./alerts.md#app) alert counts: when it fires, "Errors by component" and "Most frequent errors" show which ones.

For other services, "errors" are lines containing *error*, *fatal*, *panic* or *exception*, except lines that say `level=info` or `level=debug` (Grafana, Loki and Prometheus write their level that way). Their logs have no level label to go by, so the count still includes some harmless lines.

Count panels show `0` when nothing matched in the time range.

### Writing a log line that dashboards understand

With nestjs-pino, put the message in the object and the context last:

```ts
this.logger.warn({ msg: 'Exception caught', statusCode, url }, 'HTTP')   // nestjs-pino Logger
new Logger(MyService.name).error('Import failed', error)   // Nest Logger
```

nestjs-pino reads a trailing string argument as the `context`, so `logger.warn({ statusCode }, 'Exception caught')` logs *context* "Exception caught" and no message. With Nest's `Logger`, the context is the class name, and an error goes as the second argument: the app's logger (`AppLogger`) writes it as the entry's `err` field, with its type, message and stack, which the log dashboards show after the message. (nestjs-pino alone drops it, which is how a failed CQRS event handler used to be logged without its error.) Any other value after the message becomes the context.

The rules, all of which the code once broke:

- **No `console.log`.** It bypasses pino: no level, no context, and a multi-line value becomes one log entry per line. Use `new Logger(MyClass.name)`.
- **Details go in the message, the object, or an Error as the second argument, never in another trailing argument:** `logger.error(\`Upload failed: ${error.message}\`)` or `logger.error('Upload failed', error)`, not `logger.error('Upload failed', { error })`.
- **Log a repeating failure once a minute.** A call on every request or retry that fails while a dependency (Redis, Postgres, a mail server) is down logs the same line thousands of times. Wrap it:

  ```ts
  private readonly logUnavailable = throttledLog((message) => this.logger.error(message), REPEATED_ERROR_LOG_INTERVAL_MS)
  ...
  this.logUnavailable(`Rate limit storage unavailable, allowing requests: ${error.message}`)
  // → once, then "… (repeated 1362 more times since the last message)" a minute later
  ```

  Keep logging each occurrence when each one is different information (a particular user whose cache could not be invalidated).
- **An event emitter's `'error'` needs a listener** (a library client, a queue): without one, some libraries print the error, and Node crashes on others.

In production Grafana listens on `127.0.0.1` only. Reach it through an SSH tunnel:

```bash
ssh -L 3002:127.0.0.1:3002 <user>@<server>   # 3002 is GRAFANA_PORT's default
```

Then open `http://localhost:3002`.

---

## Querying with LogQL

Use **Explore** in Grafana and pick the Loki data source. A query starts with a label selector `{…}`, followed by optional pipeline stages `| …`.

### Selecting streams

```logql
{service="app"}                          # the NestJS app
{service="app", level="error"}           # app errors (label, cheap)
{service=~"db|redis"}                    # Postgres and Redis
{project="hexagonal-auth-prod"}               # everything in the prod stack
```

### Filtering by content

```logql
{service="app"} |= "a683548c-65e4"               # a request id anywhere in the line
{service="db"} |~ "(?i)error|exception"          # regex, case-insensitive
{service="app"} != "/api/v1/metrics"             # exclude
```

`|=` is substring match and `|~` is regex; `!=` and `!~` negate them.

### Filtering on JSON fields (app only)

```logql
{service="app"} | json | statusCode >= 500
{service="app"} | json | method="POST" | url=~"/api/v1/users.*"
{service="app"} | json | requestId="a683548c-65e4-44f4-a962-6b501b52eebc"
{service="app"} | json | duration > 1000                        # slow requests (ms)
{service="app"} | json | url=~"/api/v1/auth/.*" | statusCode=429   # sign-in routes refused by a limit
{service="app"} | json | url=~"/api/v1/auth/.*" | statusCode >= 500 # sign-in routes failing
```

### Auth lines that need a person

Most sign-in failures are a person typing the wrong thing, logged at `warn`
with the request. A few lines mean the server is misconfigured or something
was lost, and someone should act:

| Line (starts with) | Level | Means | Do |
|---|---|---|---|
| `Two-step sign-in cannot be checked for user <id>: their secret was sealed with an encryption key this server does not have` | `error` | `AUTH_ENCRYPTION_KEY` was changed without keeping the old one; that user gets 503 at the second step | put the old key in `AUTH_ENCRYPTION_KEY_PREVIOUS`, or turn two-step off for them ([two-step-sign-in.md](./auth/two-step-sign-in.md)) |
| `Turnstile could not be asked: ...` | `error` | Cloudflare's Turnstile API did not answer within 5 s; protected forms answer 503 `AUTH_CAPTCHA_UNAVAILABLE` | check outbound HTTPS from the server ([turnstile.md](./auth/turnstile.md)) |
| `Turnstile refused the check itself (...): check TURNSTILE_SECRET_KEY` | `error` | the secret key is wrong or revoked; same 503 | copy the secret again ([setup/cloudflare-turnstile.md](./setup/cloudflare-turnstile.md)) |
| `google sign-in failed: ...` | `error` | an unexpected error at Google's return; the browser lands on the web app with `?error=failed` | read the stack trace in the same line |
| `google sign-in did not complete (<reason>): ...` | `warn` | Google's return was refused for a known reason (the person cancelled, an unverified Google email, a deleted account...); the browser lands on the web app with `?error=<reason>` | usually nothing; many of them in a row means a misconfigured redirect URI or clock ([google-sign-in.md](./auth/google-sign-in.md)) |
| `Ended N session(s), removed ... of deleted accounts: an account deletion's event was not handled` | `warn` | the hourly clean-up found leftovers of a deleted account, because the deletion's event was lost (a crash at the wrong moment) | nothing: it has just tidied them; frequent ones mean something keeps crashing |
| `A refresh token was used twice; session <id> of user <id> has been ended` | `warn` | reuse detection ended a session (also in Sentry and the `AuthRefreshTokenReuse` alert) | see [sessions-and-tokens.md](./auth/sessions-and-tokens.md) |

`error` lines feed the `AppErrorLogs` alert ([alerts.md](./alerts.md)), so the
first three reach Discord by themselves. A query for all of them:

```logql
{service="app"} |~ "Two-step sign-in cannot be checked|Turnstile (could not be asked|refused)|sign-in failed|deletion's event was not handled"
```

### Counting

```logql
sum by (level) (count_over_time({service="app"}[1h]))
sum by (service) (count_over_time({project="hexagonal-auth-prod"} |~ "(?i)error" [15m]))
```

In the Grafana log view you can also click a field on an expanded line and use **+** or **−** to add a filter without writing LogQL.

---

## What gets redacted

pino's `redact` config replaces these with `[REDACTED]` before the line is written, so neither `docker logs` nor Loki ever sees the value:

- Headers: `authorization`, `cookie`, `x-api-key`, `proxy-authorization`, `idempotency-key`, and response `set-cookie`
- Body fields, each in both spellings (`current_password` as the request sends it, `currentPassword` as the app's objects name it):
  - passwords: `password`, `confirmPassword`, `oldPassword`, `newPassword`, `currentPassword`
  - tokens: `token`, `refreshToken`, `accessToken`
  - the auth fields that can sign someone in or change their account: `code` (emailed codes), `twoFactorCode`, `recoveryCodes`, `challenge` (a two-step sign-in halfway through), `secret` and `otpauthUri` (the authenticator setup), `turnstileToken`, `state`

**URLs are redacted too.** Every request URL the app logs (the request line,
both exception filters, the error envelope's `data.path`) goes through
`redactUrl`, which replaces the value of any query parameter on the same list.
That matters for Google sign-in: Google returns the browser to
`/api/v1/auth/google/callback?code=...&state=...`, and that one-time `code`
signs someone in. The log shows
`/api/v1/auth/google/callback?code=%5BREDACTED%5D&state=%5BREDACTED%5D`
(the brackets are URL-encoded).

When you add an endpoint that accepts a sensitive field, add its name to [`src/shared/constants/sensitive-fields.ts`](../src/shared/constants/sensitive-fields.ts). The logger, the URL redaction and the error reports all read that list, so one line covers each. Names are matched without case, `-` or `_`, so add the camelCase name once.

---

## What is not logged

- **Successful healthchecks.** `LoggingInterceptor` skips `/health` responses below 400, since Docker probes them constantly. Failing healthchecks are still logged, by the exception filter.
- **`/metrics` scrapes.**
- **Request bodies.** Only method, URL (with sensitive query values redacted, above), status, duration and request id are logged per request.
- **Emailed codes.** Never in the logs. They are, however, in the `auth` queue's `send-code` jobs in Redis, which hold the address and the plaintext code until the email is sent (and a day longer if sending failed for good). Bull Board at `/admin/queues` shows job data, so anyone who can open it can read pending codes. It is behind basic auth (`BULL_BOARD_USER`, `BULL_BOARD_PASSWORD`; production refuses a weak password): keep that password as private as the database's ([emails.md](./auth/emails.md)).

Log levels by outcome: successful requests log at `info`, 4xx responses at `warn`, and 5xx responses and unhandled errors at `error`.

---

## Configuration files

| File | Purpose |
|---|---|
| [`src/config/pino.config.ts`](../src/config/pino.config.ts) | Log format, level, redaction |
| [`monitoring/alloy/modules/container-logs.alloy`](../monitoring/alloy/modules/container-logs.alloy) | Which containers are collected, labels, JSON parsing |
| [`monitoring/loki/loki-config.yml`](../monitoring/loki/loki-config.yml) | Storage, retention, compaction |
| [`monitoring/grafana/provisioning/datasources/loki.yml`](../monitoring/grafana/provisioning/datasources/loki.yml) | Grafana → Loki data source |
| `monitoring/grafana/provisioning/dashboards/*.json` | Dashboards |
| `docker-compose.*.yaml`, `monitoring/compose/*.yaml` | Per-service `logging:` rotation; the alloy service and its `COMPOSE_PROJECT` are in `monitoring/compose/` |

Environment variables:

| Variable | Default | Effect |
|---|---|---|
| `LOG_LEVEL` | `info` | Minimum level written |
| `LOG_FORMAT` | unset → json in containers and production, pretty in a terminal | `json` or `pretty` (ignored in production) |
| `LOKI_PORT` | `3100` | Host port for Loki's API (the app itself never uses it) |
| `ALLOY_PORT` | `12345` | Host port for Alloy's UI |

---

## Troubleshooting

### A container's logs are missing in Grafana

```bash
docker logs alloy-hexagonal-auth --tail 50          # push errors?
```

Then open Alloy's UI (http://localhost:12345) → `loki.source.docker.containers`. Under **targets_info** it lists every container it reads, with its last error.

- **No targets:** `/var/run/docker.sock` isn't mounted, or `COMPOSE_PROJECT` on the alloy service no longer comes from `${COMPOSE_PROJECT_NAME}`.
- **A component isn't healthy:** its page shows why. `loki.write.default` failing means Loki is unreachable; Alloy retries, then sends what it read once Loki is back.
- **Alloy config changes don't apply:** they need `docker compose … restart alloy`. `up -d` does not recreate a container when only a mounted file changed.

### The NestJS Logs panels are empty, but Docker Logs shows the app

The app is writing pretty text instead of JSON, so nothing gets a `level` and the JSON filters don't match. Check `docker logs <app> --tail 3`. If the lines aren't `{…}`, look for `LOG_FORMAT=pretty` in the environment.

### "No data"

- Widen the time range. The last 15 minutes can be quiet.
- Remember that successful healthchecks are deliberately not logged.

### `docker logs` shows nothing for the app, but it is running

Something replaced pino's destination. `pino.config.ts` must not add a transport in JSON mode; pino writes straight to stdout.

### Wiping Loki

This deletes all log history, so only do it if Loki itself is broken:

```bash
docker compose -f docker-compose.prod.yaml --env-file .env.production stop loki
docker volume rm hexagonal-auth-prod_loki-data
docker compose -f docker-compose.prod.yaml --env-file .env.production up -d loki alloy
```
