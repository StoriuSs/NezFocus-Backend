# Grafana Cloud

**What it is for here.** The starter measures itself (requests, errors, sign-ins,
database and Redis health, the server's disk and memory), keeps its logs, and
alerts you when something goes wrong. By default all of that runs next to the
app: Prometheus, Loki, Grafana and Alertmanager, on the same server
(`MONITORING=local`). With `MONITORING=grafana-cloud`, only one small collector,
**Alloy**, runs on the server and sends everything to
[Grafana Cloud](https://grafana.com/products/cloud/), which stores it, shows
the dashboards and sends the alerts. What changes between the two and why:
[../monitoring.md](../monitoring.md#grafana-cloud).

**Do you need it?** No. It is optional in development and in production.
Choose it when:

- the server is small: monitoring takes about 600 MB of memory locally, about
  100 MB with Grafana Cloud;
- you want the dashboards from anywhere, without an SSH tunnel;
- you want an alert when **the whole server** goes quiet (`MetricsStopped`).
  A local stack can't report its own server's death.

**Cost.** The free plan, forever, no card: 10,000 active metric series, 50 GB of
logs a month, 14 days of history, 3 users. One stack of this starter measures
about 5,000 series, so production fits comfortably, and a development stack in
the same account fills the plan. The first 14 days are a trial without limits.

- [1. Account and stack](#1-account-and-stack)
- [2. The addresses and user numbers](#2-the-addresses-and-user-numbers)
- [3. The token for Alloy: an access policy](#3-the-token-for-alloy-an-access-policy)
- [4. The token for the sync: a service account](#4-the-token-for-the-sync-a-service-account)
- [5. Where each value goes](#5-where-each-value-goes)
- [6. Start it, and upload the rules and dashboards](#6-start-it-and-upload-the-rules-and-dashboards)
- [7. Seeing the data](#7-seeing-the-data)
- [Switching back to local](#switching-back-to-local)
- [Check it works](#check-it-works)
- [Common mistakes](#common-mistakes)

## 1. Account and stack

A **stack** is your own Grafana, with its own Prometheus (metrics) and Loki
(logs) storage, at `https://<stack>.grafana.net`.

1. Go to https://grafana.com/products/cloud/ → **Create free account**. Sign up
   with email, Google or GitHub.
2. Some sign-ups create a stack for you and ask you to name it. Otherwise, in
   the Cloud Portal (`https://grafana.com/orgs/<your-org>`), click **Add Stack**
   (or **Add a stack**).
3. **Stack name**: lowercase letters and digits, starting with a letter, e.g.
   `myappmonitoring`. It becomes the address `https://myappmonitoring.grafana.net`.
4. **Region**: the one closest to your server (e.g. a Europe or US region).
   **It cannot be changed later.**
5. Create it, and wait a minute until it is ready.

One stack can hold several projects and environments: everything the starter
sends is labelled with its Compose project (`hexagonal-auth-prod`,
`nezfocus-web-dev`) and environment, and the uploaded dashboards and alerts
filter on those labels. So development and production can share one stack, as
long as the free plan's 10,000 series is enough (it is, just).

## 2. The addresses and user numbers

Alloy needs two push addresses and two user numbers. They are on the stack's
page in the Cloud Portal:

1. In the Cloud Portal, click your stack.
2. On the **Prometheus** card, click **Details** (or **Send Metrics**). Copy:
   - the **remote write endpoint**, ending in `/api/prom/push`, e.g.
     `https://prometheus-prod-01-eu-west-0.grafana.net/api/prom/push`;
   - the **Username / Instance ID**: a number, e.g. `1234567`.
3. Back on the stack, on the **Loki** card, click **Details** (or **Send
   Logs**). Copy:
   - the **URL**, e.g. `https://logs-prod-000.grafana.net`;
   - the **User**: another number, different from the Prometheus one.

**If the screens differ**, the same values are in your stack's Grafana:
**Connections → Data sources**, where Grafana Cloud made two for you:

| Data source | Its URL (under Connection) | Its user (under Authentication → Basic authentication) |
|---|---|---|
| `grafanacloud-<stack>-prom` | `https://prometheus-prod-....grafana.net/api/prom` | a number |
| `grafanacloud-<stack>-logs` | `https://logs-prod-....grafana.net` | another number |

These are the addresses for **reading**. Alloy **writes**, so add a suffix:

- Prometheus: add `/push`, so it ends in `/api/prom/push`.
- Loki: add `/loki/api/v1/push`.

## 3. The token for Alloy: an access policy

Alloy proves who it is with one token, used as the password for both
Prometheus and Loki. It needs permission to **write** metrics and logs, and
nothing else.

1. In your stack's Grafana (`https://<stack>.grafana.net`): **Administration →
   Users and access → Cloud access policies** → **Create access policy**.
   (Made here, it is limited to this stack. The Cloud Portal's **Access
   Policies** page works too; choose the stack there yourself.)
2. **Display name**: e.g. `myapp-alloy-write`.
3. **Scopes**: tick **metrics: Write** and **logs: Write**. Nothing else.
4. **Create**.
5. On the new policy, click **Add token**. Give it a name (e.g. `prod-server`).
   Leave **Expiration date** empty, or set one and a reminder to renew it.
   **Create**.
6. **Copy to clipboard** now: the token is shown once. It starts with `glc_`.

Don't use the **Generate now** button on the Prometheus card instead: it can make
a token that may write metrics only, and then no logs arrive.

## 4. The token for the sync: a service account

The alert rules, the message format for Discord and the six dashboards are
files in this repository (`monitoring/`). `pnpm monitoring:cloud-sync` puts them
into your Grafana Cloud stack through Grafana's API, and `deploy.sh` runs it
after every successful deploy. It needs a second token, inside your stack's
Grafana, with the **Admin** role: the first thing it uploads is the notification
setup, which only an admin may change. With a lower role it stops at that first
upload with a 403 and says so.

1. In your stack's Grafana: **Administration → Users and access → Service
   accounts** → **Add service account**.
2. **Display name**: `monitoring-cloud-sync`. **Role**: **Admin**. **Create**.
3. **Add service account token** → a name → optionally **Set expiration date**
   → **Generate token**.
4. Copy it now: shown once. It starts with `glsa_`.

## 5. Where each value goes

In `.env.production` on the server (or `.env.development` to try it locally):

| Variable | Value | Used by |
|---|---|---|
| `MONITORING` | `grafana-cloud` | Docker Compose (which monitoring file to start) and `deploy.sh` |
| `GRAFANA_CLOUD_PROMETHEUS_URL` | Section 2, ending in `/api/prom/push` | Alloy |
| `GRAFANA_CLOUD_PROMETHEUS_USER` | Section 2, the Prometheus number | Alloy |
| `GRAFANA_CLOUD_LOKI_URL` | Section 2, ending in `/loki/api/v1/push` | Alloy |
| `GRAFANA_CLOUD_LOKI_USER` | Section 2, the Loki number | Alloy |
| `GRAFANA_CLOUD_TOKEN` | Section 3, `glc_...` | Alloy, as the password for both |
| `GRAFANA_CLOUD_GRAFANA_URL` | `https://<stack>.grafana.net` | The sync only |
| `GRAFANA_CLOUD_GRAFANA_TOKEN` | Section 4, `glsa_...` | The sync only |
| `ALERT_WEBHOOK_URL` | Your Discord webhook ([discord-alerts.md](./discord-alerts.md)) | The sync: it becomes the stack's contact point, so alerts reach the same channel. **Required** by the sync |
| `ALERT_HEARTBEAT_URL` | Optional ([uptime-check.md](./uptime-check.md#part-2-the-heartbeat)) | The sync: a heartbeat contact point |

```bash
MONITORING=grafana-cloud
GRAFANA_CLOUD_PROMETHEUS_URL=https://prometheus-prod-01-eu-west-0.grafana.net/api/prom/push
GRAFANA_CLOUD_PROMETHEUS_USER=1234567
GRAFANA_CLOUD_LOKI_URL=https://logs-prod-000.grafana.net/loki/api/v1/push
GRAFANA_CLOUD_LOKI_USER=7654321
GRAFANA_CLOUD_TOKEN=glc_...
GRAFANA_CLOUD_GRAFANA_URL=https://myappmonitoring.grafana.net
GRAFANA_CLOUD_GRAFANA_TOKEN=glsa_...
```

Docker Compose refuses to start Alloy if any of the first five `GRAFANA_CLOUD_*`
values is missing, and names it. `GRAFANA_ADMIN_PASSWORD` is not needed in this
mode: there is no local Grafana.

## 6. Start it, and upload the rules and dashboards

**In production:**

```bash
./deploy.sh
```

With `MONITORING=grafana-cloud` it starts Alloy and the exporters instead of the
local stack, and after the release is live it runs the sync. You see `Grafana
Cloud is up to date`. If `GRAFANA_CLOUD_GRAFANA_TOKEN` is empty it warns and
skips the sync; the data still flows, but there are no dashboards or alerts in
the cloud.

To run the sync again without a deploy (after changing `ALERT_WEBHOOK_URL`, for
instance), use the live release's image. `./deploy.sh --list` shows the live
release with a `*`; the project name is the `name:` at the top of
`docker-compose.prod.yaml`:

```bash
APP_TAG=<live release> docker compose --env-file .env.production -f docker-compose.prod.yaml \
  run --rm --no-deps -e COMPOSE_PROJECT_NAME=hexagonal-auth-prod \
  -v "$PWD/monitoring:/app/monitoring:ro" app node dist/src/bootstrap/monitoring-cloud-sync.js
```

(If a sync fails during a deploy, `deploy.sh` prints this exact command.)

**In development:**

```bash
pnpm docker:dev                                    # starts Alloy instead of the local stack
pnpm monitoring:cloud-sync .env.development        # uploads the rules and dashboards
pnpm monitoring:cloud-sync .env.development --dry-run   # shows what it would send, sends nothing
```

Run the sync again whenever you change an alert rule, a dashboard, a route in
`monitoring/alertmanager/alertmanager.yml` or `ALERT_WEBHOOK_URL`. Running it
with nothing changed does no harm. Every option:
[../monitoring.md](../monitoring.md#what-pnpm-monitoringcloud-sync-uploads).

## 7. Seeing the data

In your stack's Grafana:

- **Dashboards** → the folder named after the Compose project
  (`hexagonal-auth-prod`) → the six dashboards: NestJS API Metrics (with its
  **Sign-in and accounts** row), NestJS Logs, Docker Logs, Postgres, Redis,
  Server.
- **Alerting → Alert rules**: the same rules as the local stack, in the same
  folder, plus `MetricsStopped` (nothing has arrived for 10 minutes).
- **Alerting → Contact points**: one named after the project, posting to your
  Discord webhook.
- **Explore**: choose `grafanacloud-<stack>-prom` and query
  `up{project="hexagonal-auth-prod"}`, or `grafanacloud-<stack>-logs` and query
  `{service="app"}`.
- Alloy's own page, on the server, shows what it collects and sends:
  `ssh -L 12345:127.0.0.1:12345 ubuntu@<server-ip>`, then http://localhost:12345.

Usage against the free plan: the Cloud Portal → your stack → **Usage**, or
**Cost Management and Billing → Usage**.

## Switching back to local

1. Set `MONITORING=local` (add `GRAFANA_ADMIN_PASSWORD`) and deploy, or
   `pnpm docker:dev` in development.
2. Remove what the sync uploaded, so `MetricsStopped` does not fire forever:

   ```bash
   pnpm monitoring:cloud-sync .env.development --remove   # or .env.production; --dry-run lists it first
   ```

   On a server without Node, run it as in section 6 with `--remove` appended.

## Check it works

1. A minute or two after starting: **Dashboards → `<project>` → NestJS API
   Metrics** shows request rates, and **NestJS Logs** shows log lines.
2. **Explore** → `grafanacloud-<stack>-prom` → `up{project="<project>"}` returns
   one series per scraped service, most of them `1`.
3. **Alerting → Alert rules** lists the rules, and **Alerting → Contact points**
   has your project's. Click **Test** on the contact point: a message arrives in
   Discord.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| `set GRAFANA_CLOUD_... in .env.production (MONITORING=grafana-cloud)` | One of the five Alloy values is missing | Section 5 |
| No metrics; Alloy's page (section 7) shows errors on `prometheus.remote_write`, or its log (`docker logs alloy-hexagonal-auth-prod`) says 401 or 403 | Wrong user number, or a token without **metrics: Write** | The Prometheus number goes in `..._PROMETHEUS_USER`, the Loki one in `..._LOKI_USER`; check the policy's scopes |
| Metrics arrive, logs don't | The token was made with **Generate now** on the Prometheus card (metrics only) | Make a policy with both scopes (section 3) |
| `404` from the push address | The read address was used, without the suffix | `/api/prom/push` and `/loki/api/v1/push` (section 2) |
| The sync stops with 403 at the notification step | The service account is not **Admin** | Section 4 |
| The sync says `... is missing ALERT_WEBHOOK_URL` | The sync makes the contact point from it | Set it ([discord-alerts.md](./discord-alerts.md)) |
| The sync can't find the data sources | It expects exactly one data source ending in `-prom` and one ending in `-logs`, the ones Grafana Cloud made | Don't add other data sources with those endings |
| Usage near or over 10,000 series | A development and a production stack in one account, or added metrics | Send only production to the cloud; keep development `local` |
| `MetricsStopped` keeps firing after switching back | The cloud rules still wait for data | `--remove` (above) |
