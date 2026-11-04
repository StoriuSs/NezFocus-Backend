# Uptime check and heartbeat

**What it is for here.** Every alert in [discord-alerts.md](./discord-alerts.md)
is raised and sent by programs running **on your server**. Two failures slip
past them:

- **Nobody can reach the site, but the server is fine**: an expired certificate,
  a DNS mistake, nginx down, the provider's network. Inside, every check passes,
  so nothing alerts.
- **The alerting itself is down**: the server is off, or Prometheus or
  Alertmanager stopped. The thing that would tell you is the thing that's gone,
  and a silent channel looks just like a healthy one.

Two checks from **outside** close those gaps:

| | Who calls whom | Catches |
|---|---|---|
| **Uptime check** | An outside service opens your site every few minutes, like a visitor | The site unreachable from the internet |
| **Heartbeat** | Your server calls an outside service every minute ("alerting still works"); the service tells you when the calls stop | Alerting dead, or the server gone |

The comparison of services, and what each check sees and misses:
[../external-monitoring.md](../external-monitoring.md).

**Do you need it?** In production: the uptime check, yes; the heartbeat, strongly
recommended. Not in development.

**Cost.** Free at this size: UptimeRobot's free plan has 50 monitors at a
5-minute interval (for "hobby and non-profit" projects; its Solo plan, about
$9 to $10 a month, is the commercial option); Healthchecks.io's free plan has
20 checks.

