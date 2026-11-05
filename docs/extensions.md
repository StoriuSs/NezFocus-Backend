# Extensions

Things this starter deliberately does **not** include, each of which some
projects genuinely need. For each one: what it is, the sign that you have
reached the point of needing it, and how it would fit here.

None of this is in the repository. That is the point — a starter that ships
every feature anyone might want is not a starter. Add them when the sign
appears, not before.

- [Audit log](#audit-log)
- [Feature flags](#feature-flags)
- [Distributed tracing](#distributed-tracing)
- [Circuit breaker](#circuit-breaker)
- [Transactional outbox](#transactional-outbox)
- [Server-sent events and websockets](#server-sent-events-and-websockets)
- [Already built, elsewhere](#already-built-elsewhere)

## Audit log

**What it is.** An append-only record of who did what: "user 14 changed the
email on account 9 at 14:02 from this IP". Distinct from application logs,
which are for debugging and get deleted after a fortnight. An audit log is a
business record, is kept for years, and is never edited.

**The sign you need it.** Somebody asks "who changed this?" and you cannot
answer. Or a customer, an auditor or a regulation asks — SOC 2, HIPAA and
GDPR all effectively require one for anything touching personal data.

**How it fits.** A table, not a log file: a log you can grep is a log someone
can also delete.

- A `prisma/models/audit-log.prisma` model: actor, action, subject type and
  id, a JSON diff, IP, request id, timestamp.
- Write it in the **command handler**, in the same transaction as the change.
  Outside the transaction, a crash leaves the change without its record.
- An `AuditPort` in the domain, a Prisma adapter in infrastructure — the same
  shape as every other port here, so the domain stays unaware of the database.
- Revoke `UPDATE` and `DELETE` on the table from the application's database
  user. That is what makes it an audit log rather than a table.

**The trap.** Recording everything. Ten million rows of "user viewed page"
bury the twenty rows that matter. Log decisions and changes, not traffic.

**What already exists.** Not an audit log, but two pieces of one, both from
the auth module:

- **Counts.** `auth_events_total{event}` counts sign-ins (succeeded, failed,
  rate-limited), refresh-token reuse, password changes, deletions and more.
  The API dashboard's "Sign-in and accounts" row graphs it, and two alerts
  use it. It says how many, not who
  ([monitoring.md](./monitoring.md#auth-metrics)).
- **The owner is told.** Every security change emails the account's owner:
  password changed or added, a sign-in method added, account deleted (the
  `AUTH_JOBS` in
  [`auth-email-jobs.ts`](../src/modules/auth/infrastructure/email/auth-email-jobs.ts);
  see [emails.md](./auth/emails.md)). That lets a person notice a change they
  did not make, but nothing keeps the record.

There is no audit table. Add one as above when "who did this, and when?"
needs an answer months later.

## Feature flags

**What it is.** Turning a feature on and off without deploying, and turning it
on for some users before everyone.

**The sign you need it.** You are holding a branch open because the feature is
not ready to be seen, or you want a beta group, or you want a kill switch for
something risky. If you deploy a handful of times a day and features are small,
you do not need this yet.

**How it fits.**

- *Simplest*: a `feature_flags` table and a `FeatureFlagService` reading it
  through the cache. Enough for on/off and for a list of allowed user ids.
  Nothing to buy, nothing new to run.
- *Environment variables*: fine for a permanent toggle (`STORAGE_TYPE` is one
  already) and wrong for anything you want to change without a deploy.
- *A service* (Unleash, PostHog, Flagsmith, LaunchDarkly): percentage
  rollouts, targeting rules, a UI for people who do not deploy. Unleash is
  self-hostable and free.

**The trap.** Flags that never get removed. Each one doubles the number of
states the system can be in, and four old flags mean sixteen combinations
nobody tests. Delete the flag with the same PR that makes the feature
permanent.

## Distributed tracing

**What it is.** Following one request across every service it touches, with a
timeline: 4ms in the API, 190ms waiting for the database, 12ms in storage.
Logs tell you what happened; a trace tells you where the time went.

**The sign you need it.** More than one service, and a "why is this endpoint
slow" question that the [monitoring dashboards](./monitoring.md) cannot answer
because the time is disappearing between services rather than inside one.

**How it fits.** With a single API, most of the benefit is already here:
`request_id` ties every log line of one request together, metrics give per-route
timings, and [Sentry's performance tracing](./error-tracking.md) — already
wired — gives per-request spans without adding anything to run.

For full OpenTelemetry:

- `@opentelemetry/sdk-node` with the HTTP, Express and Prisma instrumentations,
  started in `src/bootstrap/` **before** the Nest application, the same way
  `instrument.ts` starts Sentry and for the same reason: instrumentation has to
  patch the libraries before they are imported.
- Export to Grafana Tempo (which pairs with the Loki and Prometheus already
  here), or to Jaeger, or to Grafana Cloud, which takes traces on the free tier.
- Sample. Tracing every request in production is a large bill and a large
  amount of data nobody reads; 1–10% plus every error is the usual setting.

## Circuit breaker

**What it is.** After a dependency has failed several times in a row, stop
calling it for a while and fail immediately instead. When it is broken,
waiting 30 seconds for a timeout on every request is worse than answering
"unavailable" in a millisecond — that queue of waiting requests is how one
broken dependency takes down everything else.

**The sign you need it.** An outbound call you do not control: a payment
provider, a third-party API, another team's service. Not the database — if
Postgres is down there is nothing to fall back to, and the app should say so
through `/health/ready` and let the load balancer take it out.

**How it fits.** [opossum](https://github.com/nodeshift/opossum) wraps a
function:

```typescript
const breaker = new CircuitBreaker(callTheProvider, {
    timeout: 3000,          // longer than this counts as a failure
    errorThresholdPercentage: 50,
    resetTimeout: 30000     // then try one request to see if it recovered
})
breaker.fallback(() => ({ status: 'unavailable' }))
```

Put it in the **infrastructure adapter** for that dependency, so the
application layer keeps calling a port and knows nothing about breakers.
Export the breaker's state as a Prometheus gauge and alert on it — an open
breaker is exactly the sort of thing you want to hear about.

The timeouts on outbound calls that the starter already sets are the cheaper
half of this idea, and often enough on their own:

| Outbound call | Timeout | When it fails |
|---|---|---|
| S3 / R2 (uploads) | 5 s to connect, 30 s per request ([`s3-storage.service.ts`](../src/shared/infrastructure/storage/services/s3-storage.service.ts)) | the upload fails; the user retries |
| SMTP (emails, from the `auth` queue) | 10 s to connect and greet, 30 s idle ([`email.module.ts`](../src/shared/infrastructure/email/email.module.ts)) | the job retries 3 times, then gives up ([error-tracking.md](./error-tracking.md#what-is-reported)) |
| Google sign-in (OpenID Connect discovery and the code exchange) | 10 s ([`openid-connect-provider.adapter.ts`](../src/modules/auth/infrastructure/adapters/openid-connect-provider.adapter.ts)) | the browser comes back to the web app with `?error=` |

Google is exactly the "outbound call you do not control" above. If it has
long outages in practice, its adapter is where a breaker would go.

## Transactional outbox

**What it is.** A way to make "save this, then tell the world" atomic. The
event is written into an `outbox` table **in the same transaction** as the
change; a separate process reads that table and publishes.

**The sign you need it.** A missed event has real consequences and the
current best-effort approach is no longer acceptable — an order that was paid
for and never reached fulfilment, for instance.

**Where the starter stands.** A user deletes their account with
`POST /auth/account/delete`. The auth module checks their proof
([`delete-own-account.handler.ts`](../src/modules/auth/application/commands/delete-own-account/delete-own-account.handler.ts)),
then sends the users module's `DeleteAccountCommand`. Its handler
([`delete-account.handler.ts`](../src/modules/users/application/commands/delete-account/delete-account.handler.ts))
commits the soft delete and *then* publishes `AccountDeletedEvent`. A crash in
between loses the event. The system is built to tolerate that: the guard and
refresh read the user on every request and refuse a deleted one, whether or
not the sessions were ended; the hourly auth clean-up ends any session and
deletes any password or Google link a deleted account still has; and the maintenance
sweep erases the personal data on its own schedule, from the row, not the
event ([account-deletion.md](./account-deletion.md)). **Designing the reads
so a lost event does no harm is the poor man's outbox**, and for most
applications it is the better trade — much less machinery.

One gap it leaves: an avatar whose cleanup event was lost stays in storage.
The sweep clears the key from the row, but not the file.

**How it fits, if you need the real thing.**

- An `outbox` table: event type, payload, `createdAt`, `publishedAt`.
- Handlers write to it inside the transaction instead of publishing.
- A BullMQ job polls for unpublished rows, publishes, marks them.
- Consumers must be **idempotent**, because this guarantees at-least-once
  delivery, not exactly-once. There is no exactly-once.

## Server-sent events and websockets

**What it is.** The server pushing to the browser instead of waiting to be
asked. SSE is one-way and is plain HTTP; websockets are two-way and a separate
protocol.

**The sign you need it.** Something must update without the user acting:
notifications, a live feed, presence, collaborative editing. If polling every
30 seconds would do, poll — it is enormously simpler and it survives every
proxy in the world.

**How it fits.**

- **SSE** is a Nest controller returning an `Observable<MessageEvent>` with
  `@Sse()`. Watch two things: nginx must not buffer the response
  (`proxy_buffering off` on that location), and the
  [TimeoutInterceptor](./common-utilities.md#interceptors) will cut the stream
  off — exclude the route.
- **Websockets** need `@nestjs/websockets` and a gateway. With more than one
  app instance they also need a Redis adapter, because a message must reach
  the client whichever instance holds their socket.
- Either way, **authenticate the connection**. The browser's `EventSource`
  cannot send an `Authorization` header, which is why people end up putting a
  token in the query string, where it lands in every access log. Use a
  short-lived ticket the client fetches first and spends on connecting.
- Long-lived connections change the shape of the server: a thousand idle
  sockets is a thousand things to keep open through deploys, load balancer
  timeouts and scaling events.

## Already built, elsewhere

Three items that were on this list and are now in the repository:

| | Where |
| --- | --- |
| **Runtime configuration for the frontend** — one image for every environment, settings read at container start rather than baked in at build | The React starter's `nginx/40-runtime-config.sh`, and its `docs/environment.md` |
| **Load testing** — k6 scripts and a guide | [load-testing.md](./load-testing.md) |
| **Migrations as a one-shot job** — already how `deploy.sh` works on one server; the multi-server version is written up | [scaling.md](./scaling.md#running-more-than-one-app-instance) |

## Related

- [hexagonal-architecture.md](./hexagonal-architecture.md) — where a new port and adapter go
- [BULLMQ-GUIDE.md](./BULLMQ-GUIDE.md) — the queue several of these build on
- [scaling.md](./scaling.md) — the other kind of growing
