# Error tracking

When the app fails in a way nobody expected (a 500, a crash, a background job
that gave up), the error goes to [Sentry](https://sentry.io) as well as to the
logs. Sentry groups identical errors into one **issue**, and shows how often it
happened, since when, which release introduced it, and the stack trace with the
request that caused it.

It is **off unless `SENTRY_DSN` is set.** With no DSN, the SDK never starts and
the app sends nothing anywhere. Remove or comment out the line to turn it off
again.

- [What it adds to logs and alerts](#what-it-adds-to-logs-and-alerts)
- [Setting it up](#setting-it-up)
- [What is reported](#what-is-reported)
- [What is sent, and what is not](#what-is-sent-and-what-is-not)
- [From an issue to its log line](#from-an-issue-to-its-log-line)
- [Notifications](#notifications)
- [Reporting from your own code](#reporting-from-your-own-code)
- [Tracing](#tracing)
- [GlitchTip instead of Sentry](#glitchtip-instead-of-sentry)
- [Troubleshooting](#troubleshooting)

## What it adds to logs and alerts

|                             | Logs (Loki)                 | Alerts (Alertmanager)          | Error tracking (Sentry)                       |
| --------------------------- | --------------------------- | ------------------------------ | --------------------------------------------- |
| Answers                     | What happened, line by line | Is something broken right now? | Which distinct bugs exist, and which are new? |
| The same error 300 times    | 300 lines                   | One `AppErrorLogs` alert       | One issue, with a count and first/last seen   |
| Which deploy caused it      | —                           | —                              | The release it first appeared in              |
| A fixed bug that comes back | —                           | —                              | The resolved issue reopens ("regression")     |
| Every occurrence, exactly   | Yes                         | —                              | No: capped per error (see below)              |

Logs stay the record of everything. Sentry is where you go to decide what to fix.

## Setting it up

The Sentry side (account, region, a project for the API and one for the web
app, where to find the DSN, the source-map token for CI, email alerts) is
click by click in [setup/sentry.md](./setup/sentry.md). On the app's side:

1. Create the API's Sentry project ([setup/sentry.md](./setup/sentry.md#2-two-projects-the-api-and-the-web-app)).
   The free Developer plan allows 5,000 errors a month and one user.
2. Put its DSN in the env file:

    ```bash
    SENTRY_DSN=https://<key>@o<org>.ingest.us.sentry.io/<project>
    ```

    A DSN only allows sending events to that project, not reading anything.
    It is still kept out of git with the rest of the env file.

3. Check that Sentry accepts events:

    ```bash
    pnpm sentry:check                        # uses .env.development
    ```

    It sends one test error, `Test error from pnpm sentry:check`, and says
    whether Sentry accepted it, or why not (DSN refused, quota used up, host
    unreachable).

4. Restart the app. In Docker: `pnpm docker:dev` again, or for production:

    ```bash
    ./deploy.sh
    # then, on the server:
    docker compose --env-file .env.production -f docker-compose.prod.yaml \
      exec app node dist/src/bootstrap/sentry-check.js
    ```

Each environment reports under its `NODE_ENV` (`development`, `production`),
so development errors and production errors are separate in Sentry's
environment filter. A dedicated project per environment works too: use a
different DSN in each env file.

**Releases.** In production, `docker-compose.prod.yaml` sets `SENTRY_RELEASE`
to the release deploy.sh is deploying (the first 12 characters of the
commit). Every issue then shows the release it first appeared in, and a
resolved issue that comes back in a later release reopens. Outside deploy.sh
no release is set.

**Turning it off:** delete or comment out `SENTRY_DSN` (or leave it empty),
and restart the app.

## What is reported

| Reported                                                         | From                    |
| ---------------------------------------------------------------- | ----------------------- |
| A request that failed with 500, or any other 5xx except 503      | `GlobalExceptionFilter` |
| A crash: an uncaught exception or an unhandled promise rejection | The SDK                 |
| A background job that failed for good (every retry used up)      | `QueueFailureReporter`  |
| A CQRS event handler that threw (the request already succeeded)  | `CqrsFailureReporter`   |
| A refresh token used twice (reuse detected), on purpose          | `PrometheusAuthEvents`  |

The last row is not a bug. A refresh token is single-use: when one comes back
after it was already replaced, someone may have copied it, so the app ends
that session and reports it, tagged `auth: refresh-reuse`, with the user id
and the session id. The `AuthRefreshTokenReuse` alert fires on the same event
(see [alerts.md](./alerts.md)). `RefreshHandler` records the event with the
user and session; the auth events adapter,
[`prometheus-auth-events.adapter.ts`](../src/modules/auth/infrastructure/adapters/prometheus-auth-events.adapter.ts),
counts it and reports it, as it would any event it lists as an incident;
[sessions-and-tokens.md](./auth/sessions-and-tokens.md) explains reuse
detection.

| Not reported                         | Why                                                                                                                                                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any 4xx (validation, 401, 404, 429…) | The client's mistake, not a bug. They are in the logs at `warn`.                                                                                                                                |
| 503                                  | The app answers it on purpose: a dependency is down (health check), it is at capacity (image processing), Turnstile cannot be asked (`AUTH_CAPTCHA_UNAVAILABLE`), or a two-step secret was sealed with a key this server lacks (`AUTH_TWO_FACTOR_UNAVAILABLE`). See below for how each one still reaches you. |
| A job attempt that will be retried   | A job retried ten times through an outage would be ten events. It is reported once, when it gives up. Each attempt is in the logs.                                                              |
| Log lines                            | Sentry's log product is not used: Loki has them.                                                                                                                                                |
| An error in a `@Cron` handler        | `@nestjs/schedule` logs it and carries on; nothing reports it. The app has no such handlers. If you add one, catch what needs a person and call [`reportError`](#reporting-from-your-own-code). |

The SDK's own NestJS integration is left out
(`withoutNestIntegration` in `src/config/sentry.config.ts`): it would report
every job attempt, and the SDK then ignores a second report of the same
error, so the one sent when a job gives up would never arrive.

**How a 503 still reaches you.** Not in Sentry, but through alerts:

| 503 cause | What tells you |
|---|---|
| Postgres or Redis down (health check) | `PostgresDown`, `RedisDown` |
| Image processing at capacity (a `warn` line, "Image refused") | `AppHighErrorRate` once 5xx answers pass 5% |
| Turnstile unreachable, or it refused `TURNSTILE_SECRET_KEY` | an `error` log line ("Turnstile could not be asked" / "Turnstile refused the check itself"), so `AppErrorLogs` |
| Two-step secret sealed with a key the server lacks | an `error` log line ("Two-step sign-in cannot be checked ... AUTH_ENCRYPTION_KEY"), so `AppErrorLogs` |

The last two are covered in [turnstile.md](./auth/turnstile.md) and
[two-step-sign-in.md](./auth/two-step-sign-in.md).

**Auth emails give up sooner.** The `auth` queue's emails (sign-up and reset
codes, security notices) do not use the 10-attempt default. They try 3 times,
5 then 10 seconds apart (`EMAIL_JOB_OPTIONS` in
[`auth-email-jobs.ts`](../src/modules/auth/infrastructure/email/auth-email-jobs.ts)),
because a code expires in 10 minutes and a late email is useless. So an SMTP
outage of more than about 15 seconds turns each code email into a "failed
for good" report, and that person never gets the code: they have to ask for
a new one. See [emails.md](./auth/emails.md).

**The cap.** An outage turns every request into the same 500, for as long as
it lasts. So that one night of it can't spend a month of quota, one error
(same type, message and route) sends **10 events at once, then one more every
6 minutes**: about 90 over an eight-hour outage. The rest are dropped. Sentry
still shows the issue as ongoing, but its event count is a lower bound: the
logs have every occurrence. The limits are `ERROR_REPORT_BURST` and
`ERROR_REPORT_REFILL_MS` in
`src/shared/infrastructure/monitoring/error-reporting.ts`. On Sentry's side,
[spike protection](https://docs.sentry.io/pricing/quotas/spike-protection/)
(**Settings → Spike Protection**) can limit a sudden burst further.

## What is sent, and what is not

- **The user as an id only**: the `sub` of their token, which is the user's
  row id, never the email or name. The
  frontend reports the same id, so one person's issues can be found in both
  projects. No IP addresses and no cookies (`sendDefaultPii: false`).
- **The failed request**: its URL, headers and body (bodies up to 10 KB,
  the SDK's default). That can include what the user typed, a display name
  or a bio, for instance: it is what makes the error reproducible.
- **Credentials are removed** from it before the event leaves the process:
  the `authorization`, `proxy-authorization`, `cookie`, `x-api-key` and
  `idempotency-key` headers, and these fields wherever they appear (the body,
  JSON or form; the query string and the URL; extra data; breadcrumbs):
  passwords (`password`, `current_password`, `new_password`...), tokens
  (`token`, `refresh_token`, `access_token`), and the auth fields that can
  sign someone in: `code` (emailed codes, and Google's one-time `code` in
  the callback URL), `two_factor_code`, `recovery_codes`, `challenge`,
  `secret`, `otpauth_uri`, `turnstile_token` and `state`. Keys are compared
  without case, `-` or `_`, so `currentPassword` and `current_password` are
  both caught. It is the same list the logs redact:
  [`sensitive-fields.ts`](../src/shared/constants/sensitive-fields.ts). Add a
  field there and it is removed from both. A JSON body that fails to parse is
  not sent at all. (A side effect of masking `code`: an error's own `code` in
  extra data shows as `[REDACTED]`; its message still says it.)
- **To send no bodies at all**, add
  `Sentry.httpIntegration({ maxIncomingRequestBodySize: 'none' })` to what
  `withoutNestIntegration` returns in `src/config/sentry.config.ts`. Replacing
  the `integrations` option with an array of your own instead would bring back
  the Nest integration that function leaves out (see below).
- **Job data is not sent** for a failed job, only its queue, name, id and
  number of attempts: job data can hold anything, personal data included.
- **Tags on every request error**: `request_id`, `method`, `route` (the
  pattern, `/api/v1/users/:id`, not the URL), `status_code`.

Besides errors, the SDK sends a **session summary** about once a minute while
requests come in: how many requests ended normally, with an error, or in a
crash, per release. It carries no request data, is not billed, and gives each
release a "crash-free" rate under **Releases**. (To turn it off:
`Sentry.httpIntegration({ trackIncomingRequestsAsSessions: false })`, added
the same way, through `withoutNestIntegration`.)

To check what an event contains, open it in Sentry: the **Tags**, **User**,
**Request** and **Additional Data** sections are everything that was sent.

## From an issue to its log line

A request error carries the `request_id` tag. In Grafana, open **NestJS Logs**
and type the id into **Search**: the lines of that request appear, including
the `Exception caught` line with the full error. The client got the same id in
the response (`meta.request_id`), so an id a user sends you leads to the same
place.

## Notifications

Sentry emails you about new issues and regressions by default (**User
Settings → Notifications**; the alert rule to set up is in
[setup/sentry.md](./setup/sentry.md#5-email-alerts)). On the free plan, **email is the only channel**:
Slack, Discord and other integrations need a paid plan (Team and up).

That is less of a gap than it sounds: every reported request error is also
logged at `error`, and the `AppErrorLogs` alert already posts those to Discord
(see [alerts.md](./alerts.md)). Discord tells you _that_ errors are happening;
Sentry tells you _which_.

On a paid plan, **Settings → Integrations → Discord** adds a bot to your
server; then an alert rule can use "Send a Discord notification".

## Reporting from your own code

Errors that reach the filters or crash the process are reported already.
Report one yourself only when the code catches it and carries on, and it still
needs a person:

```ts
import { reportError } from '@/shared/infrastructure/monitoring'

try {
    await this.payments.refund(order)
} catch (error) {
    this.logger.error({ msg: 'Refund failed; the order is flagged for review', orderId: order.id })
    reportError(error, { tags: { order_id: order.id } })
    await this.orders.flagForReview(order.id)
}
```

`reportError` does nothing while error tracking is off, and applies the same
cap. Tags are searchable in Sentry; use `extra` for detail that isn't.

The refund above is an illustration. A real caller in the starter is the
auth events adapter,
[`prometheus-auth-events.adapter.ts`](../src/modules/auth/infrastructure/adapters/prometheus-auth-events.adapter.ts),
for a refresh token used twice: the request is refused with a 401 (no
exception reaches the filters as a 5xx), and it is still reported because
someone should look. Call it from an adapter, as there: the application
layer records what happened through its port and does not know Sentry exists.

```ts
reportError(new Error(incident.message), {
    userId: subject?.userId,
    tags: { auth: incident.tag }, // 'refresh-reuse'
    extra: { sessionId: subject?.sessionId }
})
```

## Tracing

Only errors are sent. Sentry can also trace requests, and that is off by
default.

**What a trace is.** The timeline of one request, split into the steps it
took (spans), each with its duration:

```
POST /users/me/avatar ────────────────────────── 840 ms
 ├─ auth guard (session + user, Redis)   4 ms
 ├─ sharp: resize avatar               320 ms
 ├─ S3: PutObject                      490 ms   ← the slow part
 └─ Prisma: swap avatar (one UPDATE)    12 ms
```

Each of the three signals answers a different question:

| Signal | Where | Answers |
|---|---|---|
| Metrics | Prometheus, the dashboards | *That* something is slow or failing: "p95 of `POST /users/me/avatar` is 800 ms" |
| Logs | Loki, NestJS Logs | *What* happened: the errors, and a request's lines by its `requestId` |
| Traces | Sentry → Performance | *Where the time went* inside one request |

**Why it's off.** For one app with a few dependencies, the metrics and logs
answer most questions; the per-route latency is on the NestJS API dashboard.
Traces take their own quota (5 million spans a month on Sentry's free plan)
and add a little work to each traced request.

**When to turn it on.** When a route is slow and it isn't clear whether the
database, S3 or image processing is the cause. Trace a share of the
requests for a few days, read Sentry → Performance, then set it back to 0:

```bash
SENTRY_TRACES_SAMPLE_RATE=0.1   # 10% of requests
```

The app then also loads `SentryModule`, which names each trace after its
route.

**Several services.** Once a project splits into services that call each
other, a trace that follows one request across all of them is worth having
permanently. That is OpenTelemetry's job rather than Sentry's: each service
sends its spans to a tracing backend, such as Grafana Cloud's Tempo (the
"Traces" section in Grafana Cloud; this starter sends nothing there).

## GlitchTip instead of Sentry

[GlitchTip](https://glitchtip.com) is an open-source, self-hostable service
that accepts the same events. Nothing in the app changes: put a GlitchTip
project's DSN in `SENTRY_DSN` (an `http://` DSN is accepted for a server on a
private network). Self-hosting it means one more service to run, update and
back up: it needs Postgres, a web and a worker process, and about 512 MB of
memory.

## Troubleshooting

**`pnpm sentry:check` says…**

| Message                                 | Meaning                                                                                                     |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `SENTRY_DSN is not set`                 | The env file it read has no DSN. It reads `.env.<NODE_ENV>`, `.env.development` by default.                 |
| `is not a DSN`                          | The value is not of the form `https://<key>@<host>/<project>`: a project page URL was pasted, for instance. |
| `refused the DSN (HTTP 401/403)`        | The key was revoked or deleted. Copy the current DSN from the project's Client Keys.                        |
| `rate limiting this project (HTTP 429)` | The month's quota is used up, or a spike limit applies. **Settings → Subscription** shows usage.            |
| `Could not reach …` / `No answer`       | DNS or outbound HTTPS from this machine is blocked.                                                         |

**The check passes, but the app's errors don't arrive.**

- The app was not restarted after setting the DSN, or it runs with another env
  file. In a container: `docker compose … exec app printenv SENTRY_DSN`.
- The error is not one that is reported: a 4xx, a 503, or a job attempt that
  will be retried (see [What is reported](#what-is-reported)).
- It is under another environment: Sentry's issue list filters by environment
  (top of the page).

**The test errors are cluttering the issue list.** Resolve or delete them. An
environment used only for testing can be hidden under **Settings → Projects →
your project → Environments**.

**Invalid DSN at boot.** The app refuses to start with a DSN of the wrong
shape, like any other invalid setting; `pnpm env:check` reports it too.
