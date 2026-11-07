# Prepare for production

This page takes you from nothing to the API live on a server of your own, at
an address like `https://api.example.com`, with real email, alerts, backups and
an outside uptime check. Follow it top to bottom. Each step ends with **You are
done when**: check it before moving on.

It is long because it is complete. Most steps are 5 to 15 minutes of clicking
on a provider's website, and the per-service pages do the clicking with you.
Plan an afternoon. You do it once.

Before you start:

- Have the app working on your machine first
  ([prepare-for-development.md](./prepare-for-development.md)). Problems are
  much easier to understand there.
- Open a **password manager** (Bitwarden, 1Password, KeePassXC). Every secret
  you create below goes in it as you create it. Several are shown only once,
  and you will need them again if you ever lose the server.
- Read [../deployment-guide.md](../deployment-guide.md) once: it explains why
  each part exists. This page is the how.

Throughout, `example.com` stands for your domain, `api.example.com` for the
API, `app.example.com` for the web app, and `you@example.com` for your email.

- [Step 1: Choose the addresses](#step-1-choose-the-addresses)
- [Step 2: Get a server, and point the names at it](#step-2-get-a-server-and-point-the-names-at-it)
- [Step 3: Prepare the server](#step-3-prepare-the-server)
- [Step 4: Generate the secrets](#step-4-generate-the-secrets)
- [Step 5: Email](#step-5-email)
- [Step 6: Google sign-in (optional)](#step-6-google-sign-in-optional)
- [Step 7: Storage for profile pictures (optional)](#step-7-storage-for-profile-pictures-optional)
- [Step 8: A bucket for off-site backups](#step-8-a-bucket-for-off-site-backups)
- [Step 9: Sentry (recommended)](#step-9-sentry-recommended)
- [Step 10: Discord for alerts](#step-10-discord-for-alerts)
- [Step 11: Grafana Cloud (optional)](#step-11-grafana-cloud-optional)
- [Step 12: A heartbeat](#step-12-a-heartbeat)
- [Step 13: GitHub](#step-13-github)
- [Step 14: Put the code on the server](#step-14-put-the-code-on-the-server)
- [Step 15: Write .env.production](#step-15-write-envproduction)
- [Step 16: HTTPS](#step-16-https)
- [Step 17: Deploy](#step-17-deploy)
- [Step 18: The first administrator](#step-18-the-first-administrator)
- [Step 19: The uptime check](#step-19-the-uptime-check)
- [Step 20: The checks after the first deploy](#step-20-the-checks-after-the-first-deploy)
- [The web app](#the-web-app)

---

## Step 1: Choose the addresses

You need a domain (`example.com`) and two names under it:

| Name | Points at | Used for |
|---|---|---|
| `api.example.com` | the server | The API. This becomes `BASE_URL`, and Google's redirect address |
| `app.example.com` (or `example.com` itself) | the server, or wherever the web app is hosted | The web app. This becomes `FRONTEND_URL` and `CORS_ORIGINS` |

**Keep both under the same domain.** The sign-in cookie (the refresh token: a
long-lived secret kept in a cookie only the API can read) is sent by the
browser only when the web app and the API belong to the same site, unless you
loosen it. `app.example.com` and `api.example.com` are the same site;
`myapp.vercel.app` and `api.example.com` are not, and then every session ends
after 15 minutes unless you set `AUTH_COOKIE_SAMESITE=none`
([../auth/sessions-and-tokens.md](../auth/sessions-and-tokens.md)).

Buy the domain now if you don't have one: [domain-dns-tls.md](./domain-dns-tls.md).

**You are done when** you own the domain and can edit its DNS records
(Cloudflare's free DNS is what the domain page uses).

## Step 2: Get a server, and point the names at it

A VPS (a virtual server that stays on) with **Ubuntu LTS**. Size:

| What runs on it | At least |
|---|---|
| Everything, monitoring included (`MONITORING=local`) | 2 GB of memory, 2 CPUs; 4 GB is comfortable |
| Monitoring in Grafana Cloud (`MONITORING=grafana-cloud`) | 1 GB, 1 CPU |
| The server also builds the image (`DEPLOY_IMAGE_SOURCE=build`, the default) | Add room for the build, or let CI build it (step 13) |

Hetzner, DigitalOcean, Linode, AWS Lightsail and the like all work. Add your
SSH key when you create it, so you never log in with a password.

Then, in your DNS, create `A` records for `api` (and `app`, if the web app is
on the same server) pointing at the server's IP address. Leave them **DNS only**
(not proxied) for now: [domain-dns-tls.md](./domain-dns-tls.md).

**You are done when** you can `ssh ubuntu@<server-ip>` (or your provider's
user) without a password, and `dig +short api.example.com` prints the server's
IP. DNS can take a few minutes to an hour.

## Step 3: Prepare the server

1. **Harden it**: firewall (only ports 22, 80, 443), SSH keys only, security
   updates, fail2ban, swap. Follow [../server.md](../server.md); it says what
   Ubuntu already does, so you only do the rest. About 20 minutes.
2. **Install Docker** from Docker's own repository (Ubuntu's `docker.io`
   package is older and not Docker's). These are the commands from
   [Docker's guide](https://docs.docker.com/engine/install/ubuntu/); if they
   differ there by the time you read this, follow the guide:

   ```bash
   sudo apt-get update
   sudo apt-get install -y ca-certificates curl git
   sudo install -m 0755 -d /etc/apt/keyrings
   sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
   sudo chmod a+r /etc/apt/keyrings/docker.asc
   echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" \
     | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
   sudo apt-get update
   sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
   sudo usermod -aG docker "$USER"     # run docker without sudo
   ```

   Log out and back in, so the group change applies.

**You are done when**, logged in again, `docker compose version` prints v2.x,
`docker run --rm hello-world` works without `sudo`, `docker version` shows an
Engine of 25 or newer, and `git --version` answers. `deploy.sh` also needs
`flock`, which Ubuntu has (`flock --version`).

## Step 4: Generate the secrets

Make every one fresh for production; never reuse a development value. Hex
strings from `openssl` contain only `0-9a-f`, so they are safe in a URL and
contain no `$` (which Docker Compose would read as a variable). Run these
anywhere (your laptop is fine) and save each result in the password manager
under its variable name:

| Variable | Command | What production requires (`src/config/validation.ts`) | What it protects |
|---|---|---|---|
| `JWT_SECRET` | `openssl rand -hex 32` | At least 32 characters; not the template's placeholder, not a known default | Signs every access token, and keys the stored hashes of emailed codes. Changing it later signs everyone's access token out (sessions refresh and carry on) and voids codes in flight |
| `DB_PASSWORD` | `openssl rand -hex 24` | At least 12 characters; only letters, digits and `. _ ~ -`; not a placeholder starting `your_` | The database |
| `REDIS_PASSWORD` | `openssl rand -hex 24` | Required; at least 12 characters, not a known default | Redis, which holds the queues, sign-in limits and session cache |
| `BULL_BOARD_PASSWORD` | `openssl rand -hex 24` | At least 12 characters; not `admin` | The job dashboard `/admin/queues`, and `/api-docs` in production |
| `GRAFANA_ADMIN_PASSWORD` | `openssl rand -hex 24` | Required by Docker Compose with `MONITORING=local`; the app does not check it | The Grafana login |

Also choose, without generating:

- `DB_NAME` and `DB_USERNAME`, e.g. `myapp`: letters, digits and `. _ ~ -` only,
  because they go into the database address as they are.
- `BULL_BOARD_USER`, e.g. `ops`: anything but the obvious.

**You are done when** the password manager holds these eight values.

## Step 5: Email

Signing up and resetting a password email a six-digit code, so **production
needs a real email provider**: the app refuses to start without `EMAIL_HOST`.
Pick one (Brevo and Resend have free plans), prove you own the domain with a
few DNS records (SPF, DKIM, DMARC), and create SMTP credentials:
[email.md](./email.md).

You come back with: `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`, `EMAIL_USER`,
`EMAIL_PASSWORD`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`.

**You are done when** the provider shows your domain as verified, and you have
the SMTP login and password in the password manager. (You send a real email in
step 20.)

## Step 6: Google sign-in (optional)

Skip this if you don't want a "Continue with Google" button. Otherwise create a
**production** OAuth client (separate from the development one) whose
authorized redirect URI is exactly:

```
https://api.example.com/api/v1/auth/google/callback
```

That is `BASE_URL` + `/api/v1/auth/google/callback`, character for character.
Steps, and publishing the app so any Google account can sign in:
[google-sign-in.md](./google-sign-in.md).

You come back with: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

**You are done when** the client exists with that redirect URI, and the app's
audience is "In production" (or your test users are listed).

## Step 7: Storage for profile pictures (optional)

With `STORAGE_TYPE=local` (the default), uploaded profile pictures stay on the
server's disk, in a Docker volume, and the nightly backup copies them off-site
(step 8). That is fine for one server. Choose a bucket instead if you plan to
run more than one server, or would rather not keep files on it: AWS S3 or
Cloudflare R2, private, with a key limited to that bucket:
[storage-s3-r2.md](./storage-s3-r2.md).

You come back with (only for S3/R2): `STORAGE_TYPE=s3`, `AWS_REGION`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET`, and for R2
`AWS_S3_ENDPOINT`.

**You are done when** you have decided, and for a bucket, hold its name and key.

## Step 8: A bucket for off-site backups

Every night the `backup` service dumps the database to the server's disk.
A disk dies with its server, so copy the dumps to a bucket at **another
provider** (Backblaze B2 or Cloudflare R2 cost cents a month). Give the server
a key that can write but not delete, so someone who takes over the server can't
erase the backups: [offsite-backups.md](./offsite-backups.md).

You come back with: `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT` (not for AWS),
`BACKUP_S3_REGION`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`,
`BACKUP_S3_PREFIX`, and `BACKUP_S3_KEEP_DAYS=0` with a write-only key. Plus a
second, read-only key that **stays in the password manager**, for restores.

**You are done when** the bucket exists, private, and you hold both keys.

## Step 9: Sentry (recommended)

Sentry groups unexpected errors (500s, crashes, background jobs that gave up)
into issues, shows which release introduced each, and emails you about new
ones. The free plan is enough to start. Create a project for the API (and
another for the web app): [sentry.md](./sentry.md).

You come back with: `SENTRY_DSN` (the API project's). The web app's DSN goes in
the web app's own env file.

**You are done when** you have the API project's DSN.

## Step 10: Discord for alerts

The server watches itself (the app down, the disk filling, a backup that did
not run) and posts an alert when something is wrong. It needs somewhere to
post: **production refuses to start without `ALERT_WEBHOOK_URL`**. Create a
Discord server and channel, and a webhook for it: [discord-alerts.md](./discord-alerts.md).

You come back with: `ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/...`.

**You are done when** a test message posted with `curl` to the webhook appears
in the channel (the page shows the command), and notifications for that channel
are on, on your phone too.

## Step 11: Grafana Cloud (optional)

Dashboards, logs and alert rules run on the server by default
(`MONITORING=local`, about 600 MB of memory), and you look at them through an
SSH tunnel. Grafana Cloud's free plan can host them instead: less memory on the
server, dashboards reachable from anywhere, and an alert when the whole server
goes quiet. Skip this for now if unsure; switching later is a setting and a
deploy. Steps: [grafana-cloud.md](./grafana-cloud.md).

You come back with: `MONITORING=grafana-cloud` and the seven `GRAFANA_CLOUD_*`
values.

**You are done when** you have decided, and for Grafana Cloud, hold the seven values.

## Step 12: A heartbeat

The alerts in step 10 come from the server. If the server or its alerting
stops, nothing posts, and a silent channel looks like a healthy one. A
**heartbeat** closes that gap: the server calls an outside service every
minute, and the service tells you when the calls stop. Create a free check at
Healthchecks.io now, because its address goes in the env file:
[uptime-check.md](./uptime-check.md#part-2-the-heartbeat).

You come back with: `ALERT_HEARTBEAT_URL=https://hc-ping.com/<uuid>`, and you
uncomment three lines in `monitoring/alertmanager/alertmanager.yml` (the page
shows which), commit, and push.

The other half, the **uptime check** (an outside service that opens your site
every few minutes), needs the site to be live: step 19.

**You are done when** the check exists (it shows "new" until the first call)
and the `alertmanager.yml` change is pushed.

## Step 13: GitHub

What you set up depends on how you want to deploy. All of it is in
[github.md](./github.md):

| You want | Set up | Page section |
|---|---|---|
| The server to clone a **private** repository | A read-only deploy key on the server | [github.md](./github.md#4-let-the-server-clone-the-repository) |
| CI to build the image, and the server to download it instead of building (`DEPLOY_IMAGE_SOURCE=registry`). Recommended for servers under 2 GB | A token with `read:packages` and `docker login ghcr.io` on the server | [github.md](./github.md#5-let-the-server-download-the-image) |
| A **Deploy** button in GitHub instead of SSH-ing in | The secret `DEPLOY_SSH_KEY` and four variables | [github.md](./github.md#6-the-deploy-button) |
| Weekly dependency update pull requests | The Renovate app | [github.md](./github.md#7-renovate) |

For `registry` mode, check that CI has published an image of the commit you
will deploy: the repository's **Actions** tab shows a green run on `main`, and
your profile's **Packages** tab lists the image.

**You are done when** the server can `git clone` the repository (step 14 does
it), and, for `registry` mode, `docker login ghcr.io` on the server said
"Login Succeeded".

## Step 14: Put the code on the server

On the server, as the user that will run deploys (the one in the `docker`
group):

```bash
cd ~
git clone git@github.com:<your-org>/<your-repository>.git nest   # or the github-nest alias from github.md
cd nest
```

The folder (here `/home/ubuntu/nest`) is what the Deploy button calls
`DEPLOY_PATH`. `deploy.sh` deploys the branch that is checked out, normally
`main`.

**You are done when** `ls ~/nest` shows `deploy.sh` and `docker-compose.prod.yaml`.

## Step 15: Write .env.production

The production settings live in one file **on the server**, created by hand
from the template and never committed or copied from your laptop:

```bash
cd ~/nest
cp .env.example .env.production
chmod 600 .env.production           # only your user can read it
nano .env.production
```

Go through it group by group. Everything not mentioned can keep the template's
value. The full reference is [../environment.md](../environment.md).

**Application.** The template's port and addresses are development ones;
change all of them.

```bash
NODE_ENV=production
PORT=3000                        # not 8888 (see below)
API_PREFIX=api                   # keep: the health check path depends on it
APP_NAME=MyApp                   # shown in emails
BASE_URL=https://api.example.com
FRONTEND_URL=https://app.example.com   # required: links in emails point here
SUPPORT_EMAIL=support@example.com      # optional
DELETED_ACCOUNT_RETENTION_DAYS=30      # a policy decision, possibly a legal one
```

**`PORT` matters here.** The production compose file publishes the API on
`127.0.0.1:${PORT}`, and nginx (step 16) forwards to `127.0.0.1:3000` unless
you give `bootstrap-nginx.sh` another port with `--api-port`. Left at the
template's `8888`, every request answers **502 Bad Gateway**. So: `PORT=3000`,
or keep your own port and pass the same number as `--api-port` in step 16.
Inside the container the app always listens on 3000; `PORT` only chooses the
port on the server.

**Database and Redis** (from step 4). `DATABASE_URL` can stay as it is: the
compose file builds the real address from the three `DB_*` values and replaces
this line inside the container.

```bash
DB_NAME=myapp
DB_USERNAME=myapp
DB_PASSWORD=<openssl rand -hex 24>
REDIS_PASSWORD=<openssl rand -hex 24>
```

**Who may call the API from a browser.** `CORS_ORIGINS` is the web app's exact
origin: scheme and host, no path, no trailing slash. Refreshing a session is
refused from any other page.

```bash
CORS_ORIGINS=https://app.example.com
CORS_CREDENTIALS=true            # production refuses false
# AUTH_COOKIE_SAMESITE=lax       # keep lax with app. and api. on one domain; none otherwise
```

**Sign-in secrets** (step 4):

```bash
JWT_SECRET=<openssl rand -hex 32>
```

**Google** (step 6). Leave both empty to keep it off.

```bash
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
```

**Rate limit.** Requests per route, per `THROTTLE_TTL` seconds: per signed-in
user (`THROTTLE_LIMIT`), and per IP address for requests without a valid
access token (`THROTTLE_ANONYMOUS_LIMIT`, D-135).
Keep the template's numbers unless you have a reason; the sign-in routes have
their own, stricter limits ([../auth/rate-limits.md](../auth/rate-limits.md)).

```bash
THROTTLE_TTL=60
THROTTLE_LIMIT=100
THROTTLE_ANONYMOUS_LIMIT=300
```

**Email** (step 5), for example with Brevo:

```bash
EMAIL_HOST=smtp-relay.brevo.com
EMAIL_PORT=587
EMAIL_SECURE=false               # true only with port 465
EMAIL_USER=<SMTP login>
EMAIL_PASSWORD=<SMTP key>
EMAIL_FROM_NAME=MyApp
EMAIL_FROM_ADDRESS=noreply@example.com
```

**Storage** (step 7). Either keep `STORAGE_TYPE=local`, or:

```bash
STORAGE_TYPE=s3
AWS_REGION=auto                  # R2; for AWS the bucket's region
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET=myapp-avatars
AWS_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com   # R2 only; leave out for AWS
```

**Logging.** `LOG_LEVEL=info`.

**Monitoring and alerts** (steps 10 to 12):

```bash
MONITORING=local                 # or grafana-cloud, with the GRAFANA_CLOUD_* lines from step 11
GRAFANA_PORT=3002
GRAFANA_ADMIN_PASSWORD=<openssl rand -hex 24>
ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/<id>/<token>   # required
ALERT_HEARTBEAT_URL=https://hc-ping.com/<uuid>
```

**Error tracking** (step 9). Don't set `SENTRY_RELEASE`: the compose file sets
it to the commit being deployed.

```bash
SENTRY_DSN=https://<key>@o<org-id>.ingest.us.sentry.io/<project-id>
SENTRY_TRACES_SAMPLE_RATE=0
```

**The job dashboard** (step 4). In production this login also protects `/api-docs`.

```bash
BULL_BOARD_USER=ops
BULL_BOARD_PASSWORD=<openssl rand -hex 24>
```

**Backups** (step 8). Uncomment and fill in:

```bash
BACKUP_S3_BUCKET=myapp-backups
BACKUP_S3_ENDPOINT=https://s3.<region>.backblazeb2.com   # leave out for AWS
BACKUP_S3_REGION=<region>
BACKUP_S3_ACCESS_KEY_ID=...
BACKUP_S3_SECRET_ACCESS_KEY=...
BACKUP_S3_PREFIX=myapp/
BACKUP_S3_KEEP_DAYS=0            # with a write-only key; the bucket's lifecycle rule expires old dumps
```

**Deploy** (step 13). Leave these commented out to build on the server; for
`registry` mode:

```bash
DEPLOY_IMAGE_SOURCE=registry
DEPLOY_IMAGE=ghcr.io/<your-org>/<your-repository>   # all lower case
```

Three rules for the whole file: no `$` in a value unless it is in single
quotes; no spaces around `=`; each key once (only the last one counts).

**You are done when** no line still says `your_`, `localhost` or `8888`, except
in comments and in `DATABASE_URL`. You don't need Node on the server to check
it: the next steps run the app's own check, inside the image, before anything
changes. (With the repository and Node on another machine,
`pnpm env:check .env.production` does the same; but keep the file on the server.)

## Step 16: HTTPS

nginx on the server receives every request on port 443, handles HTTPS, and
forwards to the app on `127.0.0.1:3000`. One script installs it and gets a free
Let's Encrypt certificate. DNS must already point at the server (step 2):

```bash
cd ~/nest
sudo ./nginx/bootstrap-nginx.sh --api-domain api.example.com --email you@example.com
```

It forwards to port 3000. If you set another `PORT` in step 15, add
`--api-port <that port>`.

Details, the Cloudflare proxy, and what to do when the certificate step fails:
[domain-dns-tls.md](./domain-dns-tls.md) and
[../server.md](../server.md#the-reverse-proxy-and-https).

**You are done when** `sudo nginx -t` says the configuration is OK and
`curl -I https://api.example.com` answers with a valid certificate (a 502 is
expected: the app isn't running yet).

## Step 17: Deploy

```bash
cd ~/nest
./deploy.sh
```

It pulls the branch, builds the image (or downloads it in `registry` mode),
checks `.env.production` against the new image's rules, backs up the database,
applies the migrations, starts the release, and waits until the database,
Redis and the app are healthy. The first run downloads every image, so allow
10 to 15 minutes. If anything fails, it says what, and the previous release (on
a first deploy, nothing) stays as it was. How it works and every option:
[../deploy.md](../deploy.md).

The most common first-deploy stops:

| Message | Fix |
|---|---|
| `"JWT_SECRET" still holds the template placeholder` (or another `your_` value) | Step 15: a value was not replaced |
| `DB_PASSWORD may only contain letters, digits and . _ ~ -` | Use `openssl rand -hex 24` |
| `set ALERT_WEBHOOK_URL in .env.production` | Step 10 |
| `set GRAFANA_ADMIN_PASSWORD in .env.production` | Step 4 |
| `Could not pull ghcr.io/...` | `registry` mode: CI has not published that commit yet, or the server is not logged in (step 13) |
| The app never becomes healthy | Read the app log the script prints. Usually the database password changed after Postgres was first created |

**You are done when** the script ends with `✓ Release <tag> is live`
(`./deploy.sh --list` marks it with `*`), and
`curl https://api.example.com/api/v1/health/ready` answers 200.

## Step 18: The first administrator

Sign up through the web app (or with `curl`, as in
[prepare-for-development.md](./prepare-for-development.md#step-7-sign-up-for-real)
with `API=https://api.example.com/api/v1`). Then make that account an
administrator, on the server:

```bash
cd ~/nest
docker compose --env-file .env.production -f docker-compose.prod.yaml \
  exec app node dist/src/bootstrap/user-roles.js you@example.com
```

Roles: [../auth/accounts.md](../auth/accounts.md).

**You are done when** the sign-up code arrived in your real inbox (not spam),
and the command prints a `✓` line ending in the account's new roles, `admin`
among them.

## Step 19: The uptime check

Now that the site answers, add the outside monitors: one for the API, one for
the web app, posting to your Discord channel. UptimeRobot's free plan is
enough: [uptime-check.md](./uptime-check.md#part-1-the-uptime-check).

**You are done when** the monitors show "up", and the temporary 404 monitor the
page has you create alerted in Discord.

## Step 20: The checks after the first deploy

Tick each one. The ones at the bottom are the ones people skip and regret.

**The API**

- [ ] `curl https://api.example.com/api/v1/health` lists every check as `up`
- [ ] `curl https://api.example.com/api/v1/auth/options` shows `providers` as
      you configured them
- [ ] `curl -I https://api.example.com/metrics` and
      `curl -I https://api.example.com/admin/queues` answer **403** from outside
      (nginx blocks them; reach them through an SSH tunnel)
- [ ] `https://api.example.com/api-docs` asks for the `BULL_BOARD_*` login
- [ ] `http://api.example.com` redirects to `https://`

**Sign-in, from the real web app**

- [ ] Sign up: the code arrives within a minute, from `EMAIL_FROM_ADDRESS`, not
      in spam ([email.md](./email.md))
- [ ] Sign in, then reload the page 20 minutes later: still signed in (if not,
      the cookie is not reaching the API: [../auth/operations.md](../auth/operations.md))
- [ ] Forgot password: the code arrives, the reset works
- [ ] "Continue with Google" works, if you set it up
- [ ] A profile picture uploads and shows, after a reload too

**Monitoring and alerts**

- [ ] A test alert arrives in Discord ([discord-alerts.md](./discord-alerts.md#check-it-works))
- [ ] The heartbeat check is green ([uptime-check.md](./uptime-check.md))
- [ ] The uptime monitors are green
- [ ] `docker compose --env-file .env.production -f docker-compose.prod.yaml exec app node dist/src/bootstrap/sentry-check.js`
      says the event was accepted, if you use Sentry
- [ ] Grafana opens (`ssh -L 3002:127.0.0.1:3002 ubuntu@<server-ip>`, then
      http://localhost:3002), or the dashboards show in Grafana Cloud

**Before you call it done**

- [ ] **A backup taken and restored**, not just taken: [../backups.md](../backups.md#restoring)
      (`restore.sh verify` on the newest dump), and the dump is in the off-site bucket
- [ ] **An alert from a real failure**: `docker stop redis-hexagonal-auth-prod`,
      wait for `RedisDown` in Discord, `docker start redis-hexagonal-auth-prod`
- [ ] **A rollback rehearsed** while it is calm: `./deploy.sh --rollback`, then
      `./deploy.sh` again ([../deploy.md](../deploy.md#rollback))
- [ ] Everything in step 4, plus the read-only backup key, is in the password
      manager, and someone other than you can reach it

The longer checklist, with the reasons: [../deployment-guide.md](../deployment-guide.md#the-checklist).
Operating sign-in day to day (key rotation, locked-out users):
[../auth/operations.md](../auth/operations.md).

## The web app

The React starter (`React-Starter-No-Keycloak`) deploys the same way, from its
own repository, with its own `deploy.sh` and its own `docs/deploy.md`. What
links the two:

| In the web app's `.env.production` | Value |
|---|---|
| `VITE_API_URL` | `https://api.example.com/api/v1` |
| `VITE_SENTRY_DSN` | The **web** Sentry project's DSN ([sentry.md](./sentry.md)) |

And on the server, its own nginx site: `sudo ./nginx/bootstrap-nginx.sh
--frontend-domain app.example.com --email you@example.com`, run from the web
app's folder. On the API side, `CORS_ORIGINS` and `FRONTEND_URL` must be the web
app's address (step 15), and the uptime check watches it too (step 19).
