# BullMQ & Background Jobs: A Beginner's Guide

This page explains why the starter uses **BullMQ**, a job queue kept in Redis,
for work that should not happen inside a request: sending the sign-in emails,
deleting the file an account left behind in S3, and the periodic clean-ups. It
is for anyone adding background work, or wondering what `/admin/queues` shows.

## 1. What happens without a Message Queue?

Imagine what happens when a user clicks **"Delete Account"**, if everything
happened inside the request:

1. The React app sends `POST /api/v1/auth/account/delete` with the password.
2. NestJS checks the password, marks the row deleted in PostgreSQL and ends
   every session.
3. NestJS then makes a network request to **S3** to delete the account's avatar,
   and another to the **SMTP server** to send "your account was deleted".
4. Finally, NestJS responds to the React app with `200 OK`.

**The Problem:**
What if S3 or the mail server is having a bad minute, or the network hangs for
ten seconds? Your API freezes waiting for it, and the request eventually times
out. The React app shows the user *"Failed to delete account"*, even though the
database was updated and the account really is gone. The user retries, and now
they are confused as well as annoyed.

The same is true of every email: a sign-up should not fail, or take five
seconds, because the SMTP server is slow.

## 2. The obvious fix, and why it is not the one to take

The first thing most people reach for is a **cron job** (polling):

- The API returns `200 OK` at once and records "this file still needs deleting".
- A cron job runs every 60 seconds.
- It asks the database: "any files pending?"
- If there are, it makes the S3 call.

This works. Two things are wrong with it.

**It is noisy.** Even if nobody deletes an account for a month, the code runs
43,000 times, mostly to log `Checking for pending files... found 0`.

**It fires on every instance.** The moment the app runs twice, two crons ask
the same question and can both act on the same answer.

## 3. The BullMQ (Message Queue) Solution

BullMQ uses **Redis** to pass small messages (jobs) from the part of the app
that wants something done to a worker that does it, in the background.

Here is the flow for deleting an account:

### Step A: the producer

1. The user clicks **"Delete Account"**; the app sends
   `POST /api/v1/auth/account/delete`.
2. `DeleteOwnAccountHandler` (auth module) checks the proof (the password or an
   emailed code), then runs the users module's `DeleteAccountCommand`.
3. `DeleteAccountHandler` (users module) sets `deletedAt = now()` in PostgreSQL
   and publishes an `AccountDeletedEvent`.
4. Two event handlers react. `EndSessionsOfDeletedAccountHandler` (auth) ends
   every session and removes the password and Google links.
   `CleanupAccountAvatarHandler` (users) drops a small note, a job, into Redis:
   > *"Delete this stored file. If it fails, keep trying for an hour and a half."*
5. `DeleteOwnAccountHandler` queues one more job, the "account deleted" email,
   on the `auth` queue.
6. NestJS immediately replies to the React app: `200 OK`.

### Step B: the consumer

1. Somewhere else in the backend, `FileCleanupConsumer` is listening to Redis.
2. As soon as the job lands, BullMQ hands it to the consumer.
3. The consumer makes the network request to storage.
   - **Success?** The job is done, and removed after a day.
   - **Failure?** The consumer throws. BullMQ puts the job back with a delay
     of ten seconds, then twenty, then forty, and so on.

`AuthJobsConsumer` does the same for the `auth` queue: it sends the email,
through the auth module's `AuthEmails`.

### Why is this better?

- **No polling.** Nothing runs until there is work.
- **It is resilient.** If storage is unreachable, BullMQ retries with
  exponential backoff: ten attempts starting at ten seconds, spanning about 85
  minutes. That number is chosen, not a default: five attempts from five
  seconds spans barely 75 seconds, which does not outlast an ordinary
  dependency restart. A job that fails all ten times stays in the *failed*
  list for 14 days, to inspect on `/admin/queues`.
- **It absorbs bursts.** If 1,000 people delete their account at the same
  second, the API just adds 1,000 jobs to Redis, and the consumer works through
  them at its own pace.

## Emails are jobs too, with their own rules

Every email the auth module sends goes through the `auth` queue (the jobs
are defined in `src/modules/auth/infrastructure/email/auth-email-jobs.ts`):

| Job | Sent when |
| --- | --- |
| `send-code` | A 6-digit code: confirm a sign-up, reset a password, set a first password, delete an account |
| `password-changed` | The password was changed or reset |
| `password-added` | A password was added to an account that had none |
| `account-exists` | Someone tried to sign up with an address that already has an account |
| `sign-in-method-added` | Google was linked to an existing account |
| `account-deleted` | The account was deleted |

