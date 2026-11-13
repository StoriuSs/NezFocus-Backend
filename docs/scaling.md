# Growing out of one server

The starter runs everything on one machine: the API, Postgres, Redis, the
monitoring stack. That is the right shape for almost every
project, for far longer than people expect. This page is about the order in
which to change it when it stops being right — and about not doing any of it
early.

- [First, don't](#first-dont)
- [Then, a bigger server](#then-a-bigger-server)
- [Moving services off the box](#moving-services-off-the-box)
- [Running more than one app instance](#running-more-than-one-app-instance)
- [Things that do not get better with more instances](#things-that-do-not-get-better-with-more-instances)
- [A checklist](#a-checklist)

## First, don't

Distributing a system multiplies the number of things that can be broken, and
every one of them has to be understood by whoever is on call. Before you add a
machine, be sure you need one.

**Measure.** [load-testing.md](./load-testing.md) turns "it feels slow" into a
number, and usually into a surprise: a single modest server serves more
requests per second than most applications ever see. Find the actual ceiling
before you design around an imagined one.

**Then look at where the time goes.** The [API
dashboard](./monitoring.md) shows response times as the app measures them; the
Postgres dashboard shows connections and slow queries. The overwhelming
majority of "we need to scale" turns out to be one missing index, one query
inside a loop, or one cache that is not being used. All three are cheaper to
fix than a second server, and none of them get better when you add one.

## Then, a bigger server

If you genuinely need more, the next step is a **bigger box**, not more boxes.
Doubling the RAM and CPU is a reboot. Going from one server to two is a change
to how the system works, and you cannot undo it in an afternoon.

You are out of road for vertical scaling when one of these is true:

- The largest instance your provider sells is not enough. (This is rare, and
  they are very large.)
- You need to survive the loss of the machine. **This is the honest reason
  most people should move on**, and it is about availability, not speed.
- Deploys cannot take the few seconds of downtime that restarting the
  container costs.

## Moving services off the box

Do this before running a second app instance — a second instance sharing the
first one's database container is not a second instance, it is the same single
point of failure with extra steps.

They are listed in the order that pays off.

### 1. Postgres

The database is what you cannot rebuild from git. Moving it to a managed
service buys automated backups, point-in-time recovery, and someone else's
pager for the upgrades.

```bash
# .env.production
DATABASE_URL=postgresql://user:password@db.example.com:5432/appdb?schema=public&sslmode=require

# The backup service targets the same server, so the off-provider copy keeps
# working. Needed because the container no longer runs beside it:
BACKUP_DB_HOST=db.example.com
BACKUP_DB_PORT=5432
BACKUP_DB_USER=backup_user
BACKUP_DB_PASSWORD=...
BACKUP_DB_SSLMODE=require
# A database that always exists, for the connection that lists the others.
# DigitalOcean calls it defaultdb; AWS and most others use postgres.
BACKUP_MAINTENANCE_DB=defaultdb
# pg_dump must be at least the server's major version.
BACKUP_POSTGRES_IMAGE=postgres:16.2-alpine
```

Then stop running the container: remove the `db` service from
`docker-compose.prod.yaml`, along with the `depends_on: db` entries.

Keep backing up **even with a managed database**. Your provider's backups live
in your provider's account, and the failure you most want to survive is losing
access to that account. See [backups.md](./backups.md).

### 2. Uploads

With `STORAGE_TYPE=local`, avatars live on the server's disk. Two app
instances would each have half the files, and a rebuilt server would have
none.

```bash
STORAGE_TYPE=s3
AWS_REGION=auto
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET=my-app-uploads
# For Cloudflare R2, DigitalOcean Spaces, Backblaze B2 — anything that is not
# AWS itself. Setting this turns on path-style addressing, which they need.
AWS_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
```

R2 is the usual choice because it charges nothing for bandwidth out, which for
images is most of the bill.

**Copy the existing files across first.** The application does not migrate
them, and every `avatar_url` already in the database points at a key it expects
to find. `rclone sync ./uploads r2:my-app-uploads` before you switch, and
check one image loads afterwards.

Keep the bucket **private**. The code already signs read URLs
([file-uploads-and-s3.md](./file-uploads-and-s3.md)); a public bucket is one
misconfigured object away from being a file host for someone else.

### 3. Monitoring

Prometheus, Grafana, Loki, Alertmanager and the exporters are several hundred
megabytes of RAM on the very box whose health they exist to report — and if it
dies, so do they.

```bash
MONITORING=grafana-cloud
```

Only Alloy keeps running locally, shipping metrics and logs out. Dashboards
and alert rules are uploaded with `pnpm monitoring:cloud-sync`, and `deploy.sh`
re-syncs after a successful deploy. The free tier is generous enough for a
small application. [monitoring.md](./monitoring.md) has the setup.

This is worth doing early — long before you need to scale — simply to get the
RAM back and to keep your alerting alive when the server is not.

### 4. Redis

Only once you run **more than one app instance**. Until then a local Redis is
faster and simpler. Losing it for a while is survivable: the cache refills,
the per-request session check falls back to Postgres, and the global
throttler fails open. But losing its **data** loses real things:

- queued emails, including sign-up and password-reset codes not yet sent
  (the person asks for a new one);
- Google sign-ins in progress (their state lives in Redis for a few
  minutes; the person clicks "Continue with Google" again);
- the auth rate-limit counters, so a password-guessing run starts from zero;
- scheduled jobs (they are registered again at the next start).

None of these is permanent damage, which is why a local Redis is fine on one
server. While Redis is down, though, the sign-in limits fail closed (D-137):
nobody can sign in, ask for a code or change a password until it is back. See
[rate-limit.md](./rate-limit.md#sign-in-routes-two-layers-of-limits).

```bash
REDIS_HOST=redis.example.com
REDIS_PORT=6379
REDIS_PASSWORD=...
```

**One thing to know first:** the connection is built as
`redis://...` in `src/shared/infrastructure/cache/cache.module.ts` and
`redis-client.provider.ts`. Managed Redis usually requires TLS (`rediss://`),
so plan on a small change in both places. It is a two-line change, but it is
not a configuration change.

Queue jobs live in Redis, so unlike the cache, **this one is not disposable**.
Pick a managed plan with persistence.

## Running more than one app instance

Everything above has to be done first. Then:

**The application is already stateless**, and deliberately so:

- No sticky sessions. A signed-in user's session is a row in Postgres
  (`Session`, with its `RefreshToken` rows), not memory in one instance. Every
  request carries a short-lived access token (a JWT), and every instance
  checks that its session is still live, through a Redis cache with Postgres
  behind it ([sessions-and-tokens.md](./auth/sessions-and-tokens.md)). So any
  instance can serve any request, and a sign-out on one takes effect on all.
- Sockets need none either: they are websocket only, no long-polling
  (`src/shared/infrastructure/websocket/redis-io-adapter.ts`), so each stays
  on the instance it opened on, and the socket.io Redis adapter carries an
  event emitted on one instance to the sockets of every other.
- The scheduled jobs are **BullMQ job schedulers**, held in Redis, so each
  tick runs once no matter how many instances are up: the deleted-account
  sweep and the hourly `auth-clean-up` (ended sessions, old codes), both on
  the `maintenance` queue. An in-process `@Cron` would have
  fired on every instance — which is why there isn't one.
- The rate limiter counts in Redis, so the limit is the limit across all
  instances rather than the limit times N.
- The auth caches (the user and the session) are Redis-only, never the
  in-process layer, because one instance cannot invalidate another's memory. **Anything you add to the cache
  has to follow that rule**, or a deleted user keeps working on the instances
  that did not get the message ([cache.md](./cache.md)).

**Run migrations once, separately.** Two instances starting together and both
running `prisma migrate deploy` is a race with a real chance of a failed
deploy. `deploy.sh` already does the right thing — it migrates once, before
starting the app, and starts the app with `RUN_MIGRATIONS=false`. With several
servers, that step becomes a one-shot job run from one place:

```bash
docker run --rm --env-file .env.production <your-image> \
    ./node_modules/.bin/prisma migrate deploy
```

(The image's own start command runs exactly this unless `RUN_MIGRATIONS=false`,
so the one-shot job and the container agree on what "migrate" means.)

Then roll the instances.

**Watch the connection count.** Each instance opens up to `DB_POOL_MAX`
connections (10 by default), and Postgres in the compose file allows 100 in
total. Ten instances would exhaust it, and the error when you do is a confusing
one — new connections are simply refused.

```
instances × DB_POOL_MAX  +  headroom  ≤  max_connections
```

The headroom is for everything else that connects: the backup job, the
Postgres exporter, a `psql` session of your own.

Past roughly six instances, put **pgbouncer** in front in transaction pooling
mode, and set `pgbouncer=true` on the `DATABASE_URL` so Prisma stops using
prepared statements, which transaction pooling cannot keep.

**Load balancing.** Your provider's load balancer, or nginx on a small box in
front. Health-check `/api/v1/health/ready`, not `/health/live`: `ready` is the
one that answers only when the database and Redis do, which is what decides
whether an instance should be sent traffic.

**Separate workers, eventually.** Queue consumers run inside the API process,
so a burst of background work competes with requests. Splitting them means a
second entry point that starts the app with the HTTP server off, and
scaling the two independently. That is a real change to `src/main.ts` and not
something the starter ships — but the queues, the job options and the
consumers are all already in place for it.

## Things that do not get better with more instances

- **Image processing** is capped per instance
  (`IMAGE_PROCESSING_CONCURRENCY`, default 2). More instances do mean more
  total throughput, but a single upload is never faster, and the cap exists
  because each concurrent resize holds a decoded image in memory.
- **A slow query** is slow on every instance at once, and now it is slow on
  more connections to the same database.
- **Postgres writes** all go to one primary. Read replicas help reads;
  nothing about adding app instances helps writes.
- **Signing in** is deliberately expensive: each password check is an argon2
  hash, about 19 MiB of memory and tens of milliseconds of CPU, on purpose.
  Measure it separately from the rest of the traffic
  ([load-testing.md](./load-testing.md)). Nothing else about sessions stops
  you adding instances: their state is in Postgres and Redis.

## A checklist

Before the second instance:

- [ ] Postgres is managed, or at least on its own machine
- [ ] Backups run against it, and a restore has been tried
- [ ] `STORAGE_TYPE=s3`, and the existing uploads have been copied over
- [ ] Redis is shared and persistent
- [ ] Migrations run once, from one place, not from the app's start-up
- [ ] `instances × DB_POOL_MAX` still fits in `max_connections`
- [ ] The load balancer health-checks `/api/v1/health/ready`
- [ ] Nothing you added caches shared state in the in-process layer
- [ ] Every instance has the **same** `JWT_SECRET`. A token signed by one
  instance must verify on the others; otherwise users are signed out,
  depending on which instance answers
- [ ] Every instance has the same `BASE_URL`: it is the access token's issuer
  and audience, so a different one means "invalid token"
- [ ] Google's authorized redirect URI is the shared public address
  (`https://api.example.com/api/v1/auth/google/callback`), not one instance's
  ([setup/google-sign-in.md](./setup/google-sign-in.md))
- [ ] The API is reached under one domain through the load balancer, so the
  `refresh_token` cookie (path `/api/v1/auth`) and its `SameSite` setting
  still work; a different domain per instance would need new cookie settings
  ([sessions-and-tokens.md](./auth/sessions-and-tokens.md))
- [ ] `trust proxy` counts the load balancer as a hop. The per-IP sign-in
  limits read `req.ip`; with the wrong hop count every user looks like the
  load balancer's IP and shares one limit
  ([rate-limit.md](./rate-limit.md#behind-nginx-and-cloudflare))
- [ ] You have measured, and know which number you are trying to improve

## Related

- [load-testing.md](./load-testing.md) — find the ceiling before redesigning for it
- [monitoring.md](./monitoring.md) — where the time actually goes
- [backups.md](./backups.md) — including against a managed database
- [cache.md](./cache.md) — why the two layers are not interchangeable
- [deploy.md](./deploy.md) — migrations, releases and rollback
