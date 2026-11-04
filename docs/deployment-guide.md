# Going to production

You have the app running on your machine and you want it on the internet. This
page is the route: what to do, in what order, with a link to the page that
explains each step properly. Nothing is explained twice, so follow the links.

If you have never deployed anything before, read the whole page first. It is
short, and knowing what is coming makes each step make sense. For the same
route as one ordered walkthrough, with the click-by-click steps for every
outside service, follow
[setup/prepare-for-production.md](./setup/prepare-for-production.md) and come
back here for [the checklist](#the-checklist).

- [What you need before you start](#what-you-need-before-you-start)
- [The first deploy](#the-first-deploy)
- [Once it is live](#once-it-is-live)
- [The checklist](#the-checklist)
- [Later, when it matters](#later-when-it-matters)
- [What this costs](#what-this-costs)

## What you need before you start

**A server.** A VPS — a slice of a machine in a data centre that stays on.
Hetzner, DigitalOcean and Linode are all fine and all cost about the same.
Choose **Ubuntu LTS**, because every instruction you will ever read assumes it.

Size it for what you are running. This stack is the API, Postgres, Redis and
the monitoring containers:

| What you run | Minimum |
| --- | --- |
| Everything, including monitoring | 2 GB RAM, 2 vCPU |
| Without the monitoring stack (`MONITORING=grafana-cloud`) | 1 GB RAM, 1 vCPU |

Pick the region closest to your users. Nothing you do in software will beat
being 200ms closer.

**A domain**, and two DNS `A` records pointing at the server's IP address: one
for the site and one for the API, for example `app.` and `api.`. Sign-in is
part of the API, so there is no third name. Cloudflare Registrar sells at cost;
Namecheap is fine too ([setup/domain-dns-tls.md](./setup/domain-dns-tls.md)).

**An email provider.** Sign-up and password reset email a code, so the app
refuses to start in production without an SMTP server
([setup/email.md](./setup/email.md)). Everything else outside the server is
optional or can come later: Google sign-in, Turnstile, S3 storage, an
off-server backup bucket, Sentry. [setup/README.md](./setup/README.md) lists
them all.

**About 20 minutes**, once the server and the email provider exist.

## The first deploy

In this order:

1. **[Prepare the server](./server.md)** — security updates, a firewall, SSH
   keys instead of passwords, fail2ban, and swap. Twenty minutes that you do
   once, and the page explains what each piece is actually for.

2. **Install Docker**, from Docker's own repository rather than Ubuntu's
   (Ubuntu's package is old and is not Docker's). The steps are in
   [setup/prepare-for-production.md](./setup/prepare-for-production.md).

3. **Clone the repository onto the server** and create its environment file:
   `cp .env.example .env.production`, then fill it in. Every variable is
   explained in [environment.md](./environment.md). `./deploy.sh` checks the
   file inside the new image before it changes anything, and names every value
   that is missing or invalid; with Node on a machine,
   `pnpm env:check .env.production` runs the same check.

   `.env.production` is git-ignored because it holds real passwords. It is
   created on the server, by hand, and never committed.

4. **Put a reverse proxy in front.** Your containers listen on local ports;
   visitors arrive at port 443 asking for a hostname. nginx on the host sorts
   that out and terminates HTTPS. `nginx/bootstrap-nginx.sh` writes the
   configuration and Let's Encrypt issues the certificate free —
   [server.md](./server.md#the-reverse-proxy-and-https) has the commands and
   the one thing to get right first (DNS).

5. **Deploy.** `./deploy.sh` builds or pulls the image, runs the migrations
   once, starts the new release, waits for it to become healthy, and rolls back
   by itself if it does not. See [deploy.md](./deploy.md).

At this point the site is live. The rest of this page is about keeping it that
way.

## Once it is live

These are not optional in the way the word usually implies. Each one is the
answer to a specific bad day.

| Do this | Because | Where |
| --- | --- | --- |
| **Backups, and a test restore** | A backup nobody has restored is not a backup. The restore script has a `verify` mode for exactly this. | [backups.md](./backups.md) |
| **Alerts** | You want to hear about it from a notification, not from a user. | [alerts.md](./alerts.md) |
| **An external uptime check** | Everything above runs *on the server*. If the server is down, so is whatever would have told you. | [external-monitoring.md](./external-monitoring.md) |

Then, when you have a moment:

- **[Monitoring](./monitoring.md)** — the dashboards, and where to look when
  something is slow.
- **[Logging](./logging.md)** — how to find one request's logs among millions.
- **[Error tracking](./error-tracking.md)** — optional, off unless you set a
  DSN, and the fastest way to find out *why* a 500 happened.

## The checklist

Work through this once, on the day. It is long because it is complete — most
lines are a glance, and the four or five that are not are the ones that ruin
an afternoon.

If you have not yet renamed the starter for your project, do that first:
[making-it-yours.md](./making-it-yours.md).

### The environment file

Created **on the server**, by hand, from `.env.example`. Never copied from
your development machine — the point of separate files is that no development
secret ends up in production.

```bash
cp .env.example .env.production
nano .env.production
```

[setup/prepare-for-production.md](./setup/prepare-for-production.md) goes
through the file field by field; [environment.md](./environment.md) is the
reference for every variable.

**Secrets — every one generated fresh** (`openssl rand -hex 24`):

- [ ] `DB_PASSWORD` — and it must be **URL-safe**: letters, digits, `. _ ~ -`
      only, because it goes into `DATABASE_URL` unescaped. `DB_NAME` and
      `DB_USERNAME` too
- [ ] `REDIS_PASSWORD` — required in production; Redis holds your queues
      (including the codes in waiting emails), idempotency locks, rate-limit
      counters and the session check's cache
- [ ] `BULL_BOARD_PASSWORD` — production refuses the default and anything
      weak. A waiting or failed email job on `/admin/queues` holds the sign-in
      or reset code it sends, so whoever reads that page can take over an
      account. `BULL_BOARD_USER` is not checked: change it from `admin` anyway
- [ ] `GRAFANA_ADMIN_PASSWORD`, if you are self-hosting monitoring. Compose
      refuses an empty one but **does not judge its strength**: it is read by
      compose, not the app
- [ ] No unquoted `$` in any of them. Compose expands `$NAME` in env files, so
      `aB3$kL9` silently becomes `aB3`

**Addresses — the ones that produce a 401, a 502 or a blank page when wrong:**

- [ ] `PORT=3000` — the template's `8888` is for development. nginx forwards to
      3000 unless `bootstrap-nginx.sh` was given another `--api-port`; a
      mismatch answers 502
- [ ] `BASE_URL` is the real public API address (`https://api.example.com`). It
      builds the URLs for locally stored uploads, is the issuer and audience of
      every access token, and the base of the Google redirect URI. Changing it
      later signs every access token out and needs the new redirect URI
      registered with Google
- [ ] `CORS_ORIGINS` lists your real frontend origin and nothing else. No
      wildcard, no leftover `localhost`
- [ ] `FRONTEND_URL` is the web app's public address — **required in
      production**. The "reset your password" links in auth emails, and the
      return from Google sign-in, point there

**Decisions to make deliberately rather than inherit:**

- [ ] `THROTTLE_LIMIT` and `THROTTLE_TTL` — a number you chose. If you raised
      it for a load test, put it back
- [ ] `MONITORING` — `local` (Prometheus, Grafana, Loki, Alertmanager and
      Alloy on the server: four more containers than `grafana-cloud`, which
      runs only Alloy) or `grafana-cloud`. Cloud needs five `GRAFANA_CLOUD_*`
      values (the Prometheus and Loki URLs and users, and the token), and
      compose refuses to start without them; the other two are for
      `pnpm monitoring:cloud-sync` ([setup/grafana-cloud.md](./setup/grafana-cloud.md))
- [ ] `STORAGE_TYPE` — `local` keeps avatars on the server's disk, which is
      fine for one server and not for two. `s3` makes four `AWS_*` values
      required
- [ ] `EMAIL_*` — a real SMTP server. **Required in production**: nobody can
      confirm an account, so nobody can sign in, without it. Send one real
      sign-up through it before launch ([setup/email.md](./setup/email.md))
- [ ] `SENTRY_DSN` — a project of its own, not shared with staging. Empty
      turns error tracking off
- [ ] `DELETED_ACCOUNT_RETENTION_DAYS` — how long a deleted account's personal
      data survives. It is a policy decision, and possibly a legal one
- [ ] `LOG_LEVEL` — `info` unless you have a reason

**Alerts and backups, which are only useful if configured before you need them:**

- [ ] `ALERT_WEBHOOK_URL` — **required in production**; must be `https`
      ([setup/discord-alerts.md](./setup/discord-alerts.md))
- [ ] `BACKUP_S3_*` — the off-server copy. A backup that only exists on the
      server does not survive losing the server
      ([setup/offsite-backups.md](./setup/offsite-backups.md))
- [ ] `BACKUP_DB_*` — only if the database is somewhere else
- [ ] `ALERT_HEARTBEAT_URL` — optional dead-man's switch

**If CI builds your images:**

- [ ] `DEPLOY_IMAGE_SOURCE=registry` and `DEPLOY_IMAGE` set to the published
      image, **lowercase**
- [ ] The server can log in to the registry (`docker login ghcr.io`)
      ([setup/github.md](./setup/github.md))

**Then:**

- [ ] The check passes with no errors **and** no warnings about keys nothing
      reads — a misspelled optional key silently leaves the default in force.
      `./deploy.sh` runs it inside the image and stops before changing
      anything; with Node and pnpm on a machine that has the file,
      `pnpm env:check .env.production` runs it on its own

### Authentication

How sign-in runs in production, and the troubleshooting table for when it
does not: [auth/operations.md](./auth/operations.md).

**Secrets:**

- [ ] `JWT_SECRET` — its own `openssl rand -hex 32`, not the development one
- [ ] `AUTH_ENCRYPTION_KEY` — another `openssl rand -hex 32`. **Back it up**
      with the database password, somewhere other than the server: losing it
      locks everyone with two-step sign-in out of the second step, and a
      restored backup is useless for them without it
- [ ] `AUTH_ENCRYPTION_KEY_PREVIOUS` is **empty**. It is only for the time
      between changing the key and `auth:rotate-key` finishing
      ([auth/two-step-sign-in.md](./auth/two-step-sign-in.md))

**Cookies and origins** (the usual reasons sign-in works and then fails):

- [ ] `CORS_ORIGINS` — the frontend's exact origin (`https://app.example.com`,
      no trailing slash). Refresh is refused from anywhere else
      (`403 AUTH_FORBIDDEN`)
- [ ] The frontend and the API are on **one site** (`app.example.com` and
      `api.example.com`). If not, `AUTH_COOKIE_SAMESITE=none`, or every session
      ends after 15 minutes ([auth/sessions-and-tokens.md](./auth/sessions-and-tokens.md))
- [ ] `CORS_CREDENTIALS` is not `false` (production refuses it anyway)

**Email:**

- [ ] `EMAIL_FROM_ADDRESS` is on a domain you authenticated with your provider
      (SPF and DKIM records), or codes land in spam
      ([setup/email.md](./setup/email.md))
- [ ] `SUPPORT_EMAIL` — an address people can write to. It is named in the
      "two-step sign-in was turned on/off" and "account deleted" emails, the
      ones where only a person can help. Empty, they name none
- [ ] A real sign-up went through: the code arrived, in the inbox

**Google sign-in**, if you use it ([setup/google-sign-in.md](./setup/google-sign-in.md)):

- [ ] `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from a **production**
      OAuth client, both set
- [ ] `https://api.example.com/api/v1/auth/google/callback` registered as an
      authorized redirect URI, exactly (`<BASE_URL>/api/v1/auth/google/callback`)
- [ ] The consent screen **published** ("In production"), or only the test
      users you listed can sign in

**Turnstile**, if you use it ([setup/cloudflare-turnstile.md](./setup/cloudflare-turnstile.md)):

- [ ] `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` — a widget with your
      production hostname, not the test keys

**People and tools:**

- [ ] The first administrator: after they sign up, run on the server
      `docker compose --env-file .env.production -f docker-compose.prod.yaml exec app node dist/src/bootstrap/user-roles.js <email>`
- [ ] The two recovery tools tried once, while it is calm, so the form is
      familiar on a bad day. Both are safe to run:
      `docker compose --env-file .env.production -f docker-compose.prod.yaml exec app node dist/src/bootstrap/rotate-encryption-key.js`
      (seals every two-step secret with the current key, and says what still
      needs the previous one) and
      `docker compose --env-file .env.production -f docker-compose.prod.yaml exec app node dist/src/bootstrap/two-factor-off.js --unreadable`
      (lists the accounts whose secret cannot be read; nothing changes without
      `--yes`). [auth/operations.md](./auth/operations.md) explains both

The `--env-file .env.production` is not optional: without it compose cannot
fill in `REDIS_PASSWORD` and the other required values in the compose file,
and refuses even an `exec`.

### The server

Covered in [server.md](./server.md); the short form:

- [ ] Only ports 22, 80 and 443 reachable, in your provider's firewall
- [ ] SSH keys only — `sudo sshd -T | grep passwordauthentication` says `no`
- [ ] `unattended-upgrades` active, fail2ban running, swap on
- [ ] nginx and a certificate ([the reverse proxy](./server.md#the-reverse-proxy-and-https))
- [ ] DNS resolves to this server **before** you run certbot

### The first deploy

- [ ] `./deploy.sh` finishes and the site answers
- [ ] `curl https://api.example.com/api/v1/health` reports every check `up`
- [ ] `/api/v1/metrics` and `/admin/queues` return **403** from outside
- [ ] Sign up, confirm with the emailed code, sign out and sign in again, end
      to end from the real frontend. Then wait 15 minutes and click something:
      if that signs you out, the refresh cookie is not reaching the API
      ([auth/operations.md](./auth/operations.md))

### Before you call it done

These four are the difference between a deployment and a liability:

- [ ] **A backup restored**, not just taken. `restore.sh` runs inside the
      backup container and takes the database name:
      `docker compose --env-file .env.production -f docker-compose.prod.yaml exec backup restore.sh verify <DB_NAME>`
      ([backups.md](./backups.md#test-a-dump-do-this-regularly))
- [ ] **An alert seen arriving.** Stop Redis for three minutes and watch the
      channel. Alerting is a chain of five things and the only way to know it
      works is to break something
- [ ] **A rollback rehearsed** — `./deploy.sh --rollback` — while it is calm
- [ ] **An uptime check from outside the server.** Everything else that would
      tell you it is down runs *on* it
      ([external-monitoring.md](./external-monitoring.md),
      [setup/uptime-check.md](./setup/uptime-check.md))

### Worth doing before launch day

- [ ] A load test at the traffic you expect ([load-testing.md](./load-testing.md))
- [ ] `GRACEFUL_SHUTDOWN_TIMEOUT_MS` below whatever kills your container
- [ ] `DB_POOL_MAX` × instances still under Postgres' `max_connections`
- [ ] Someone other than you has the passwords and `AUTH_ENCRYPTION_KEY`

## Later, when it matters

Do not do these on day one. Each earns its place at a certain point, and doing
them early costs time you could spend on the product.

| When | Do | Where |
| --- | --- | --- |
| Deploying by hand gets annoying | Turn on the **Deploy button** — a workflow that runs `deploy.sh` over SSH, with a rollback option | [deploy.md](./deploy.md#the-deploy-button) |
| Before a launch, or before an event you expect traffic from | **Load test it**, so you find the ceiling before your users do | [load-testing.md](./load-testing.md) |
| The database is the thing you are most afraid of losing | Move Postgres to a **managed service** | [scaling.md](./scaling.md#moving-services-off-the-box) |
| One server is not enough | **Scale out** — but only once the state is off the box | [scaling.md](./scaling.md) |
| You need something the starter does not have | Audit logs, feature flags, tracing, and the rest | [extensions.md](./extensions.md) |

## What this costs

Rough monthly figures, to set expectations:

| Item | Cost |
| --- | --- |
| A 4 GB VPS | $20–24 |
| A domain | $1–2 |
| HTTPS certificates | free (Let's Encrypt) |
| Email (SMTP) | a free tier is enough to start ([setup/email.md](./setup/email.md)) |
| Off-server backup storage | cents (Cloudflare R2, Backblaze B2) |
| Uptime monitoring | free tier is plenty |
| Grafana Cloud, if you use it instead of self-hosting | free tier is plenty |

So: **around $25 a month** for a production deployment with backups,
monitoring and alerting. The first thing that changes that is a managed
database, which roughly doubles it.

## Related

- [server.md](./server.md) — preparing the machine
- [deploy.md](./deploy.md) — releases, rollback, the Deploy button
- [docker.md](./docker.md) — what the compose files actually do
- [environment.md](./environment.md) — every variable
- [setup/prepare-for-production.md](./setup/prepare-for-production.md) — the
  ordered walkthrough, with every outside service
- [auth/operations.md](./auth/operations.md) — sign-in in production
- [scaling.md](./scaling.md) — growing out of one box