- [Part 1: the uptime check](#part-1-the-uptime-check)
- [Part 2: the heartbeat](#part-2-the-heartbeat)
- [Check it works](#check-it-works)
- [Common mistakes](#common-mistakes)

## Part 1: the uptime check

Do this once the site is live (the monitors would be red before).

**Which address to watch.** The API has three health addresses, all public:

| Address | Answers 200 when | Use it for the uptime check when |
|---|---|---|
| `/api/v1/health/live` | the app process answers | **The default.** The uptime check's job is "can the internet reach the API"; database and Redis outages are already alerted from the server, in more detail |
| `/api/v1/health/ready` | the app, Postgres and Redis all answer (otherwise 503) | You also want the outside check to page you when the database or Redis is down, e.g. because you run without the server's own alerts |
| `/api/v1/health` | everything, memory and disk included | Not for an uptime check: it fails for reasons that are not about being reachable |

### With UptimeRobot (recommended)

1. **Account**: sign up at https://uptimerobot.com.
2. **A Discord webhook just for UptimeRobot**: in Discord, **Server Settings →
   Integrations → Webhooks → New Webhook**, name `UptimeRobot`, channel
   `alerts-prod`, **Copy Webhook URL** ([discord-alerts.md](./discord-alerts.md#2-the-webhook)).
3. In UptimeRobot, **Integrations** (or **Alert Contacts**) → **Discord** → paste
   that URL → choose the events (down, up, and certificate expiry if offered) →
   save.
4. **+ Add New Monitor** (or **New monitor**):
   - **Monitor Type**: **HTTP(s)**;
   - **URL**: `https://api.example.com/api/v1/health/live`;
   - **Friendly Name**: e.g. `myapp API` (it may fill itself in);
   - **Monitoring Interval**: 5 minutes (the free plan's shortest);
   - **Alert contacts**: tick the Discord integration (and your email if you like);
   - **Create Monitor**.
5. The same again for the web app: `https://app.example.com/`.
6. **Certificate reminders**: if your plan offers SSL/certificate expiry
   alerts, turn them on for both. Let's Encrypt certificates renew by
   themselves, until one day the renewal silently fails.
7. **Test it**: add a third, temporary monitor for
   `https://api.example.com/api/v1/this-route-does-not-exist`. It answers 404,
   so UptimeRobot reports it down and Discord gets a message within about 10
   minutes. Then delete that monitor.

Screens change: if a button has another name, the steps are the same (a monitor
of type HTTP(s), the URL, the interval, who to alert).

### With Better Stack instead

Its free plan has 10 monitors and heartbeats together, checks every 3 minutes,
and alerts by **email or Slack, not Discord**. Sign up at
https://betterstack.com/uptime, create a monitor that alerts when the URL
becomes unavailable, with the same two URLs, and choose email. (Exact button
names could not be confirmed when this page was written.)

Other options (Cronitor, Uptime Kuma on another machine, Grafana Cloud
Synthetic Monitoring, Sentry's one free uptime monitor):
[../external-monitoring.md](../external-monitoring.md#services).

## Part 2: the heartbeat

The **Watchdog** alert is always firing, on purpose. Alertmanager sends it every
minute to the heartbeat address instead of to Discord. The outside service
expects that call, and alerts you when it stops.

### The check, at Healthchecks.io

1. Sign up at https://healthchecks.io. Name the project after the stack, e.g.
   `myapp-prod`.
2. **Integrations** → **Discord** → **Add Integration**. Healthchecks.io sends
   you to Discord to pick the server and channel (`alerts-prod`), and makes its
   own webhook.
3. **Add Check**. Name: `myapp-prod alerting`. Schedule: **Period 5 minutes,
   Grace 5 minutes**. Save.

   The check goes down when no call arrives within period plus grace, 10
   minutes. Shorter would alert you every time Alertmanager restarts during a
   deploy.
4. Copy the check's **ping URL**: `https://hc-ping.com/<uuid>`.

### On the server

1. In `.env.production`:

   ```bash
   ALERT_HEARTBEAT_URL=https://hc-ping.com/<uuid>
   ```

2. With `MONITORING=local` (the default), also turn the heartbeat on in
   `monitoring/alertmanager/alertmanager.yml`: under the `heartbeat` receiver,
   uncomment the three `webhook_configs` lines, so it reads:

   ```yaml
     - name: heartbeat
       webhook_configs:
         - url_file: /tmp/alert_heartbeat_url
           send_resolved: false
   ```

   This is a code change: commit it, push it, and deploy. (With
   `MONITORING=grafana-cloud` this step is not needed: `ALERT_HEARTBEAT_URL`
   alone makes the sync create a heartbeat contact point.)
3. Deploy: `./deploy.sh`. If only `alertmanager.yml` changed and the env file
   did not, restart Alertmanager afterwards:

   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yaml restart alertmanager
   ```

Don't point a development stack at the production heartbeat: development never
sends the Watchdog, by design, so it would not help, and a development stack
that did would hide a dead production one.

## Check it works

**Uptime check:**

- [ ] Both monitors show **Up**.
- [ ] The 404 test monitor posted "down" in Discord, and was then deleted.

**Heartbeat:**

- [ ] Within two minutes of the deploy, the check turns green (**up**) in
      Healthchecks.io.
- [ ] Stop Alertmanager, wait about 10 minutes, and Healthchecks.io posts in
      Discord that the check is down. Then start it again; the "up" message
      follows.

  ```bash
  docker compose --env-file .env.production -f docker-compose.prod.yaml stop alertmanager
  docker compose --env-file .env.production -f docker-compose.prod.yaml start alertmanager
  ```

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| The API monitor is down, the site works in your browser | The URL lacks `/api/v1`, or uses `http://` and the redirect is not followed | `https://api.example.com/api/v1/health/live` exactly |
| A short "down" right after a deploy | The check ran during the seconds the new release was starting, when nginx answers 502 ([../deploy.md](../deploy.md#downtime-during-a-deploy)) | Expected now and then. If it happens at every deploy, deploy at quiet times; avoiding it fully needs blue/green deploys |
| The heartbeat check stays "new" | Alertmanager never called it | The `webhook_configs` lines are still commented out, or the deploy didn't pick them up: restart Alertmanager; check `ALERT_HEARTBEAT_URL` is set |
| The heartbeat goes down at every deploy | The grace is too short | Period 5 minutes **and** grace 5 minutes |
| The uptime monitor alerts you about a database outage twice | It watches `/health/ready` while the server's own alerts also fire | Watch `/health/live`, or accept both |
| UptimeRobot alerts arrive among Alertmanager's with the same sender | One webhook shared by both | A webhook per sender ([discord-alerts.md](./discord-alerts.md#2-the-webhook)) |
