# Watching from outside: uptime check and heartbeat

Every alert in [alerts.md](./alerts.md) is raised and sent by Prometheus and
Alertmanager, which run on your server. That leaves two gaps no amount of
rules on the server can close:

- **Your users can't reach the site, but the server is fine**: an expired
  certificate, DNS, nginx, a firewall, the provider's network. Inside, every
  check passes, so nothing alerts.
- **Alerting itself is broken**: the server is off, or Prometheus or
  Alertmanager has stopped. The thing that would tell you is the thing that's
  gone, and a silent Discord channel looks exactly like a healthy one.

Two checks from outside close them. This page explains the difference, compares
the services, and walks through setting both up. (A shorter, click-by-click
version is in [setup/uptime-check.md](./setup/uptime-check.md).)

- [Two checks, two directions](#two-checks-two-directions)
- [Services](#services)
- [Recommendation](#recommendation)
- [Setting up: UptimeRobot and Healthchecks.io](#setting-up-uptimerobot-and-healthchecksio)
- [One service instead of two](#one-service-instead-of-two)
- [When one of them alerts](#when-one-of-them-alerts)

## Two checks, two directions

Both run at a service outside your server, and both warn you from there. What
differs is **who calls whom**, and so what each one can see.

```
 Uptime check                              Heartbeat

 ┌──────────────┐   GET https://…/health   ┌─────────────┐
 │ uptime       │ ───────────────────────▶ │ your server │
 │ service      │ ◀─────── 200 ─────────── │             │
 └──────────────┘                          └─────────────┘
   "does the site answer, from the internet?"

 ┌──────────────┐                          ┌─────────────┐
 │ heartbeat    │ ◀── POST every minute ── │ Alertmanager│
 │ service      │     "alerting works"     │ (Watchdog)  │
 └──────────────┘                          └─────────────┘
   "has the server stopped calling?"
```

- **Uptime check: the service calls your website**, every few minutes, the way
  a visitor would. It sees what your users see.
- **Heartbeat: your server calls the service**, every minute. The `Watchdog`
  alert always fires, and Alertmanager sends it to the heartbeat service instead
  of to Discord. The service expects a call every few minutes, and alerts you
  when the calls stop.

They notice different failures:

| What breaks | Your users | Alerts from the server | Uptime check | Heartbeat |
|---|---|---|---|---|
| Postgres goes down | errors | 🔴 PostgresDown | 🔴 if it checks `/health`; ✅ on `/health/live` | ✅ |
| Prometheus or Alertmanager stops, the site still works | fine | nothing: what raises alerts is gone | ✅, the site answers | 🔴 the calls stop |
| The certificate expires, or DNS or nginx breaks | can't reach the site | nothing: inside, everything is healthy | 🔴 | ✅, the server still calls out |
| The whole server is off | can't reach the site | nothing | 🔴 | 🔴 |

The second row is why an uptime check alone is not enough: the site works, so
it stays green, and you learn that alerting was dead at the next real problem,
from your users. The third row is why a heartbeat alone is not enough: the
server is perfectly healthy and keeps calling out, while nobody on the internet
can reach it.

**One failure neither sees:** the Discord webhook stops working (deleted, or
the URL changed). Neither check goes through it. `AlertmanagerNotificationsFailing`
shows in Grafana, and [a test alert](./alerts.md#1-the-webhook) after any change
to the webhook catches it.

## Services

As of September 2026. Plans change: check the pricing page before relying on a
limit.

| Service | Uptime checks | Heartbeats | Free plan | Discord on the free plan | Free plan is for | Cheapest paid |
|---|---|---|---|---|---|---|
| [UptimeRobot](https://uptimerobot.com/pricing/) | ✅ HTTP, keyword, port, ping; certificate expiry | paid plans only | 50 monitors, every 5 min | ✅ | "hobby and non-profit projects" | Solo, $9–10/month: every 60 s, heartbeats, webhooks |
| [Healthchecks.io](https://healthchecks.io/pricing/) | ❌ | ✅ | 20 checks | ✅ | no restriction stated | Business, $20/month: 100 checks, SMS and calls |
| [Better Stack](https://betterstack.com/pricing) | ✅ | ✅ | 10 monitors and heartbeats together | ❌ (Slack and email) | "personal projects" | $21–25/month: 50 more monitors, calls, SMS |
| [Cronitor](https://cronitor.io/pricing) | ✅ | ✅ | 5 monitors together, every 5 min | ✅ | "homelabs and small projects" | $2/month per monitor, plus $5 per user |
| [Grafana Cloud Synthetic Monitoring](https://grafana.com/pricing/) | ✅, from several locations | ❌ | 100k test runs/month | ✅, through Grafana alerting | "always free" | pay as you go |
| [Uptime Kuma](https://uptimekuma.co/) (open source) | ✅ | ✅ (Push monitors) | self-hosted, free | ✅ | anything | the cost of the machine it runs on |

For scale: this starter needs **2 uptime monitors** (API, frontend) and **1
heartbeat**. Sign-in is part of the API (`/api/v1/auth/...`), so the API
monitor covers it: there is no separate sign-in domain to watch. A check every
5 minutes is about 8,600 runs a month.

Uptime Kuma must run **somewhere else**: on the same server it goes down with
everything it watches.

## Recommendation

**By default: UptimeRobot for the uptime check, Healthchecks.io for the
heartbeat.** Both are free at this size, both post to Discord, and each has
plenty of room: 2 of UptimeRobot's 50 monitors, 1 of Healthchecks.io's 20
checks. No single free plan does both kinds with Discord alerts, except
Cronitor, whose 5 monitors hold all three with room for two more
([below](#one-service-instead-of-two)).

Adjust for your situation:

| Situation | Uptime check | Heartbeat |
|---|---|---|
| Personal, hobby or non-profit project | UptimeRobot, free | Healthchecks.io, free |
| Commercial project (the free plans above are for hobby and personal use) | UptimeRobot Solo ($9–10/month): 1-minute checks | Healthchecks.io, free (no restriction stated), or UptimeRobot Solo's heartbeat to keep one account |
| Already sending metrics to Grafana Cloud | Grafana Cloud Synthetic Monitoring | Healthchecks.io, free |
| You run a second server anyway | Uptime Kuma on it | Uptime Kuma on it |
| One account, free, and 5 monitors is enough | Cronitor | Cronitor |

Whatever you choose: send its alerts to the same Discord channel as the rest,
and test each check once (below). A check that has never alerted is one you
don't know works.

## Setting up: UptimeRobot and Healthchecks.io

About 20 minutes, once the app is live on its public domain. Service screens
change: if a button has moved, the step is the same.

### Discord webhooks

UptimeRobot takes a Discord webhook URL: create one for it in your alerts
channel (Server Settings → Integrations → Webhooks → New Webhook), named
`UptimeRobot`, rather than reusing Alertmanager's. If one leaks, you delete that
one without breaking the others. Healthchecks.io connects to Discord itself and
creates its own.

### 1. Uptime check with UptimeRobot

1. **Account.** Sign up at [uptimerobot.com](https://uptimerobot.com).
2. **Discord.** Integrations → Discord: paste the webhook URL made for
   UptimeRobot, choose the events (down, up, and certificate expiry if offered),
   save.
3. **Monitors.** New monitor, twice, each of type HTTP(s), every 5
   minutes, alerting the Discord integration:

   | Name | URL | Why this URL |
   |---|---|---|
   | `shop API` | `https://api.example.com/api/v1/health/live` | Answers while the app runs; goes through DNS, TLS and nginx like every request |
   | `shop frontend` | `https://example.com/` | The site itself |

   `/api/v1/health/live` rather than `/api/v1/health`: the full health check
   also fails when Postgres or Redis is down, which the server's own alerts
   already report in more detail. The uptime check's job is reachability.

   Optional third monitor, if you want to know the sign-in pages can load
   their settings: type **Keyword**, URL
   `https://api.example.com/api/v1/auth/options`, keyword `providers`. That
   route is public and answers without touching the database. It adds little
   over `/health/live`, so skip it if you are short of monitors.
4. **Certificates.** If your plan offers certificate (SSL) expiry reminders,
   turn them on for the monitors: Let's Encrypt certificates last 90 days and
   renew automatically, until a renewal silently fails.
5. **Test.** Add another, temporary monitor for
   `https://api.example.com/api/v1/this-route-does-not-exist`. It answers 404,
   so it's reported down, and a message arrives in Discord within about 10
   minutes. Delete the monitor.

### 2. Heartbeat with Healthchecks.io

1. **Account.** Sign up at [healthchecks.io](https://healthchecks.io) and name
   the project after the stack (`shop-prod`).
2. **Discord.** Integrations → Discord → add it. Healthchecks.io sends you to
   Discord to pick the server and channel.
3. **Check.** Add Check, named `shop-prod alerting`. Schedule: **Period 5
   minutes, Grace 5 minutes**. Copy its ping URL, `https://hc-ping.com/<uuid>`.

   Alertmanager calls about once a minute. The check goes down when no call
   arrives within period plus grace: 10 minutes. Shorter would page you when
   Alertmanager restarts during a deploy.
4. **Server.** In `.env.production`:
   ```
   ALERT_HEARTBEAT_URL=https://hc-ping.com/<uuid>
   ```
   In `monitoring/alertmanager/alertmanager.yml`, uncomment the three
   `webhook_configs` lines under the `heartbeat` receiver:
   ```yaml
     - name: heartbeat
       webhook_configs:
         - url_file: /tmp/alert_heartbeat_url
           send_resolved: false
   ```
   Commit, and deploy. A changed environment recreates Alertmanager, which then
   reads the new configuration; if only `alertmanager.yml` changed, restart it:
   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yaml restart alertmanager
   ```
5. **Verify.** Within two minutes the check turns green (up) in
   Healthchecks.io. On [Alertmanager's page](./alerts.md#the-alertmanager-page)
   the `Watchdog` group is under the `heartbeat` receiver.
6. **Test.** Stop Alertmanager:
   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yaml stop alertmanager
   ```
   About 10 minutes later Healthchecks.io posts in Discord that the check is
   down. Start it again (`… start alertmanager`), and the "up" message follows.

### Checklist

- [ ] Discord webhooks for UptimeRobot and Healthchecks.io
- [ ] Two HTTP monitors: API, frontend; certificate reminders if available
- [ ] The 404 test monitor alerted, then deleted
- [ ] `ALERT_HEARTBEAT_URL` set and the heartbeat receiver uncommented
- [ ] The heartbeat check is green, and stopping Alertmanager made it alert

## One service instead of two

The setup is the same in spirit: HTTP monitors for the two URLs, and one
heartbeat whose URL goes into `ALERT_HEARTBEAT_URL` with the receiver
uncommented, as in [step 2](#2-heartbeat-with-healthchecksio).

- **Cronitor (free):** create two uptime monitors and one heartbeat monitor
  (expected every 5 minutes, alert after 5 more), and connect Discord. That is
  3 of its 5 free monitors.
- **UptimeRobot Solo:** add a heartbeat monitor with a 5-minute interval next to
  the two HTTP monitors. Check that your plan lists heartbeat monitoring.
- **Uptime Kuma:** on a machine other than the app server, two HTTP(s)
  monitors and one Push monitor with a 300-second heartbeat interval; add a
  Discord notification with a webhook. Alertmanager calls the Push URL with a
  POST: try `curl -X POST <push URL>` first and check the monitor registers it.
- **Better Stack (free):** uptime monitors and a heartbeat together, but alerts
  only by email or Slack on the free plan, not Discord.
- **Grafana Cloud:** Synthetic Monitoring covers the uptime check only; keep a
  heartbeat service.

## When one of them alerts

**The uptime check says the API or the frontend is down**, and your own
alerts are quiet:

1. Open the URL yourself, from your phone's mobile data too (not only your
   network).
2. Certificate: the browser says it expired or is invalid → `sudo certbot renew`,
   and `systemctl status certbot.timer`: renewal runs from that timer.
3. DNS: `dig api.example.com` shows the server's address?
4. The server: `ssh` in. If you can't, it's the server or the provider (their
   status page, the console).
5. nginx: `sudo nginx -t` and `sudo systemctl status nginx`.
6. The app: `docker compose --env-file .env.production -f docker-compose.prod.yaml ps`.

**The heartbeat check says alerting stopped:**

1. `ssh` in. If you can't, the server is down: the uptime check will be red too.
2. `docker compose --env-file .env.production -f docker-compose.prod.yaml ps prometheus alertmanager`
   shows both running?
3. `docker compose … logs --tail 50 alertmanager`: errors sending to the
   heartbeat URL (a changed or deleted check)?
4. Prometheus → Status → Rules: the `Watchdog` rule loaded?
5. Once fixed, the check turns green by itself within a couple of minutes.
