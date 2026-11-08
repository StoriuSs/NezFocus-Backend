# Alerts

Prometheus and Loki watch the stack and raise alerts; Alertmanager groups them
and posts them to a chat, Discord by default. A message looks like:

> **🔴 PostgresDown · hexagonal-auth-prod**
> **Postgres is down**
> The exporter cannot connect to Postgres, and neither can the app or the backups.
> `environment=production` `instance=postgres-exporter:9187` since 2 minutes ago

and, when it is over, **✅ Resolved: PostgresDown · hexagonal-auth-prod**. 🔴 is
critical (something is broken now), 🟠 a warning (look at it today). The name
after the dot is the Compose project (`name:` in the compose file), so several
projects can share one channel.

Alerting on the server itself can't tell you that the server is gone, or that
alerting itself stopped. That is why an outside uptime check and a heartbeat
are part of the setup, not extras: see
[external-monitoring.md](./external-monitoring.md).

- [How it works](#how-it-works)
- [Setting up production](#setting-up-production)
- [The alerts](#the-alerts)
- [Maintenance: silencing alerts](#maintenance-silencing-alerts)
- [Changing rules](#changing-rules)
- [Another chat or email](#another-chat-or-email)
- [Development](#development)
- [Moving Postgres or Redis off the server](#moving-postgres-or-redis-off-the-server)
- [Moving to Grafana Cloud](#moving-to-grafana-cloud)
- [Troubleshooting](#troubleshooting)

## How it works

```
 measure                 decide                      deliver
 ───────                 ──────                      ───────
 app ─────────┐
 node-exporter├─scrape─▶ Prometheus ─ rules/*.yml ─┐
 postgres-exp.│          (every 15s)               │
 redis-exp.   ┘                                    ├─▶ Alertmanager ─▶ Discord
                                                    │   group, route,
                                                   │   hold back, silence,
 app logs ─ Alloy ────▶ Loki ─ rules/app-logs.yml ─┘   repeat, resolve
```

Four ideas, in the order an alert travels through them.

### 1. Metrics: numbers measured over time

A **metric** is a number with a name and labels, sampled over time:
`redis_up{instance="redis-exporter:9121"} 1`. Services don't send metrics
anywhere. Each one serves its current numbers on an HTTP page (`/metrics`),
and **Prometheus scrapes** every page every 15 seconds (the app's every 5) and
stores the history.

Most services don't serve metrics about themselves, so an **exporter** sits
next to them and translates: `postgres-exporter` logs in to Postgres, asks
how many connections are open, and serves the answer as `pg_stat_activity_count`.
Here there are four sources:

| Source | Measures |
|---|---|
| the app (`/api/v1/metrics`) | requests, latency, database queries, cache, BullMQ queues, Node.js memory and event loop |
| `node-exporter` | the server: CPU, memory, disks, network; plus the backup metrics the backup service writes |
| `postgres-exporter`, `redis-exporter` | Postgres and Redis |

When Prometheus can't scrape a page at all, it records `up{job="…"} 0` for it.
That is how "the app is down" becomes a number.

The Grafana dashboards draw these same numbers; see
[monitoring.md](./monitoring.md#grafana-dashboards).

### 2. Rules: questions asked every 15 seconds

An **alert rule** is a question written in PromQL, Prometheus' query language,
that Prometheus asks every 15 seconds:

```yaml
- alert: RedisDown
  expr: redis_up == 0        # the question: which Redis answers "not up"?
  for: 1m                    # ...and has kept answering it for a minute
  labels:
    severity: critical
  annotations:
    summary: Redis is down   # the text of the notification
```

Each time, the answer is a list of what matches. An alert then goes through
three states:

- **inactive**: nothing matches.
- **pending**: something matches, but not yet for `for:`. A Redis restart that
  takes 10 seconds matches for a moment and goes away again: no alert. That is
  what `for:` is for.
- **firing**: it has matched for the whole `for:`. Prometheus sends the alert
  to Alertmanager, and keeps sending it as long as it fires.

When the expression stops matching, the alert **resolves**. Rules about logs
work the same way, run by Loki on log lines instead of by Prometheus on metrics
(`AppErrorLogs`).

Prometheus → Alerts shows every rule and its state right now.

### 3. Alertmanager: from alerts to messages

Prometheus only says "this is firing". **Alertmanager** decides what reaches
you, and how often. Everything here is in `monitoring/alertmanager/alertmanager.yml`:

- **Grouping.** Alerts with the same name, severity and project become one
  message: a disk on three mount points is one notification with ×3, not three.
  Alertmanager waits 30 seconds after the first (`group_wait`) to collect the rest.
- **Routing.** Which receiver gets an alert: Discord for everything, except
  `Watchdog` (the heartbeat, below). A receiver is a destination: a Discord
  webhook, Slack, email, …
- **Holding back** (inhibition). Some alerts hide others while they fire. When
  Redis is down, the app also logs errors, and both alerts fire; you get
  `RedisDown` only, because the errors are its consequence.
- **Silences.** You can mute alerts for a while, during planned maintenance.
- **Repeating and resolving.** A problem that is still there is sent again
  every 4 hours. When it is over, a "✅ Resolved" message follows.

Alertmanager also remembers what it already sent (in its data volume), so a
restart doesn't send everything again.

### 4. Watchdog and the heartbeat: who watches the watcher?

Every alert above is raised by Prometheus and delivered by Alertmanager, both
running on your server. If the server dies, loses power, fills its memory, or
Prometheus crashes, **nothing is left to send an alert**. The channel simply
stays quiet, and a quiet channel looks exactly like "everything is fine".

The fix is to turn silence into a signal:

1. The `Watchdog` rule is `vector(1)`: always true, so it is always firing.
2. Alertmanager sends it every minute to an outside service (the heartbeat
   receiver), instead of to Discord. Each call means "I'm alive, and alerting
   works end to end".
3. The outside service (for example healthchecks.io) expects a call at least
   every few minutes. **When the calls stop, it alerts you**, from somewhere
   else, by Discord or email.

It is a dead man's switch: a signal that must keep arriving, where the alarm is
its absence.

The heartbeat is not the same as the uptime check, though both live at an
outside service: the uptime check calls your website, the heartbeat waits for
your server to call. Each catches failures the other misses (a dead Prometheus
while the site works; an expired certificate while the server is fine).
[external-monitoring.md](./external-monitoring.md) explains the difference,
compares the services, and walks through setting both up.

### An alert from start to finish

Redis stops at 03:00:00.

| Time | What happens |
|---|---|
| 03:00:05 | Prometheus scrapes redis-exporter: `redis_up 0` |
| 03:00:15 | The `RedisDown` rule matches: **pending** |
| 03:01:15 | Matched for 1 minute (`for: 1m`): **firing**, sent to Alertmanager |
| 03:01:15 | The app has been logging errors; `AppErrorLogs` would fire soon, but is held back by `RedisDown` |
| 03:01:45 | After `group_wait` (30s), Alertmanager posts **🔴 RedisDown** to Discord |
| 03:20:00 | You restart Redis; `redis_up 1`, the rule no longer matches: **resolved** |
| up to 03:25 | Alertmanager posts **✅ Resolved: RedisDown** at the group's next update (`group_interval`, 5 min) |

Had Redis stayed down, the same message would have been posted again at
07:01:45, 4 hours after the first (`repeat_interval`), and every 4 hours after.

### Files

| File | |
|---|---|
| `monitoring/prometheus/prometheus.yml` | What Prometheus scrapes, where the rules are, where Alertmanager is |
| `monitoring/prometheus/rules/*.yml` | Metric alert rules: app, host, data (Postgres, Redis, backups), platform (the monitoring stack itself) |
| `monitoring/prometheus/tests/*.test.yml` | A test for every rule (`pnpm alerts:test`) |
| `monitoring/loki/rules/app-logs.yml` | Log alert rule |
| `monitoring/alertmanager/alertmanager.yml` | Receivers, grouping, routing, holding back, repeats |
| `monitoring/alertmanager/templates/notify.tmpl` | The message text |
| `monitoring/alertmanager/alertmanager.dev.yml` | Development without a webhook: shows alerts, sends nothing |
| `monitoring/alertmanager/tests/routes.sh` | Which receiver each kind of alert reaches (`pnpm alerts:test`) |

## Setting up production

### 1. The webhook

1. In Discord: **Server Settings → Integrations → Webhooks → New Webhook**,
   choose the channel, **Copy Webhook URL**. Turn on notifications for that
   channel (right-click it → Notification Settings → All Messages), and on your
   phone, or alerts at night reach nobody.
2. In `.env.production`:
   ```
   ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/…
   ```
   It is required: without it `docker compose` refuses to start the production
   stack, and `pnpm env:check .env.production` and `./deploy.sh` report it.
   Anyone with the URL can post to the channel; if it leaks, delete the
   webhook in Discord and create a new one.
3. Deploy (`./deploy.sh`). A changed URL is picked up by the next deploy, or by
   `docker compose --env-file .env.production -f docker-compose.prod.yaml up -d alertmanager`.
4. **Send a test alert**, after the first deploy and after changing the URL:
   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yaml exec alertmanager \
     amtool --alertmanager.url=http://localhost:9093 alert add TestAlert 'severity="warning"' \
     --annotation='summary="Test alert: alerting works"'
   ```
   It arrives within a minute, and a "Resolved" message follows 5 to 10
   minutes later. If it doesn't arrive, see [Troubleshooting](#troubleshooting).

### 2. An outside uptime check (required)

An outside service opens your website every few minutes, as a visitor would,
and alerts you when it doesn't answer: the server down, or up but unreachable
(DNS, nginx, an expired certificate, the provider's network). Nothing on the
server can report that about itself.

Two HTTP monitors, the API (`/api/v1/health/ready`) and the web app, posting
to your Discord channel. Sign-in is part of the API, so it needs no monitor of
its own.
Recommended: [UptimeRobot](https://uptimerobot.com), free for hobby projects.
Steps, the other services and what to use for a commercial project:
[external-monitoring.md](./external-monitoring.md#1-uptime-check-with-uptimerobot)
and [setup/uptime-check.md](./setup/uptime-check.md).

### 3. A heartbeat (recommended)

The other direction: Alertmanager calls an outside service every minute, and
the service alerts you when the calls stop, which is how you learn that
Prometheus or Alertmanager is down while the website still works.

One check with a 5-minute period and grace; its URL goes in
`ALERT_HEARTBEAT_URL`, and the `heartbeat` receiver in `alertmanager.yml` is
uncommented. Recommended: [Healthchecks.io](https://healthchecks.io), free.
Steps and test: [external-monitoring.md](./external-monitoring.md#2-heartbeat-with-healthchecksio).

## The alerts

Severity **critical**: something is broken for users now. **Warning**: fix it
soon, before it becomes critical.

### App

| Alert | Severity | Fires when | Check first |
|---|---|---|---|
| `AppDown` | critical | Prometheus can't scrape the app for 2 min | `docker compose ps app`, `docker compose logs --tail 100 app` |
| `AppHighErrorRate` | critical | Over 5% of requests end in 5xx for 2 min, with at least 5 errors in 5 min | Grafana → NestJS Logs, level error |
| `AppHighLatency` | warning | p95 over 1 s for 10 min, at more than 0.1 requests/s | Grafana → NestJS API: which route; Postgres and CPU |
| `AppEventLoopLag` | warning | Event loop delayed over 0.5 s (p99) for 5 min | CPU-heavy synchronous code; image processing |
| `AppRestarting` | warning | The app started 3+ times in 30 min | `docker inspect <container> --format '{{.State.OOMKilled}}'`, logs before the restart |
| `AppErrorLogs` | warning | Errors logged in the last 10 min (Loki): 5xx responses, failed background jobs, lost connections, crashes | Grafana → NestJS Logs: "Errors by component" and "Most frequent errors" |

### Sign-in

| Alert | Severity | Fires when | Check first |
|---|---|---|---|
| `AuthFailedLoginSpike` | warning | Over 50 failed sign-ins in 10 min, for 5 min | Grafana → NestJS Logs, `AUTH_INVALID_CREDENTIALS` and `RATE_LIMIT_EXCEEDED`: one address, or many? Many IPs is a botnet |
| `AuthRefreshTokenReuse` | warning | A refresh token came back after being replaced (the session was already ended) | Sentry → the "Refresh token reuse detected" issue: the user id, and whether it repeats |

The limits behind these are in [auth/rate-limits.md](./auth/rate-limits.md),
and what a reused refresh token means in
[auth/sessions-and-tokens.md](./auth/sessions-and-tokens.md). The app starts
every `auth_events_total` series at 0, so the first reuse after a restart is
counted too: `increase()` cannot see a series' first sample.

**Sign-in problems with no alert of their own.** These reach you through
`AppErrorLogs` (each logs an error line), not through a dedicated rule:

| What happens | What the app logs | What users see |
|---|---|---|
| The SMTP server refuses or times out | A failed `send-code` (or other email) job, after 3 attempts | No code arrives; the failed job is on `/admin/queues` |
| Google sign-in breaks (not a user cancelling) | "google sign-in failed" | `?error=failed` on the web app's callback page |

What to do about each: [auth/operations.md](./auth/operations.md).

`auth_events_total` counts more than the two rules use. Its `event` label also
takes `login_succeeded`, `login_rate_limited`, `registration`,
`password_reset`, `oauth_login_succeeded`,
`oauth_login_failed`, `oauth_account_linked`, `account_deleted` (a deletion
request; the account goes 14 days later) and `account_restored`
(`src/modules/auth/application/ports/auth-events.port.ts`). The API
dashboard's "Sign-in and accounts" row draws them. To alert on one, copy
`AuthFailedLoginSpike` in `rules/app.yml` with another `event`, for example a
burst of `oauth_login_failed`, and add its test
([Changing rules](#changing-rules)).

### Server

| Alert | Severity | Fires when | Check first |
|---|---|---|---|
| `HostDiskSpaceLow` | warning / critical | Under 15% free for 10 min / under 5% for 5 min | `df -h`, `docker system df`; old images, logs, `backups` volume |
| `HostDiskWillFillIn24Hours` | warning | The last 6 hours' trend fills the disk within a day, and it's over 60% used | What is writing: `du -xh / --max-depth=2` |
| `HostInodesLow` | warning | Under 10% of inodes free for 10 min | `df -i`; many small files (`docker system prune`) |
| `HostMemoryLow` | warning | Under 10% memory available for 10 min | `docker stats --no-stream` |
| `HostOutOfMemoryKill` | warning | The kernel killed a process for memory in the last 10 min | `docker ps -a` for a recent restart; that service's memory limit |
| `HostCpuHigh` | warning | CPU over 90% busy for 15 min | `docker stats --no-stream` |

Disk alerts cover ext2/3/4, xfs, btrfs and zfs filesystems. If the server uses
another, add it to the `fstype` pattern in `rules/host.yml`.

### Postgres, Redis, backups

| Alert | Severity | Fires when | Check first |
|---|---|---|---|
| `PostgresDown` | critical | The exporter can't connect for 1 min | `docker compose logs --tail 100 db`, disk space |
| `PostgresConnectionsHigh` | warning | Over 80% of `max_connections` used for 5 min | `DB_POOL_MAX`, idle connections in `pg_stat_activity` |
| `PostgresDeadlocks` | warning | A deadlock in the last 10 min | Postgres logs show both statements |
| `RedisDown` | critical | The exporter can't connect for 1 min | `docker compose logs --tail 100 redis` |
| `RedisMemoryHigh` | warning / critical | Over 80% of `maxmemory` for 5 min / over 95% for 2 min | `redis-cli info memory`, `--bigkeys`; failed BullMQ jobs piling up. Full means every write fails |
| `RedisPersistenceFailing` | warning | The last save to disk failed, for 5 min | Disk space; `redis-cli info persistence` |
| `BackupFailed` | critical | The last backup attempt failed | `docker compose logs backup` |
| `BackupTooOld` | critical | The last good backup is over 26 h old | Is the backup service running? |
| `BackupNeverRan` | warning | No backup metrics at all for 26 h | The backup service, and node-exporter's `backup-metrics` volume |
| `BackupUploadFailed` | warning | The last copy to the bucket failed | Bucket credentials; the local dump is fine |
| `BackupUploadTooOld` | warning | The last bucket copy is over 26 h old | As above |
| `BackupMetricsUnreadable` | warning | node-exporter can't parse the backup metrics | `docker compose logs node-exporter` |

The backup age limits assume the default daily `BACKUP_SCHEDULE`. With another
schedule, change both forms of 26 hours in `rules/data.yml`: `26 * 3600` in
`BackupTooOld` and `BackupUploadTooOld`, and `for: 26h` in `BackupNeverRan`
(and the tests). See [backups.md](./backups.md).

### The monitoring stack itself

| Alert | Severity | Fires when | Check first |
|---|---|---|---|
| `TargetDown` | warning | An exporter, Loki, Alloy or Alertmanager can't be scraped for 5 min | That service's logs. Its alerts can't fire meanwhile |
| `PrometheusRuleFailures` | warning | A rule failed to evaluate | `docker compose logs prometheus` |
| `AlertmanagerNotificationsFailing` | warning | A notification failed to send | `docker compose logs alertmanager`. Reaches you only in Grafana or through another receiver |
| `Watchdog` | none | Always | Goes only to the heartbeat |

### What you won't be told twice

- An alert's critical level hides its warning (a 97% full disk isn't also
  reported as "under 15%").
- While `AppDown`, `PostgresDown` or `RedisDown` fires,
  `AppHighErrorRate`, `AppHighLatency` and `AppErrorLogs` are held back: they
  are its consequences. They arrive if they're still there after it resolves.
- A problem that continues is reported again every 4 hours
  (`repeat_interval`).

### Where to see them

- **Grafana** → Alerting → **Alert groups** and **Silences**, choosing the
  *Alertmanager* data source at the top: firing alerts, including held-back
  ones, and silences. **Alert rules** lists the Prometheus and Loki rules.
- **Alertmanager's own page**: `http://localhost:${ALERTMANAGER_PORT}` (default
  9093), over an SSH tunnel on the server: `ssh -L 9093:127.0.0.1:9093 you@server`.
  See [below](#the-alertmanager-page).
- **Prometheus** → Alerts: every rule, and what is pending (true, but not for
  long enough yet).
- **The dashboards** (Grafana → Dashboards: NestJS API Metrics, Postgres,
  Redis, Server) show the numbers behind an alert over time. Each panel's ⓘ
  says what it measures and names the alert it relates to.

### The Alertmanager page

Alertmanager's page is a control panel, not a dashboard: it shows the alerts
Alertmanager is holding **right now**, and lets you silence them. It has no
history (Prometheus → Alerts and the dashboards do) and sends nothing itself.
Most days you won't open it; Grafana → Alerting → Alert groups shows the same
alerts more comfortably.

**Alerts** (the start page) lists what is firing, grouped:

```
 − notify   alertname="RedisDown"  project="hexagonal-auth-prod"  severity="critical"   1 alert
   2026-09-16T03:01:15Z   + Info   Source   Silence   Link
   instance="redis-exporter:9121"   environment="production"
```

- The word before the group, **`notify`**, is the **receiver**: where these
  alerts are sent. `notify` is the chat (Discord), `heartbeat` the dead man's
  switch, `none` nowhere. So a group under `none` is expected for `Watchdog` in
  development, and for everything when development has no webhook.
- The labels next to it are what the group has in common (`group_by`), the ones
  underneath what is particular to each alert.
- The time is when the alert started firing.
- **Info** opens the summary and description, the message text.
- **Source** opens the rule's query in Prometheus, to see the numbers behind it.
- **Silence** starts a silence pre-filled with this alert's labels.
- **Link** is a link to this exact alert.

The checkboxes at the top **show hidden alerts**: *Silenced* (muted by you),
*Inhibited* (held back by another alert, like `AppErrorLogs` while `RedisDown`
fires), *Muted* (outside a time window; unused here). An alert missing from
Discord is often simply ticked away here. **Filter** takes label matchers
(`severity="critical"`), **Receiver** shows one receiver's alerts only.

**Silences** lists active and expired silences, and **New Silence** creates
one: matchers (`alertname="PostgresDown"`), a duration, a comment. The page
previews which firing alerts the silence would catch.

**Status** shows the configuration Alertmanager actually loaded, and its
version and uptime: the place to check that a change to `alertmanager.yml`
arrived.

## Maintenance: silencing alerts

Before planned work (a Postgres upgrade, a server resize):

```bash
docker compose --env-file .env.production -f docker-compose.prod.yaml exec alertmanager \
  amtool --alertmanager.url=http://localhost:9093 silence add 'severity=~"warning|critical"' \
  --duration=1h --comment="Postgres upgrade"
```

Silence by severity rather than everything: a silence that matches `Watchdog`
stops the heartbeat, and the heartbeat service then reports an outage. For one
alert: `'alertname="PostgresDown"'`. List and end silences with
`amtool … silence query` and `amtool … silence expire <id>`, or in Grafana.

## Changing rules

1. Edit `monitoring/prometheus/rules/*.yml` (or `monitoring/loki/rules/`).
2. Change or add the test in `monitoring/prometheus/tests/`: a rule without a
   test is a rule you haven't seen fire. See the existing ones; the
   [promtool docs](https://prometheus.io/docs/prometheus/latest/configuration/unit_testing_rules/)
   explain the format.
3. `pnpm alerts:test` checks the Prometheus configuration and rules, runs the
   tests, checks the Alertmanager configuration and its routes (needs Docker).
   To see the rule fire for real, [send development alerts](#development) to a
   test channel.
4. Deploy. Prometheus and Loki read their rules at start, and a changed mounted
   file doesn't recreate a container, so restart them:
   `docker compose --env-file .env.production -f docker-compose.prod.yaml restart prometheus loki alertmanager`.

Job names in `monitoring/prometheus/prometheus.yml` (`nestjs-app`, `postgres`,
…) are part of the rules: rename one in both places. A metric name that
doesn't exist makes a rule that never fires, and `pnpm alerts:test` can't
notice. After changing metrics, check in Prometheus (Graph) that each metric
the rule uses returns data.

Loki rules have no test runner. Check them in Grafana → Explore → Loki with
the rule's query before deploying.

## Another chat or email

`ALERT_WEBHOOK_URL` is the URL of whatever `receivers: notify` in
`alertmanager.yml` uses. Replace its `discord_configs` block:

**Slack** (an incoming webhook URL):

```yaml
    slack_configs:
      - api_url_file: /tmp/alert_webhook_url
        send_resolved: true
        title: '{{ template "notify.title" . }}'
        text: '{{ template "notify.message" . }}'
```

**Microsoft Teams** (a Workflows webhook URL):

```yaml
    msteamsv2_configs:
      - webhook_url_file: /tmp/alert_webhook_url
        title: '{{ template "notify.title" . }}'
        text: '{{ template "notify.message" . }}'
```

The template is written for Discord: Slack shows `**bold**` literally and has
no `<t:…:R>` timestamps. Adjust `notify.tmpl`, or copy it for Slack.

`pnpm monitoring:cloud-sync` follows this receiver: with `MONITORING=grafana-cloud`
it makes a contact point of the same kind (Discord, Slack, Teams or a plain
webhook). For anything else it stops and says to create the contact point in
Grafana yourself ([monitoring.md](./monitoring.md)).

**Telegram, email, anything with a token or password** rather than a URL: add
your own variable to the alertmanager service's `environment:` in
`monitoring/compose/prod-local.yaml` (where that service is defined; the
compose file includes it), write it to a file in its `command:` the way
`ALERT_WEBHOOK_URL` is, and point the receiver's `*_file` setting at it
(`telegram_configs: bot_token_file`, `email_configs: auth_password_file`).
Every receiver is in the
[Alertmanager docs](https://prometheus.io/docs/alerting/latest/configuration/#receiver-integration-settings).
Run `pnpm alerts:test` after the change.

## Development

`pnpm docker:dev` runs the same rules as production.

**Without a webhook** (the default), Alertmanager uses `alertmanager.dev.yml`
and sends nothing. Firing alerts show in Grafana → Alerting → Alert groups and
on `http://localhost:${ALERTMANAGER_PORT}` (default 9093).

**To receive development alerts**, while trying out a rule or the message text:

1. Create a webhook for a separate test channel (not the production one), and
   put it in `.env.development`:
   ```
   ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/…
   ```
2. `pnpm docker:dev`. Alertmanager is recreated and uses the production
   configuration, `alertmanager.yml`; its log says `Using alertmanager.yml`
   (`docker logs alertmanager-nezfocus-web-dev`).
3. Make something fire:
   - a test alert:
     ```bash
     docker exec alertmanager-nezfocus-web-dev amtool --alertmanager.url=http://localhost:9093 \
       alert add TestAlert 'severity="warning"' --annotation='summary="Test alert from development"'
     ```
   - or a real one: `docker stop redis-nezfocus-web`. `RedisDown` arrives about 2
     minutes later; `docker start redis-nezfocus-web`, and "Resolved" follows
     within 5 minutes.
4. Remove the line (or leave it empty) and run `pnpm docker:dev` again to stop.

Development alerts carry `environment="development"` and the dev project name
(`nezfocus-web-dev`), so they are easy to tell apart. A few are never sent from
development, because they only mean someone is developing: `AppRestarting`
(hot reload restarts the app on every save), `BackupNeverRan` (there is no
backup service in dev), and `Watchdog`, which must never reach a production
heartbeat. `pnpm alerts:test` checks these routes.

## Moving Postgres or Redis off the server

The exporters connect to the `db` and `redis` services. With a managed
database or Redis, either:

- point them at it: `DATA_SOURCE_URI` (`host:port/dbname?sslmode=require`),
  `DATA_SOURCE_USER` and `DATA_SOURCE_PASS` on `postgres-exporter`, `REDIS_ADDR`
  (`rediss://host:port` for TLS) and `REDIS_PASSWORD` on `redis-exporter`. For
  Postgres, give the exporter its own user with the `pg_monitor` role instead of
  the app's; or
- rely on the provider's own alerts, and remove the exporter, its scrape job in
  `prometheus.yml`, its rules in `rules/data.yml` and their tests.

## Moving to Grafana Cloud

Set `MONITORING=grafana-cloud` and these same rules, routes and receivers
are evaluated and delivered by Grafana Cloud instead of by the Alertmanager on
the server. `pnpm monitoring:cloud-sync` uploads them (`deploy.sh` runs it on
every deploy); [monitoring.md](./monitoring.md#grafana-cloud) has the setup and
what the free plan covers.

What differs there:

- **One alert is added**, `MetricsStopped`: nothing has arrived for 10 minutes,
  which is what a stopped Alloy or a gone server looks like. Locally that case
  belongs to the [heartbeat](#3-a-heartbeat-recommended).
- **Two are left out**, `PrometheusRuleFailures` and
  `AlertmanagerNotificationsFailing`: they watch a Prometheus and an
  Alertmanager that no longer run here, and Grafana Cloud watches its own.
- **The webhook is sent inline** rather than read from a file, because Grafana
  has no file to read.
- **Every query is narrowed to the project**, and every rule labelled with it,
  so one Grafana Cloud stack can hold several stacks' alerts.

Keep the [outside uptime check](#2-an-outside-uptime-check-required) either
way: Grafana Cloud sees only what Alloy sends it.

## Troubleshooting

**The test alert doesn't arrive.**

```bash
docker compose --env-file .env.production -f docker-compose.prod.yaml logs --tail 20 alertmanager
```

- `unexpected status code 404` or `401`: the webhook was deleted or the URL is
  wrong. Create a new one, update `ALERT_WEBHOOK_URL`, `up -d alertmanager`.
- `no such host` or a timeout: the server can't reach Discord (firewall, DNS).
- Nothing logged: check that the alert is in Alertmanager
  (`amtool … alert query`), and that the channel's notifications are on.

**An alert should fire but doesn't.** Prometheus → Alerts shows whether the rule
is inactive, pending or firing. Inactive: run the rule's expression in Graph;
an empty result means a metric or job name that doesn't match. Firing but no
message: Alertmanager's UI shows whether it is silenced or held back by another
alert.

**Rules or configuration changes don't apply.** Restart the service (see
[Changing rules](#changing-rules)); `docker compose logs prometheus` shows a
rule file that fails to load.

**The same problem is reported by several alerts.** Add an `inhibit_rules`
entry in `alertmanager.yml`: the alert that is the cause as `source_matchers`,
the consequences as `target_matchers`. The cause must fire first, so give the
consequences a longer `for:`.