These override the queue's defaults with `EMAIL_JOB_OPTIONS`: **3 attempts,
exponential backoff from 5 seconds**, removed **at once** when sent, and kept a
day when they fail. A code expires in 10 minutes, so retrying for an hour and a
half would only deliver a dead code. And a `send-code` job holds the code
itself, so it is not kept in Redis a moment longer than needed.

What each email says, and how to change one: [auth/emails.md](./auth/emails.md).

## What about work that really is on a schedule?

Some things genuinely have to happen every so often rather than in response to
a click: erasing the personal data of long-deleted accounts, removing sessions
that ended a week ago. The objection above was to *polling*, not to schedules.

BullMQ has a **job scheduler**, which is a cron whose schedule lives in Redis
rather than in the process:

```typescript
await this.queue.upsertJobScheduler('deleted-accounts-sweep', { every: 15 * 60 * 1000 }, { name: 'deleted-accounts-sweep' })
```

You do not write that line yourself. Every periodic job is an entry in
`src/maintenance/maintenance-tasks.ts` (an id, how often, and the module's
command that does the work), and `MaintenanceConsumer` schedules them all at
boot, on the `maintenance` queue
([core-infrastructure.md](./core-infrastructure.md#scheduled-work)). Only they
use that queue, so a backlog of emails or file deletions never delays them.

The difference matters the moment you run the app twice. An in-process
`@Cron` fires on **every** instance, so two instances do every job twice.
A Redis-held schedule produces one job per tick, handled by one instance.

Two schedules ship with the starter:

| Queue | Scheduler | Every | What it does |
| --- | --- | --- | --- |
| `maintenance` | `deleted-accounts-sweep` (users) | 15 min | Erases the personal data of accounts deleted more than `DELETED_ACCOUNT_RETENTION_DAYS` ago; deletes accounts unconfirmed for `UNVERIFIED_ACCOUNT_RETENTION_DAYS` |
| `maintenance` | `auth-clean-up` (auth) | 1 h | Removes sessions that ended a week ago and codes a day old; ends what a lost `AccountDeletedEvent` left behind (sessions, passwords and Google links of deleted accounts) |

## Code map

| | Where |
| --- | --- |
| Queue names, and the retry and clean-up defaults for every job | `src/shared/infrastructure/queue/queues.ts` |
| Connection setup | `src/app.module.ts` → `BullModule.forRootAsync(...)` |
| Producer: the emails | `src/modules/auth/infrastructure/adapters/bullmq-auth-mailer.adapter.ts`; the jobs and `EMAIL_JOB_OPTIONS` in `src/modules/auth/infrastructure/email/auth-email-jobs.ts` |
| Producer: avatar clean-up | `src/modules/users/application/events/handlers/cleanup-account-avatar.handler.ts`, through `bullmq-background-jobs.adapter.ts` |
| Consumers | `src/modules/auth/presentation/consumers/auth-jobs.consumer.ts` (the emails), `src/maintenance/maintenance.consumer.ts` (every periodic job), and `src/shared/infrastructure/storage/file-cleanup.consumer.ts` |
| The periodic jobs, and how often | `src/maintenance/maintenance-tasks.ts` |
| Queue metrics, and reporting a job that failed for good | `src/shared/infrastructure/queue/` |

The application layer never imports `bullmq`. It calls a port
(`BackgroundJobsPort` in users, `AuthMailerPort` in auth), and only adapters,
consumers and the queue infrastructure name the library:
`bullmq-background-jobs.adapter.ts`, `bullmq-auth-mailer.adapter.ts` and the
consumers above. Swapping the queue library means rewriting
those, not the handlers.

## 4. The BullMQ Dashboard (Secured)

You can see every queued, active, completed and failed job on the built-in
dashboard, Bull Board.

- **URL:** `http://localhost:8888/admin/queues` in development. It is mounted
  on raw Express, outside the API prefix and outside every guard, which is why
  the next two points matter so much.
- **Security:** Basic authentication (`express-basic-auth`, compared in
  constant time), and in the shipped nginx configuration the location is
  restricted to local and private addresses as well.
- **Credentials:** `BULL_BOARD_USER` and `BULL_BOARD_PASSWORD`, default
  `admin`/`admin` for local development. **The app refuses to start in
  production** unless `BULL_BOARD_PASSWORD` is strong (at least 12 characters,
  not a known default). `BULL_BOARD_USER` is not checked; change it anyway.

**Why this page is sensitive:** a `send-code` job that is waiting or has failed
holds the code it sends, in plain text. Anyone who can read this page can read
a password-reset code for any address and take over that account. Someone who
can retry or remove jobs can also block a sign-up. Keep it behind the password
and the IP allow-list, and never proxy it publicly
([auth/security.md](./auth/security.md)).
