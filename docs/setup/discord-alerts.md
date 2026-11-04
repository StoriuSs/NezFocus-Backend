# Discord for alerts

**What it is for here.** The server checks itself all the time: is the app
answering, is the database up, is the disk filling, did last night's backup
run, are sign-ins suddenly failing. When a rule trips, **Alertmanager** (the
part that turns alerts into messages) posts to a chat channel. The starter is
set up for **Discord**, through a **webhook**: a secret address that lets a
program post into one channel. Which alerts exist and what to do about each:
[../alerts.md](../alerts.md).

**Do you need it?** In **production, yes**: the app refuses to start without
`ALERT_WEBHOOK_URL`, because a server that can't tell anyone it is broken is
worse than one that doesn't start. In development it is optional: leave it
empty, and alerts only show in Grafana and on http://localhost:9093.

**Cost.** Free.

- [1. A server and a channel](#1-a-server-and-a-channel)
- [2. The webhook](#2-the-webhook)
- [3. Where the value goes](#3-where-the-value-goes)
- [4. Notifications on your phone](#4-notifications-on-your-phone)
- [Other places to send alerts](#other-places-to-send-alerts)
- [Check it works](#check-it-works)
- [Common mistakes](#common-mistakes)

## 1. A server and a channel

A Discord "server" is a group of channels; it costs nothing and can be just you.

1. Install Discord (desktop and phone) or open https://discord.com/app, and sign
   in or create an account.
2. In the left column, click **+** (**Add a Server**) → **Create My Own** → **For
   me and my friends** (either choice works) → a name, e.g. `MyApp ops` →
   **Create**.
3. Create a text channel for production alerts: next to **Text Channels**, click
   **+** → name it `alerts-prod` → **Create Channel**.
4. Optional but recommended: a second channel, `alerts-dev`, for development
   and for trying things out, so tests never land among real alerts.

## 2. The webhook

You need the **Manage Webhooks** permission on the server; as its owner you have it.

1. Open **Server Settings** (click the server's name at the top left →
   **Server Settings**).
2. **Integrations** → **Webhooks** → **New Webhook** (some versions say
   **Create Webhook**).
3. Click the new webhook to open it. Set:
   - **Name**: `Alertmanager` (shown as the sender of each message);
   - **Channel**: `alerts-prod`.
4. **Save Changes**, then **Copy Webhook URL**. It looks like
   `https://discord.com/api/webhooks/<number>/<long token>`.
5. Put it straight into the password manager. **Anyone who has the URL can post
   in the channel.**

Make one webhook per sender: one for Alertmanager in production, one for
development (in `alerts-dev`), one for the uptime service
([uptime-check.md](./uptime-check.md)). If one leaks, you delete that one and
nothing else breaks.

## 3. Where the value goes

| File | Line | Notes |
|---|---|---|
| `.env.production` (server) | `ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/<id>/<token>` | **Required.** Must start with `https://`, and must not be the template's `your-webhook-id` placeholder: production refuses both |
| `.env.development` (optional) | `ALERT_WEBHOOK_URL=` the `alerts-dev` webhook, or empty | Empty: Alertmanager uses its development setup and sends nothing. Set: it uses the production setup and posts there ([../alerts.md](../alerts.md#development)) |

With `MONITORING=grafana-cloud`, the same variable becomes the contact point in
Grafana Cloud when `pnpm monitoring:cloud-sync` runs ([grafana-cloud.md](./grafana-cloud.md)).

A changed URL takes effect with the next `./deploy.sh`, or right away with:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yaml up -d alertmanager
```

In development: `pnpm docker:dev`.

## 4. Notifications on your phone

An alert at 3 a.m. that nobody sees is no alert. In the Discord app:

1. Long-press (phone) or right-click (desktop) the `alerts-prod` channel →
   **Notification Settings** → **All Messages**.
2. Make sure Discord may send notifications on your phone (the phone's own
   settings), and that the server is not muted.
3. Leave `alerts-dev` on **Only @mentions** or muted.

## Other places to send alerts

Slack, Microsoft Teams, email, or any program that accepts a webhook: change the
`notify` receiver in `monitoring/alertmanager/alertmanager.yml`; the URL still
comes from `ALERT_WEBHOOK_URL`. The exact lines for each:
[../alerts.md](../alerts.md#another-chat-or-email).

## Check it works

**1. The webhook itself**, from any machine:

```bash
curl -i -H 'Content-Type: application/json' \
  -d '{"content":"Webhook test: if you read this, the URL works."}' \
  'https://discord.com/api/webhooks/<id>/<token>'
```

`HTTP/2 204` and the message in the channel: the URL works.

**2. The whole chain**, after a deploy, on the server: Alertmanager sends a
made-up alert exactly as it would a real one.

```bash
docker compose --env-file .env.production -f docker-compose.prod.yaml exec alertmanager \
  amtool --alertmanager.url=http://localhost:9093 alert add TestAlert 'severity="warning"' \
  --annotation='summary="Test alert: alerting works"'
```

It arrives within a minute, and a "Resolved" message follows 5 to 10 minutes
later. In development, with a webhook set:

```bash
docker exec alertmanager-hexagonal-auth-dev amtool --alertmanager.url=http://localhost:9093 \
  alert add TestAlert 'severity="warning"' --annotation='summary="Test alert from development"'
```

**3. A real failure**, once, on a calm day: `docker stop
redis-hexagonal-auth-prod`, wait for `RedisDown` (about 2 minutes), then
`docker start redis-hexagonal-auth-prod` and wait for "Resolved". Users get
errors in between, so pick a quiet moment.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| The deploy stops: `set ALERT_WEBHOOK_URL in .env.production` | Not set | Section 3 |
| `ALERT_WEBHOOK_URL still holds the template placeholder` | The template's line was left in | Paste the real URL |
| `curl` answers `401` or `404` (`Unknown Webhook`) | The webhook was deleted, or the URL was cut short when copied | **Copy Webhook URL** again; check it ends with the long token |
| The test alert never arrives, the `curl` test works | Alertmanager still has the old URL | `docker compose ... up -d alertmanager` (section 3), then `docker logs alertmanager-hexagonal-auth-prod` |
| Development alerts appear in the production channel | Development uses the production webhook | A separate webhook in `alerts-dev` for `.env.development` |
| Alerts arrive, nobody notices | Channel notifications are off on the phone | Section 4 |
| You pasted the URL somewhere public | Anyone can now post in the channel | Delete the webhook in **Integrations → Webhooks**, make a new one, update the env file, redeploy |
