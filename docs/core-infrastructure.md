# Core infrastructure

The shared services every module can use. They all live under
`src/shared/infrastructure/`.

- [Cache](#cache)
- [Email](#email)
- [Health checks](#health-checks)
- [Scheduled work](#scheduled-work)
- [Module dependencies](#module-dependencies)

| Module | Purpose | Documentation |
| --- | --- | --- |
| Prisma | Database access, with soft delete | [prisma-module.md](./prisma-module.md) |
| Cache | Two layers: in-process, then Redis | [cache.md](./cache.md) and below |
| Email | Transactional email via `@nestjs-modules/mailer` | Below |
| Health | Liveness, readiness and the full check | Below |
| Queue | Background jobs via BullMQ | [BULLMQ-GUIDE.md](./BULLMQ-GUIDE.md) |
| Upload | File storage and image processing | [upload-module.md](./upload-module.md) |

---

## Cache

Two layers: a small in-process map in front of Redis. A read hits memory
first, then Redis; a write goes to both. [cache.md](./cache.md) explains what
that means for correctness — in short, **anything that must be the same on
every instance has to skip the memory layer**, because one instance cannot
invalidate another's.

`CacheModule` is global, so nothing needs to import it.

```typescript
import { Inject, Injectable } from '@nestjs/common'
import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { Cache } from 'cache-manager'

@Injectable()
export class MyService {
    constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

    async getCachedData(key: string) {
        const cached = await this.cache.get(key)
        if (cached) return cached

        const data = await this.fetchData()
        await this.cache.set(key, data, 60_000) // TTL in milliseconds
        return data
    }

    async invalidate(key: string) {
        await this.cache.del(key)
    }
}
```

For the cases that need Redis itself — an atomic counter, a Lua script, a real
`PING` — inject the client instead. `CacheModule` exports it:

```typescript
import { REDIS_CLIENT } from '@/shared/infrastructure/cache'
import { RedisClientType } from 'redis'

constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {}
```

### Configuration

```bash
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=          # required in production
CACHE_TTL=3600           # seconds
```

### What uses it

Almost everything here uses Redis directly through `REDIS_CLIENT`, not the
two-layer cache, because it must be the same on every instance:

- The **session check's cache** (`auth:session:<id>`, `auth:user:<id>`): the
  session and user behind a token, so every request does not hit the
  database. At most 5 minutes, invalidated at once on sign-out, password
  change or deletion ([cache.md](./cache.md)).
- The **auth module's own state**: a replaced refresh token's successor for the
  10-second grace window (`auth:replaced:*`) and a Google sign-in in progress
  (`auth:oauth:*`, 10 minutes).
- The **sign-in rate limits** (`rl:*`, `src/shared/infrastructure/rate-limit/`)
  and the **global throttler's** counters (`src/shared/infrastructure/throttler/`).
- **Idempotency** claims and stored responses.
- **BullMQ** queues and schedules (`bull:*`), on the same Redis.

---

## Email

Transactional email over plain SMTP, with `@nestjs-modules/mailer` and
Handlebars templates.

**Shared delivers; each module writes its own.** `EmailService`
(`src/shared/infrastructure/email/`) holds the SMTP connection and sends the
template it is given. It knows nothing of what any email says. A module keeps
its templates, subjects and contexts beside its own code: auth's are in
`src/modules/auth/infrastructure/email/` (`AuthEmails`, and `templates/`).
A new module's emails never mean editing shared code.

**Send from a queue, not from the request.** The auth module never sends an
email inside a request: it queues a job on the `auth` queue, and
`AuthJobsConsumer` sends it through `AuthEmails`, with retries
([BULLMQ-GUIDE.md](./BULLMQ-GUIDE.md#emails-are-jobs-too-with-their-own-rules)).
A slow or failing SMTP server then cannot slow down, fail, or reveal anything
through, a sign-up. Do the same for your own emails.

### A module's emails

The layout auth uses, here for an `orders` module:

```
src/modules/orders/infrastructure/email/
├── order-emails.ts        subjects, templates, what each template is given
└── templates/
    └── receipt.hbs
```

```typescript
import * as path from 'path'
import { Injectable } from '@nestjs/common'
import { EmailService } from '@/shared/infrastructure/email/email.service'

/** Beside this file: in src/ under tests, in dist/ when compiled. */
const template = (name: string) => path.join(__dirname, 'templates', name)

@Injectable()
export class OrderEmails {
    constructor(private readonly email: EmailService) {}

    async sendReceipt(to: string, orderNumber: string, total: string): Promise<void> {
        await this.email.send(to, `Your receipt for order ${orderNumber}`, template('receipt'), { orderNumber, total })
    }
}
```

Then import `EmailModule` in the module and add `OrderEmails` to its
providers. Nothing to add to `nest-cli.json`: its asset rule copies
`src/modules/*/infrastructure/email/templates/` for every module.

- **Strict mode is on**: a placeholder the template uses and the context does
  not give fails the send, instead of leaving a gap in the email.
- **Links** are built from `FRONTEND_URL` (`app.frontendUrl`);
  `SUPPORT_EMAIL` (`app.supportEmail`) is named where only a person can help.

### Auth's emails

Auth has one layout, `src/modules/auth/infrastructure/email/templates/email.hbs`,
for every email, and keeps the words apart in `email-copy.ts`, once per
language (`vi` and `en`, D-132). `AuthEmails` picks an email's words in the
language asked for and sends them in the layout.
[auth/emails.md](./auth/emails.md) says which emails there are, when each is
sent, and how to edit them.

| Email | Purpose |
| --- | --- |
| Sign-in code | The code that signs in to the address's account |
| Create-account code | The code that creates an account for an address with none |
| Reset code | The code that resets a password (worded "choose a password" for an account without one) |
| Password changed | The password was changed or reset |
| Password added | A password was added to an account that had none |
| Sign-in method added | Google sign-in was linked to the account |
| Account deleted | The account was deleted, and when its data goes |

### Configuration

```bash
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_SECURE=false           # true for port 465
EMAIL_USER=your-user
EMAIL_PASSWORD=your-password
EMAIL_FROM_NAME=YourAppName
EMAIL_FROM_ADDRESS=noreply@example.com
```

Nothing here names a particular provider: any SMTP service works by changing
these values ([setup/email.md](./setup/email.md) walks through Brevo, Resend,
Amazon SES and others). In development, `docker-compose.dev.yaml` sends every
email to **Mailpit** (`http://localhost:8025`) whatever these say. It accepts
any credentials and shows every message in a web UI, so mail can be built and
tested without an account anywhere. `EMAIL_HOST` is required in production. See
[environment.md](./environment.md#email).

---

## Health checks

Three probes, cheapest first. All of them are public, excluded from request
metrics and excluded from the success log, because they are asked constantly.

| Endpoint | Checks | Who asks |
| --- | --- | --- |
| `GET /api/v1/health/live` | Nothing but "the process is serving HTTP" | Docker's healthcheck |
| `GET /api/v1/health/ready` | Database and Redis answer | A load balancer, and `deploy.sh` before promoting a release |
| `GET /api/v1/health` | Everything, plus memory and disk | Humans and alerts |

**Why `live` checks nothing else.** A database outage does not get better by
restarting the container, and a liveness probe that fails during one turns a
degraded service into a restart loop.

**Why `deploy.sh` waits on `ready`, not `live`.** It used to wait on `live`,
and so a release that could not reach its database answered "healthy", was
promoted, and was never rolled back.

### Response

`/health` and `/health/ready` return Terminus' shape inside the standard
envelope, and **503** when a check fails:

```json
{
    "meta": { "message": "Success", "...": "..." },
    "data": {
        "status": "ok",
        "info": {
            "database": { "status": "up" },
            "redis": { "status": "up" }
        },
        "error": {},
        "details": { "...": "..." }
    }
}
```

In production the failure text is replaced with a generic message: a failing
check would otherwise print connection strings and internal hostnames to
anyone who asked.

### Indicators

| Indicator | What it does | Fails when |
| --- | --- | --- |
| `database` | Prisma `SELECT 1` | The query throws |
| `redis` | `PING` on the Redis client | Not `PONG`, or it throws |
| `rate_limiter` | The throttler's storage answers | It throws |
| `memory_heap` | Heap used | Over 150 MB |
| `memory_rss` | Resident set size | Over 300 MB |
| `storage` | Disk on the app's working directory | More than 90% used |

The Redis check pings the client directly rather than writing through the
cache. Through `CACHE_MANAGER` the in-process layer answers its own read, so
the check passed with Redis completely down.

### Adding one

Follow the two already in `src/health/health.controller.ts`:

```typescript
import { Injectable } from '@nestjs/common'
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus'
import { failureDetail } from './failure-detail'

@Injectable()
export class ExternalApiHealthIndicator extends HealthIndicator {
    async pingCheck(key: string): Promise<HealthIndicatorResult> {
        try {
            await fetch('https://api.example.com/health')
            return this.getStatus(key, true)
        } catch (error) {
            // Not error.message: in production that text would be returned
            // to whoever asked, connection string and all.
            return this.getStatus(key, false, failureDetail(error))
        }
    }
}
```

Then add it to the list in `src/health/health.controller.ts` — to `/health`
for something worth alerting on, and to `/health/ready` only if the app truly
cannot serve requests without it. Everything in `ready` is something that will
block a deploy.

---

## Scheduled work

There is no `@nestjs/schedule` and no `@Cron` here, deliberately. An
in-process cron fires on **every** instance, so the moment the app runs twice
the job runs twice.

Recurring work is a **BullMQ job scheduler** instead: the schedule lives in
Redis, so each tick is one job, handled by one instance, however many are
running.

Every one is a line in `src/maintenance/maintenance-tasks.ts`: its id, how
often, and the command that does the work. The command is its module's own,
exported from the module's `index.ts`; the list only says when.

```typescript
// src/maintenance/maintenance-tasks.ts
{
    id: 'expire-unpaid-orders',
    everyMs: 10 * MINUTE_MS,
    command: (now) => new ExpireUnpaidOrdersCommand(now)
}
```

`MaintenanceConsumer` (`src/maintenance/`) schedules each at boot (an upsert:
every instance does it, and it stays one schedule) and sends a tick's command
on the command bus. They share the `maintenance` queue, and only they use it,
so a backlog of emails or file deletions never delays them. A task taken off
the list, or renamed, has its old schedule removed from Redis at the next
start.

Two ship with the starter. The deleted-accounts sweep (users'
`SweepDeletedAccountsCommand`), every 15 minutes, erases the personal data of
long-deleted accounts and deletes accounts nobody confirmed
([account-deletion.md](./account-deletion.md)). The auth clean-up (auth's
`CleanUpAuthCommand`), every hour, removes sessions that ended more than a week ago and codes more
than a day old, and finishes what a lost `AccountDeletedEvent` left behind:
the sessions, passwords and Google links of deleted accounts
([auth/accounts.md](./auth/accounts.md)).

Whatever you schedule, make it **safe to run twice**. A retry, an overlapping
tick or a second instance starting mid-run must not do damage.

---

## Module dependencies

```
AppModule
├── ConfigModule (global)
├── ThrottlerModule ───────────► Redis (the global per-IP limit)
├── LoggerModule (nestjs-pino)
├── PrismaModule (global) ─────► PostgreSQL
├── CacheModule (global) ──────► Redis (also provides REDIS_CLIENT and RateLimiter)
├── BullModule ────────────────► Redis (the queues)
├── PrometheusModule ──────────► /metrics
├── QueueObservabilityModule ──► queue metrics and failure reports
├── CqrsObservabilityModule
├── EmailModule ───────────────► SMTP
├── UploadModule ──────────────► local disk or S3
├── HealthModule
├── UsersModule
│   ├── UploadModule
│   └── queues: file-cleanup, maintenance
└── AuthModule
    ├── UsersModule (USER_DIRECTORY: the only way auth reaches user records)
    ├── EmailModule
    ├── queue: auth
    └── ──► Google (OpenID Connect discovery and token exchange), when GOOGLE_* is set
```

`AccessTokenGuard`, the global authentication guard, is built by `AuthModule`
and registered in `AppModule` after the throttler.

The outbound calls to know about: **SMTP** (every email, from the queue) and
**Google** (`accounts.google.com` discovery on the first sign-in, then the
token exchange, 10-second timeout). If Google cannot be reached, its sign-in
fails and the others keep working.

Everything here is stateless and injectable: the state lives in Postgres and
Redis, which is what makes a second instance possible.
