<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**  *generated with [DocToc](https://github.com/thlorenz/doctoc)*

- [Testing](#testing)
  - [Table of Contents](#table-of-contents)
  - [What we test](#what-we-test)
  - [What is Testing?](#what-is-testing)
    - [Why Test?](#why-test)
  - [Types of Tests](#types-of-tests)
    - [1. Unit Tests (Most Common)](#1-unit-tests-most-common)
    - [2. Integration Tests](#2-integration-tests)
    - [3. E2E Tests (End-to-End)](#3-e2e-tests-end-to-end)
    - [Testing Pyramid](#testing-pyramid)
  - [Key Concepts](#key-concepts)
    - [Mocking](#mocking)
    - [AAA Pattern](#aaa-pattern)
    - [describe() and it()](#describe-and-it)
    - [beforeEach / afterEach](#beforeeach--aftereach)
  - [Quick Start](#quick-start)
    - [E2E vs integration](#e2e-vs-integration)
    - [In CI](#in-ci)
  - [The Suites in This Starter](#the-suites-in-this-starter)
    - [Unit tests](#unit-tests)
    - [E2E tests](#e2e-tests)
    - [Integration tests](#integration-tests)
  - [Test Structure](#test-structure)
  - [Testing in Hexagonal Architecture](#testing-in-hexagonal-architecture)
    - [What to Test Per Layer](#what-to-test-per-layer)
    - [What NOT to Test](#what-not-to-test)
    - [The Port Mocking Pattern](#the-port-mocking-pattern)
    - [Testing Event Publishing](#testing-event-publishing)
    - [Test File Locations](#test-file-locations)
  - [Writing Tests](#writing-tests)
    - [Unit Test Example](#unit-test-example)
    - [Command Handler Test Example (with port mocking)](#command-handler-test-example-with-port-mocking)
    - [E2E Test Example](#e2e-test-example)
  - [Common Jest Matchers](#common-jest-matchers)
  - [Code Coverage](#code-coverage)
  - [Best Practices](#best-practices)
  - [Troubleshooting](#troubleshooting)
    - ["Reflect.getMetadata is not a function"](#reflectgetmetadata-is-not-a-function)
    - [Tests timing out](#tests-timing-out)
    - [Module not found errors](#module-not-found-errors)
  - [What this page does not cover](#what-this-page-does-not-cover)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

# Testing

This page is for anyone about to run the tests or write one: what the three
kinds of test are, which suites the starter has and what each one proves, the
commands, and the patterns to copy.

> The OpenAPI contract test and `pnpm openapi:check` are described in [openapi.md](./openapi.md).

## Table of Contents
- [What we test](#what-we-test)
- [What is Testing?](#what-is-testing)
- [Types of Tests](#types-of-tests)
- [Key Concepts](#key-concepts)
- [Quick Start](#quick-start)
- [The Suites in This Starter](#the-suites-in-this-starter)
- [Testing in Hexagonal Architecture](#testing-in-hexagonal-architecture)
- [Writing Tests](#writing-tests)
- [Best Practices](#best-practices)

---

## What we test

Only what is worth a failing build. A test stays when all three hold:

1. **The bug it catches is serious**: it would let someone into an account,
   leak a secret or bypass a limit; lose or corrupt data; or let a broken
   release deploy (a configuration the app must refuse, files that must stay
   in step).
2. **Nothing else catches it**: not another test, not the type checker.
3. **It is the one test for that behaviour**: one or two example inputs, not a
   table of them. Several checks of one behaviour go in one test.

Everything else is left out: examples, wording, trivial code (getters,
defaults, mappers, arithmetic), re-tests of libraries (Joi, class-validator,
camelcase-keys), "the handler passes the repository's error on", logging and
metrics details. A project built on this starter should keep the same bar: a
test that cannot name the serious bug it catches costs more to keep than it
saves.

## What is Testing?

**Tests are automated checks that verify your code works correctly.**

### Why Test?

Imagine building a house. Would you wait until it's fully built to see if the doors open?

```
Without Tests:
1. Write code
2. Deploy to production
3. User: "Login is broken!"
4. You: "Oh no, my change broke something"
5. Frantically fix at 2am

With Tests:
1. Write code
2. Run tests → ❌ Test failed: Login broken
3. Fix before deploy
4. Deploy confidently
5. Sleep well
```

---

## Types of Tests

### 1. Unit Tests (Most Common)
**What:** Test ONE function/method in isolation
**Speed:** Very fast (milliseconds)
**When to use:** Testing utility functions, business logic, calculations

```typescript
// Example: Testing a utility function
describe('parseIntSafe', () => {
    it('should parse valid number string', () => {
        expect(parseIntSafe('42', 0)).toBe(42)
    })
    
    it('should return default for undefined', () => {
        expect(parseIntSafe(undefined, 10)).toBe(10)
    })
})
```

**Analogy:** Testing if a single brick is solid

### 2. Integration Tests
**What:** Test multiple components working together
**Speed:** Medium (seconds)
**When to use:** Testing a service with its database, service + cache, etc.

```typescript
// Example: Testing a service with its dependencies
describe('UsersService', () => {
    it('should create a user in database', async () => {
        const user = await usersService.create({
            email: 'test@example.com',
            name: 'Test'
        })
        expect(user.id).toBeDefined()
    })
})
```

**Analogy:** Testing if the wall holds together (bricks + mortar)

### 3. E2E Tests (End-to-End)
**What:** Test the full system as a user would
**Speed:** Slow (seconds to minutes)
**When to use:** Testing complete user workflows, API endpoints

```typescript
// Example: Testing an API endpoint
describe('/api/v1/health (GET)', () => {
    it('should return 200 OK', () => {
        return request(app.getHttpServer())
            .get('/api/v1/health')
            .expect(200)
    })
})
```

**Analogy:** Testing if the entire house works (doors, plumbing, electricity)

### Testing Pyramid

```
        /\
       /  \      E2E Tests (Few)
      /----\       ↑ Slow, Expensive
     /      \
    /--------\   Integration Tests (Some)
   /          \    ↑ Medium Speed
  /------------\
 /              \ Unit Tests (Many)
/________________\  ↑ Fast, Cheap

Recommended Ratio:
- 70% Unit Tests
- 20% Integration Tests  
- 10% E2E Tests
```

---

## Key Concepts

### Mocking

**What:** Replacing real dependencies with fake ones

**Why:** 
- Don't want to hit real database in tests
- Don't want to send real emails
- Don't want to make real API calls
- Tests run faster and more reliably

```typescript
// Real code calls Prisma
const user = await prisma.user.findUnique({ where: { id } })

// In tests, we "mock" Prisma to return fake data
const mockPrisma = {
    user: {
        findUnique: jest.fn().mockResolvedValue({ id: 1, name: 'Test' })
    }
}
```

### AAA Pattern

Every test should follow **A**rrange → **A**ct → **A**ssert:

```typescript
it('should return user by ID', async () => {
    // ARRANGE - Set up test data and mocks
    const userId = 1
    const expectedUser = { id: 1, name: 'John' }
    mockPrisma.user.findUnique.mockResolvedValue(expectedUser)
    
    // ACT - Call the function being tested
    const result = await usersService.findById(userId)
    
    // ASSERT - Verify the result
    expect(result).toEqual(expectedUser)
})
```

### describe() and it()

```typescript
describe('UsersService', () => {           // Group: What we're testing
    describe('findById', () => {           // Sub-group: Which method
        it('should return user when found', () => {      // Test case
            // test code
        })
        
        it('should return null when not found', () => {  // Another case
            // test code
        })
    })
})
```

### beforeEach / afterEach

```typescript
describe('UsersService', () => {
    let service: UsersService

    beforeEach(() => {
        // Runs BEFORE each test - set up fresh state
        service = new UsersService()
    })

    afterEach(() => {
        // Runs AFTER each test - clean up
        jest.clearAllMocks()
    })

    it('test 1', () => { /* service is fresh here */ })
    it('test 2', () => { /* service is fresh here too */ })
})
```

---

## Quick Start

The project uses **pnpm** (`packageManager` in `package.json`), not npm.

```bash
# Run all unit tests (src/**/*.spec.ts; need nothing running)
pnpm test

# Run tests in watch mode (re-runs on file changes)
pnpm test:watch

# Run tests with coverage report
pnpm test:cov

# Run E2E tests (need nothing running)
pnpm test:e2e

# Run integration tests (need Postgres, Redis, RustFS, Mailpit and LiveKit)
pnpm test:services:up
pnpm test:integration
pnpm test:integration -- auth      # only the suites whose file name matches

# Stop the test-only containers (RustFS) afterwards; db, redis and mailpit are
# the dev stack's own and keep running
pnpm test:services:down

# Debug tests
pnpm test:debug
```

`pnpm test:services:up` starts five containers from `docker-compose.dev.yaml`,
with the `testing` profile: `db` (Postgres), `redis`, `rustfs` (an
S3-compatible store), `rustfs-buckets` (a one-off that creates the bucket) and
`mailpit` (an SMTP server that catches mail and shows it at
`http://localhost:8025`). It reads `.env.development`, so make that file first
([setup/prepare-for-development.md](./setup/prepare-for-development.md)).

### E2E vs integration

The `test/` directory holds two kinds of suites, each in its own folder:

| Folder | Needs | Command |
|---|---|---|
| `test/e2e/` | Nothing but Node | `test:e2e` |
| `test/integration/` | Real backing services | `test:integration` |

**The folder is what selects.** Create a new suite in the folder that matches what it needs and it runs under the right command automatically — there is no exclusion list to keep in sync. The `.e2e-spec.ts` / `.integration-spec.ts` suffixes are kept so a filename reads clearly on its own, but any `*-spec.ts` inside a folder runs with that folder's command.

Integration suites use **stand-ins, not your real providers**: RustFS speaks the S3 API, Mailpit speaks SMTP, a fake OpenID Connect provider (`test/integration/fake-oidc-issuer.ts`) plays Google. So the storage, email and sign-in code runs for real without cost, secrets, or sending actual mail. That holds regardless of what production uses (AWS, R2, Brevo, Postmark, ...).

If a service is not running, `test:integration` stops immediately and names the missing one, rather than letting each suite time out.

`test:integration` runs Jest twice (`test/run-integration.cjs`): the S3 suite with Node's `--experimental-vm-modules`, which the AWS SDK needs, and every other suite without it, because with it Jest cannot load ESM-only packages such as `jose` on Node 22. Arguments reach both runs, so `pnpm test:integration -- auth` still picks suites by name.

The auth suites are the ones to read first: `auth.integration-spec.ts` (row locks, concurrent refreshes and code guesses, the session cache) and `auth-http.integration-spec.ts` (the whole app over HTTP, sign-up to sign-out, codes read from Mailpit). Every suite is listed [below](#integration-tests).

### In CI

The GitHub Actions workflow runs every suite on every push, the integration suite against the same services `pnpm test:services:up` starts ([ci.md](./ci.md)). Nothing is skipped — a skipped integration suite would let CI pass without testing anything. Every connection target is overridable through `TEST_*` variables (`TEST_REDIS_HOST`, `TEST_REDIS_PORT`, `TEST_S3_ENDPOINT`, `TEST_SMTP_HOST`, `TEST_SMTP_PORT`, `TEST_MAILPIT_API`, ...), for a CI whose services have other hostnames.

---

## The Suites in This Starter

### Unit tests

`pnpm test` runs every `*.spec.ts` under `src/`, about 75 suites, in a few
seconds. They need nothing running: ports are replaced by fakes. Jest compiles
without type-checking (`isolatedModules` in `test/esm-transform.js`):
`pnpm exec tsc --noEmit`, lint and CI check the types.

| Area | Suites (next to the code they test) |
|---|---|
| Auth commands | one file per area, sharing the in-memory fakes of [auth-test-world.shared-spec.ts](../src/modules/auth/application/commands/auth-test-world.shared-spec.ts): `email-code` (sign-up and sign-in by code), `sessions` (sign-in limits, refresh, the list of devices and signing them out), `passwords`, `google`, `delete-account`, `complete-account` (of two submissions at once, one wins) |
| Auth building blocks | `limits.spec.ts` (guesses counted before they are checked), `password-policy.spec.ts`, `device.spec.ts` (browser, system and device kind from a user agent), `masked-ip.spec.ts` (IPv4, IPv6 and `::ffff:` addresses masked), `route-helpers.spec.ts` (the user agent cut to 512), `jose-token-service.adapter.spec.ts` (a token for another audience, issuer, or past its lifetime is refused), `session-end.spec.ts`, `session-ends.spec.ts` (every way a session ends tells the other modules, after the cache; a direct `invalidateSessions` call outside it fails), `end-sessions-of-deleted-account.handler.spec.ts`, `prometheus-auth-events.adapter.spec.ts`, `auth-emails.spec.ts`, `access-token.guard.spec.ts`, `throttle-by-user.spec.ts` |
| Users | `upload-avatar` (no orphaned file), `remove-avatar` (the file goes; no avatar answers the same), `sweep-deleted-accounts`, `profile-text.rules.spec.ts` (NFC, code points, a name that looks empty), `update-profile.request.dto.spec.ts` (`null` refused, empty bio clears), `avatar-file.pipe.spec.ts` (declared type, 415), `user-directory.adapter.spec.ts` (a Google name cut without splitting an emoji; a stored picture key given out as the storage's address, for other modules' lists); the settings (`update-settings` and `get-settings` handlers, `update-settings.request.dto.spec.ts`, `user-settings.rules.spec.ts`, `timezone.rules.spec.ts`); `username.rules.spec.ts`, `account-deletion.rules.spec.ts` |
| Shared | the roles guard, 5xx answers that leak nothing, a 413 file named `UPLOAD_FILE_TOO_LARGE` and a 413 JSON body `PAYLOAD_TOO_LARGE_ERROR`, URL redaction in logs, the queue failure reporter (no job data), image-processing limits, S3 errors kept out of answers, stored file extensions, IPv6 /64, the verification code generator, unique error codes, the email service, the rate limiter, the request log (`logging.interceptor.spec.ts`); and in `src/maintenance/`, the scheduled jobs' consumer (`maintenance.consumer.spec.ts`) |
| Servers | one `<area>.handlers.spec.ts` beside each command and query area; the rules in `domain/` (`channel-layout`, `channel-name.rules`, `invites`, `member-view`, `membership`, `moderation`, `roles`, `server-name.rules`, `server-settings`, `server-templates`); `commands/server/membership.handlers.spec.ts` (leaving, deleting and handing over a server, a deleted account leaving its servers, the daily clean-up); each area's spec also checks the `ServerChangedEvent` / `MemberChangedEvent` published after the commit (D-178); `services/invite-guesses.spec.ts`; `services/permission-cache.spec.ts`, which fails when a command handler does not go through `ChangeLayout`, `ChangeRoles`, `Moderate` or `ChangeMembership` (the base classes that report `serverChanged` / `memberChanged` to the permission cache after the commit) and is not on its list of exceptions with a reason, or when that list names a handler that is gone or now goes through a base |
| Permissions | `access.spec.ts` (what a member may do in a channel and a server, who outranks whom, which permission changes and role hand-outs are allowed), `permission-flags.spec.ts` (the bits on the wire), `access-codec.spec.ts` (the cached entry read back as it was written), `redis-permission-checker.adapter.spec.ts` (Redis failing on purpose: answers from the database, a failed write only logged, an invalidation tried once more and never thrown, D-146) |
| Realtime | `rooms.spec.ts` (which channel rooms a socket joins: text channels and voice rooms the member may view, D-163, D-205; which it leaves and joins when its server changes, D-178), `open-connection.handler.spec.ts` (a ticket spent once, a session ended since refused), `settle-rooms.handler.spec.ts` (a socket just in its rooms moved again in the servers it had and has), `services/room-moves.spec.ts` (one person's moves in turn, the last change winning; the others moved when one fails), `publish-server-change.handler.spec.ts` and `publish-member-change.handler.spec.ts` (what is told, to whom, before or after the sockets move), `issue-ticket.handler.spec.ts`, `report-voice-state.handler.spec.ts` (a tab's microphone and camera handed on to voice, D-206), `disconnect-ended-sessions.handler.spec.ts`; in `src/shared/infrastructure/websocket/`, `redis-io-adapter.spec.ts` (a publish Redis refuses is logged, never an unhandled rejection); `events/handlers/hide-deleted-account-presence.handler.spec.ts` (an account waiting to be deleted shown offline at once and forgotten, a tab closing after it telling nothing, D-182; the in-memory presence store and its `world()` shared with the presence handlers in `commands/presence/presence-test-world.shared-spec.ts`) |
| Messaging | `message.rules.spec.ts` (the text kept composed and without the blank around it, 1-2000 characters counted in code points; `firstIdAt`, the smallest id of a millisecond), `channel-access.spec.ts` (who may read and post in a channel: not found for anyone who may not view it, a timeout said with its end before "managers only", the owner posting through a timeout; `timedOutUntil`, which the owner is never held back by), `sending-limits.spec.ts` (5 in 5 seconds per person per channel, 30 a minute per person, the channel's count given back when the minute refuses, uncounted while Redis is down), the `message.handlers.spec.ts` of `commands/message/` (a used nonce answered uncounted and untold, a refused message never counted, the count given back when a racing send of the nonce or a channel gone meant nothing was made, a picture that cannot be signed left out rather than the send failing, a nonce of a message deleted since not found; replies only to a regular message of the channel, a deleted one quoted as deleted; editing only one's own message while one may post, the same text changing nothing; deleting one's own unless timed out or anyone's with MANAGE_MESSAGES, never a system message, not found once deleted or out of view; a ban's recent messages deleted channel by channel a batch of 100 at a time, each batch after the last one deleted, one event a batch, a failed batch failing the job) and `queries/message/` (one signature per picture, quoted authors included), `publish-created-message.handler.spec.ts`, `publish-updated-message.handler.spec.ts`, `publish-deleted-message.handler.spec.ts`, `publish-bulk-deleted-messages.handler.spec.ts`; a ban's recent messages (D-181): `delete-banned-messages-later.handler.spec.ts` (a job only for a ban with a window, the ban named in the log when it cannot be queued), `bullmq-message-purge.adapter.spec.ts` (one job per ban, its window as text), `messaging-jobs.consumer.spec.ts` (the job to its command, a failure failing the job) |
| Tasks | `task.rules.spec.ts` (who may make, edit, delete a task, change its status, add and take off people: the creator, anyone on it, MANAGE_TASKS, anyone taking it on themselves; nobody timed out, D-188; only what really changes checked, a due date only when it changes, D-96; done stamps the time, reopening empties it; the history in order, made then due date then people), `task-text.rules.spec.ts` (titles 1-200 characters on one line, descriptions to 2000, counted in code points; the folding the search uses, D-97), the handler specs of `commands/task/`, `commands/assignee/` and `queries/task/` on an in-memory world (`task-test-world.shared-spec.ts`): not found for a channel or task one cannot view, a board that is off said so, people who cannot view the channel named, 500 tasks not done, nothing told when nothing changes, the done group's page of 50 and a cursor no longer done; the people who no longer view the channel and a creator who left marked, D-194; a member who left taken off every task of that server by no one, unless they joined again), a member who left (D-195): `unassign-left-member-later.handler.spec.ts` (a job for each leave, by themselves, kick or ban, none for a join or a change, who and where logged when it cannot be queued), `bullmq-task-jobs.adapter.spec.ts` (one job per leave; a reminder delayed until its mark, named by the task, the mark and the due date, and removed by that name), `tasks-jobs.consumer.spec.ts` (each job to its command, a failure failing the job); the reminders (REQ-TASK-04): `reminder.rules.spec.ts` (the marks still ahead, D-95; which to drop and set after a write; a job that no longer holds; to whom), `reminder.handlers.spec.ts` (the inbox first and once, then the channel's message; the creator when no one on it views the channel; nothing for a task deleted, done, moved or on a board turned off), `schedule-task-reminders.handler.spec.ts`, `schedule-board-reminders.handler.spec.ts`; the inbox items (D-98, D-95, D-200): `notify-task-people.handler.spec.ts` (given a task by someone else, the last one taking themselves off or leaving, not taken off by another), `notify-deleted-task.handler.spec.ts` |
| Notifications | `notification.rules.spec.ts` (one item per person by the strongest reason, never the author; an edit adds, takes off and changes reasons; the 90 days; a task item never for the one who acted), the handler specs of `commands/item/`, `commands/task-item/`, `commands/read/`, `commands/clean-up-notifications/` and `queries/inbox/` on an in-memory world (`notification-test-world.shared-spec.ts`): items of a message read for those past it (D-199), taken off with the message; a task item keeping its title and due date (D-98), a reminder written once per mark and due date, a deleted task told to all who may have had an item with their count (D-200) |
| Voice | `voice.module.spec.ts` (the module built as the app builds it, the modules it imports swapped for empty stand-ins with `overrideModule`: the `LIVEKIT_*` variables, read by `livekit.config.ts`, reach the adapters behind `MEDIA_ROOMS` and `MEDIA_EVENTS`; the one module spec, M4 L1-c, since the adapters' specs build their settings by hand), `voice-state.rules.spec.ts` (a join replaces only an older connection, a leave removes only its own, the icons a tab reports, a moderator's mute kept through them, mute and unmute written once, a screen marked only for the connection the row holds; the reconciliation's screens: off when LiveKit lists that connection with none, on for the one screen of a room nobody is marked sharing in, never with two sent (D-101), the reason a person left a server, the reconciliation's plan: lost joins and leaves, a minute's grace, the newest of two connections kept, D-210), `connection.handlers.spec.ts` (a token by permission: not found, FORBIDDEN, MEMBER_TIMED_OUT, the sources of SPEAK and VIDEO; another room left first, none when LiveKit cannot be reached; leaving), `media-event.handlers.spec.ts` (a webhook refused unsigned, taken once, out of order ignored, the other room left on a move, its id forgotten when writing fails; a join of someone who may no longer be in the room put out, D-212; a screen started and stopped, a second one muted and its person told who shares, the event sent again when LiveKit cannot mute it, D-101), `reconcile.handlers.spec.ts` (and the rooms of deleted channels emptied, anyone who may no longer be in a room put out, D-212; a screen whose stop was lost turned off, one whose start was lost turned on, D-101), `moderation.handlers.spec.ts` (mute, unmute, put out: the permission in the room, rank, NOT_FOUND, MEMBER_TIMED_OUT, nothing written when LiveKit cannot be reached, in the person's media turn, NOT_FOUND for one gone meanwhile, D-207, D-212), `publish-room-people.handler.spec.ts` and `queries/room/room.handlers.spec.ts` (the room told its whole list, the lists of `GET /servers`, each person's roles and ownership, D-205), `record-self-state.handler.spec.ts` (a tab's icons), `recheck-member-room.handler.spec.ts` and `recheck-server-rooms.handler.spec.ts` (kick, ban, leaving, timeout, CONNECT lost: put out and told why; SPEAK lost: what one may send changed; a deleted channel or server, D-212), `leave-deleted-account-room.handler.spec.ts`, `livekit-media-rooms.adapter.spec.ts` (a join token for one room and person, ten minutes to join, sending only what it is given, never data, D-210; what a person may send changed whole, D-207; LiveKit's "not found" an empty room or a person gone, anything else unavailable with the cause logged, a refused key as an error naming the settings; who sends a screen, its sound or a muted one no screen; a track muted only once LiveKit says the person still sends it, D-101), `livekit-media-events.adapter.spec.ts` (webhooks signed as LiveKit signs them: joins and leaves, a screen started and stopped with its track, any other track left alone, another secret refused) |
| Structure | `module-structure.spec.ts` in `src/modules/`: every file where the "Names and places" table of [adding-a-module.md](./adding-a-module.md#names-and-places) puts it, an `index.ts` in every layer, one DTO class per file named after it, DTO classes only in `dto/`, each command and query named after its folder, each command and query folder in one form (a single pair, or the area pair). It reads the tree, so no change to a file makes it related: `check:task` runs it by name (`pnpm test:structure`) |
| Configuration | env validation (production refusals, LiveKit's development defaults) and `env:check` (files in step), pino and Sentry redaction, image versions, compose healthchecks, monitoring files |

### E2E tests

`pnpm test:e2e` runs `test/e2e/`. Each suite builds a small Nest app around
one controller or feature, with the real pipes, filters and interceptors and
fake buses or ports, and calls it over HTTP with `supertest`. Nothing needs
to be running.

| Suite | What it checks |
|---|---|
| `auth-routes` | the fixed `GET /auth/options` and `/auth/sessions` reach their own handlers, because `OAuthController` (`GET auth/:provider`) is registered last |
| `openapi-contract` | users responses match the committed `openapi.json`, which the web app's types are generated from ([openapi.md](./openapi.md)) |
| `exception-filter` | a server error answers without its detail |
| `idempotency-replay` | `@Idempotent`: another user's key never replays my answer; the same key with another body is refused ([idempotency.md](./idempotency.md)) |
| `health` | dependency errors stay out of `/health` in production |
| `operational-endpoints` | the API docs behind basic auth in production |
| `servers-write-then-read` | a server write whose server is gone by the read after it answers 404, not 500 (D-159) |

**How an e2e test fakes a signed-in user.** There is no token in these
suites: a small middleware puts the user on the request, as the access-token
guard would (as `openapi-contract.e2e-spec.ts` does):

```typescript
app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { id: 'user-1' }
    next()
})
```

Real tokens and the real guard are tested in the integration suites below.

### Integration tests

`pnpm test:integration` runs `test/integration/` against real services (start
them with `pnpm test:services:up`). One worker at a time, since the suites
share the services.

| Suite | Needs | What it checks |
|---|---|---|
| `auth` | Postgres, Redis | what only real services can prove: one refresh rotation wins under concurrency (the row lock), reuse after the replacement was used ends the session, codes guessed at once all count, an older code cannot use up a newer one, a revoked session or deleted account is refused at once even when cached |
| `auth-http` | Postgres, Redis, Mailpit | the whole app over HTTP: an account made with an emailed code and signed in to with the next one, a first password through forgot-password, sign-in, refresh from the web app only, sign-out; an IPv6 client counted by its /64 |
| `oauth-http` | Postgres, Redis, Mailpit | Google sign-in against the fake OpenID Connect provider (`fake-oidc-issuer.ts`): a valid ID token signs in; one for another sign-in, another app, or signed with an unknown key is refused |
| `account-lifecycle` | Postgres, Redis | concurrent avatar swaps; one of several deletion requests recorded; the sweep deletes only accounts whose 14 days are over, erasing their data at once; a restore or a completion against the sweep, never both winning; two accounts made for one address at once become one |
| `account-deletion` | Postgres, Redis, Mailpit | deleting over HTTP (D-141): `deletes_at` and every session ended; another device told `account_deleted` with the date; signing in again by password, code or Google reaches the same account, which can only restore itself; restore; the username held while waiting; after 14 days the address makes a new account |
| `profile-http` | Postgres, Redis, Mailpit | `PATCH /users/me` and the avatar routes over HTTP: names counted in characters (decomposed Vietnamese, emoji), a name that would look empty or `null` refused; a JPG, PNG or WEBP avatar taken and removed (twice answers the same); a GIF refused by declared type or by its bytes (415); a file over 8 MB refused with `UPLOAD_FILE_TOO_LARGE` (413) |
| `settings-http` | Postgres, Redis, Mailpit | `GET` and `PATCH /users/me/settings` over HTTP: the values from completing the account and the defaults; a choice kept for the next browser; an unknown value or a switch sent as a string refused; the time zone changed once, then `429` with `reason: "timezone"`, `changeable_at` and `Retry-After`; of two zone changes at once, one wins |
| `servers-http` | Postgres, Redis, Mailpit | servers made from a template, the creator their owner; one server for one `Idempotency-Key` sent twice; one of two racing requests makes the 100th server; a deleted server not counted; a member shown only the channels they may see; the icon taken from those who manage the server only |
| `server-settings-http` | Postgres, Redis, Mailpit | rename for those who manage the server; the welcome channel moved to a text channel they see, or none (D-83); never a channel deleted while it was being chosen |
| `channel-layout-http` | Postgres, Redis, Mailpit | names stored as REQ-SRV-02 says, clashes refused; only `MANAGE_CHANNELS` changes the list; private channels shown to their roles and the owner; one channel per drop (D-149); two changes to one server wait for each other |
| `invites-http` | Postgres, Redis, Mailpit | the same link handed out again; the public invite page; one join, one use; one of two people racing takes the last use; banned or at 100 servers refused without a use; revoke; more than 30 wrong codes a minute from one network refused |
| `roles-http` | Postgres, Redis, Mailpit | a role given and taken back shows or hides its private channel at once; a manager held to roles below theirs and permissions they hold (REQ-ROLE-02); an order made from a changed list refused; members found without accents or by role (D-152) |
| `moderation-http` | Postgres, Redis, Mailpit | kick, ban and unban, timeout to viewing only (D-154); ADMINISTRATOR never timed out (D-147); a ban racing a join never leaves both; members sorted by role and joining day (D-89); members' and banned people's pictures as addresses, not storage keys; a ban's `delete_message_days` other than 0, 1 or 7 refused (D-181); the members who view a channel (`channel_id`: a private channel's roles, ADMINISTRATOR, the owner), not found to who does not view it (D-192) |
| `membership-http` | Postgres, Redis, Mailpit | leaving, deleting and handing over a server, each refused or seen from the very next request; the owner may not leave; a deleted server's invites stop; the picker of the next owner (`transferable`, owner only); `member_count`; deleting an account refused while it owns a server with others, the invites of servers it owns alone stopped (D-121); a deleted account out of its servers, by the event or by the daily clean-up, the invite page not counting it; the bans held against a deleted account forgotten, by the event or by the daily clean-up, those it made of others kept (D-162); servers deleted for good after 30 days |
| `permissions` | Postgres, Redis | the cached server and member served until `serverChanged` / `memberChanged`; someone outside the server not remembered; a timeout and the role bits back from Redis as they went in; private channels |
| `realtime` | Postgres, Redis, Mailpit | the socket over the whole app: a ticket only for a signed-in request, kept 30 seconds, spent once even by two sockets at once, refused when made up or when its session ended; the rooms of the person, their servers and the channels they may view, not a private one; data in snake_case; signing out tells that session's sockets `session.revoked` and cuts them off, the person's other sessions untouched |
| `messaging-http` | Postgres, Redis, Mailpit | sending and reading over HTTP: `message.created` to the channel's sockets with the nonce; one message and one event for a nonce sent three times; an emoji counted as one character; not found for a private channel, a voice room, an unknown id or a stranger; managers only and a timeout (with its end) refused, reading still allowed; the 6th message in 5 seconds refused with `Retry-After` while others send; history pages by `before`, `after`, `around`, one starting point only; a text typed with accents apart kept composed and counted per letter, blank lines after 2000 characters not counted; two racing sends of one nonce make one message and one event; a deleted message left out of history; a system message's `system_data` kept; editing (`message.updated`, the reply lines quoting it), refused to others, an empty text and a hidden message; soft deletion in one transaction (text, mentions, reactions, pin, files let go; `message.deleted`); MANAGE_MESSAGES deleting another's message; a timed-out author refused both, with the same end; a retried nonce of a deleted message not found; the repository's second delete or edit of a deleted row refused; replies quoting the original as it now is, deleted included, refused across channels, to an unknown id or a system message |
| `reactions-pins-http` | Postgres, Redis, Mailpit | reactions and pins over HTTP: an emoji given once, each reader's `me`, `reaction.added` / `reaction.removed` once to the channel; the tooltip's first three names in order; not one standard emoji, a system message, a hidden channel refused; 20 emoji and 50 pins held when two requests race (two concurrent requests, one 409); no reaction or pin left on a message deleted at the same moment; without `ADD_REACTIONS` only emoji already there; a pin with its system message heard as `message.created`, pins listed latest first, unpinning with no system message; a timeout refuses giving and taking off; a ban with 7 days of messages (D-181, last in the file): the job deletes the member's regular messages of the week in each channel with their pin, reactions and mentions, keeps older ones, later ones and their system messages, and each channel hears `message.bulk_deleted` |
| `tasks-http` | Postgres, Redis, Mailpit | Task Boards over HTTP: the switch in the channel settings (MANAGE_CHANNELS; off hides the tasks with `task_board_disabled`, on shows them again, D-189); who may make, edit, delete, change the status and add or take off people; a member timed out viewing only; due dates (D-96); one of two creates at once makes the 500th; the board's order, the count of done tasks, the search without accents taking `%` and `_` as typed; the done group 50 at a time, a reopened cursor `CONFLICT_ERROR`; the history newest first by whom; `task.created/updated/deleted` to the channel, none when nothing changed; `views_channel` false once a channel turns private, a member who leaves taken off by the `tasks` queue with a line by no one, a creator who left `left_server` (D-194, D-195); inbox items of tasks (given by someone else, not taking it on oneself, the creator told when the last one takes themselves off), the reminders' jobs set, moved and dropped with the due date and status, a reminder's items written once and its `task_due` message naming the people, a deleted task's `notification.deleted` with `task_id` (D-98, D-95, D-200, REQ-TASK-04) |
| `voice-http` | Postgres, Redis, Mailpit, LiveKit | voice rooms (D-204 to D-210): one `VoiceState` row per person, one person sharing a screen per room (D-101), a deleted room emptied; LiveKit takes the join tokens `MEDIA_ROOMS` signs (also listen-only ones) and refuses one signed with another secret, lists nobody in a room it never heard of, and putting out someone not there changes nothing; `POST /voice/token` by permission (the claims read back, listen-only and FORBIDDEN as @everyone changes, MEMBER_TIMED_OUT, not found for a private room, a text channel, no channel) and one connection per account; webhooks signed by the test with the LiveKit key pair: refused unsigned, with another secret or a changed body, taken once by id, out of order ignored, a move between rooms; the lists in `GET /servers` and `voice_state.updated`, a private room's to its viewers only; `POST /voice/leave`; the reconciliation; `voice.self_state` over a socket; screens shared (D-101): marked and unmarked by `track_published` / `track_unpublished`, a screen's sound, a camera and an old connection left alone, a second screen in the room refused with `voice.share_rejected` naming who shares, another room's own screen, the next one taken once the first stops |
| `rate-limiter` | Redis | exactly `limit` hits pass when many arrive at once |
| `s3-storage` | RustFS | a private bucket refuses an unsigned URL and serves a signed one |

Shared setup (Mailpit polling, booting the app) is in
[test/integration/helpers.ts](../test/integration/helpers.ts).

The manual checks that no suite can make (real Google, real SMTP) and how the
auth tests are built are in [in-the-code.md](./auth/in-the-code.md).

## Test Structure

```
├── src/
│   └── **/*.spec.ts                 # Unit tests (next to source files)
├── test/
│   ├── setup.ts                     # Shared test environment setup
│   ├── esm-transform.js             # Compiles ESM-only dependencies, for every config
│   ├── jest-e2e.config.js           # Config for test/e2e/
│   ├── jest-integration.config.js   # Config for test/integration/
│   ├── run-integration.cjs          # pnpm test:integration: Jest twice, with and without VM modules
│   ├── e2e/
│   │   └── *.e2e-spec.ts            # Self-contained, need nothing running
│   └── integration/
│       ├── global-setup.ts          # Fails fast if a service is unreachable
│       ├── fake-oidc-issuer.ts      # A stand-in for Google's OpenID Connect
│       ├── helpers.ts               # Boot the app, poll Mailpit for a code
│       ├── targets.ts               # Service addresses, overridable with TEST_*
│       └── *.integration-spec.ts    # Need Postgres / Redis / RustFS / Mailpit
├── scripts/
│   └── idempotency-race.ts          # Manual tools — not run by any test command
├── jest.config.js                   # Unit test configuration
└── coverage/                        # Coverage reports (generated)
```

---

## Testing in Hexagonal Architecture

Hexagonal architecture makes testing easy because **business logic has zero infrastructure dependencies**. Command handlers, event handlers, and query handlers only depend on port interfaces — which are trivially mockable.

### What to Test Per Layer

| Layer | What to Test | How | Priority |
|---|---|---|---|
| **Domain** | Entity constructors, getters, business rules | Pure unit tests (no mocks) | 🟡 Medium |
| **Application** | Command/Query/Event handlers | Mock ports + EventBus | 🔴 **High** |
| **Infrastructure** | Mappers, complex adapters | Unit test mappers; integration test repos | 🔴 **High** (mappers) |
| **Presentation** | Exception filters, controllers | Mock CommandBus/QueryBus | 🟡 Medium |

### What NOT to Test

- **Port interfaces** — Just TypeScript types, nothing to execute
- **Command/Query/Event data classes** — Pure data carriers, no logic
- **Simple domain exceptions** — Trivial `extends Error` classes
- **Thin adapters** — Adapters that just delegate to a shared service (e.g., `UploadStorage`, which passes calls on to `UploadService`)

### The Port Mocking Pattern

This is the core pattern for every handler test. Instead of mocking Prisma or Redis directly, you mock the **port interface**:

```typescript
// 1. Create mock objects matching the port interface
const mockUserRepo = {
    update: jest.fn(),
}

// 2. Provide them using the port injection token
const module = await Test.createTestingModule({
    providers: [
        UpdateProfileHandler,
        { provide: USER_REPOSITORY, useValue: mockUserRepo },   // ← Port mock
        { provide: EventBus, useValue: { publish: jest.fn() } },     // ← CQRS mock
    ],
}).compile()

// 3. Control behavior per test
mockUserRepo.update.mockResolvedValue(updatedUserEntity)
```

**Why this works:** The handler only knows about `UserRepositoryPort` — it never imports Prisma, Redis, or any framework. Swapping the real adapter for a mock is seamless.

### Testing Event Publishing

Command handlers often publish domain events. Verify them by mocking `EventBus`:

```typescript
const mockEventBus = { publish: jest.fn() }

// After executing the command...
expect(mockEventBus.publish).toHaveBeenCalledWith(
    new UserProfileUpdatedEvent(userId)
)
```

For event handlers that **receive** events, test them directly. For example
the auth module's `RefreshCachedUserHandler`
([`events/handlers/`](../src/modules/auth/application/events/handlers/)),
which drops the cached user when the users module says the profile changed:

```typescript
const mockCache = { invalidateUser: jest.fn() }
const handler = new RefreshCachedUserHandler(mockCache as unknown as SessionCachePort)

await handler.handle(new UserProfileUpdatedEvent('user-123'))

expect(mockCache.invalidateUser).toHaveBeenCalledWith('user-123')
```

### Test File Locations

Tests live **next to the source file** they test:

```
modules/
├── auth/domain/
│   ├── password-policy.ts
│   └── password-policy.spec.ts          ← Domain test
├── auth/infrastructure/adapters/
│   ├── jose-token-service.adapter.ts
│   └── jose-token-service.adapter.spec.ts   ← Adapter test
└── users/application/commands/upload-avatar/
    ├── upload-avatar.handler.ts
    └── upload-avatar.handler.spec.ts    ← Handler test
```

Domain errors have no per-module filter: one shared `DomainExceptionFilter`
([`domain-exception.filter.ts`](../src/shared/presentation/filters/domain-exception.filter.ts))
maps every module's errors to HTTP.

---

## Writing Tests

### Unit Test Example

```typescript
// src/shared/utils/example.util.spec.ts
import { myFunction } from './example.util'

describe('example.util', () => {
    describe('myFunction', () => {
        it('should return expected value', () => {
            const result = myFunction('input')
            expect(result).toBe('expected')
        })
    })
})
```

### Command Handler Test Example (with port mocking)

The pattern, for a handler whose bug would matter (here: of two "complete
your account" submissions at once, only one may win; the conditional write in
the repository decides, and the handler must turn "nothing was updated" into
`ACCOUNT_ALREADY_COMPLETE`):

```typescript
import { Test, TestingModule } from '@nestjs/testing'
import { CompleteAccountHandler } from './complete-account.handler'
import { CompleteAccountCommand } from './complete-account.command'
import { USER_DIRECTORY } from '@/modules/users'
import { AccountAlreadyCompleteError, CREDENTIAL_REPOSITORY } from '@/modules/auth/domain'
import { AUTH_MAILER, PASSWORD_HASHER, SESSION_CACHE } from '../../ports'

describe('CompleteAccountHandler', () => {
    let handler: CompleteAccountHandler
    let directory: { findById: jest.Mock; complete: jest.Mock }
    let cache: { invalidateUser: jest.Mock }
    const form = {
        displayName: 'Ada',
        username: 'ada',
        password: 'Harbour-Lantern-42',
        timezone: 'Asia/Ho_Chi_Minh',
        language: 'en' as const
    }

    beforeEach(async () => {
        directory = { findById: jest.fn(), complete: jest.fn() }
        cache = { invalidateUser: jest.fn() }

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CompleteAccountHandler,
                { provide: USER_DIRECTORY, useValue: directory },
                // The password is written by directory.complete, in its transaction.
                { provide: CREDENTIAL_REPOSITORY, useValue: { findHash: jest.fn().mockResolvedValue(null) } },
                { provide: PASSWORD_HASHER, useValue: { hash: jest.fn().mockResolvedValue('hash') } },
                { provide: SESSION_CACHE, useValue: cache },
                { provide: AUTH_MAILER, useValue: { sendPasswordChanged: jest.fn() } }
            ]
        }).compile()

        handler = module.get(CompleteAccountHandler)
    })

    it('answers ACCOUNT_ALREADY_COMPLETE when another submission completed it first', async () => {
        // Read as not completed, but the conditional UPDATE found nothing to update.
        directory.findById.mockResolvedValue({ id: 'user-123', email: 'ada@example.com', completedAt: null, deletedAt: null })
        directory.complete.mockResolvedValue(null)

        await expect(handler.execute(new CompleteAccountCommand('user-123', form))).rejects.toBeInstanceOf(
            AccountAlreadyCompleteError
        )
        expect(cache.invalidateUser).not.toHaveBeenCalled()
    })
})
```

The real tests of this handler use the auth module's in-memory fakes instead
of `jest.fn()` mocks
([`complete-account.spec.ts`](../src/modules/auth/application/commands/complete-account.spec.ts)),
and the race itself, two `complete()` calls at once against Postgres, is in
[`account-lifecycle.integration-spec.ts`](../test/integration/account-lifecycle.integration-spec.ts).

### E2E Test Example

An e2e suite must need nothing running, so it does **not** import the whole
`AppModule` (that would connect to Postgres and Redis). It builds a module
around one controller, with fake buses and ports, as
`openapi-contract.e2e-spec.ts` does:

```typescript
// test/e2e/example.e2e-spec.ts
import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import request from 'supertest'
import { UsersController } from '@/modules/users/presentation/http/users.controller'
import { STORAGE } from '@/modules/users/application/ports/storage.port'
import { SnakeToCamelPipe, createValidationPipe } from '@/shared/presentation/pipes'

describe('Users (e2e)', () => {
    let app: INestApplication
    const commandBus = { execute: jest.fn() }
    const queryBus = { execute: jest.fn().mockResolvedValue(true) }

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            controllers: [UsersController],
            providers: [
                { provide: CommandBus, useValue: commandBus },
                { provide: QueryBus, useValue: queryBus },
                { provide: ConfigService, useValue: { get: () => 'http://localhost:8888' } },
                { provide: STORAGE, useValue: { getReadUrl: async (key: string) => key } }
            ]
        }).compile()

        app = moduleRef.createNestApplication()
        // What the access-token guard would attach: a signed-in user.
        app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
            req.user = { id: 'user-1', email: 'ada@example.com' }
            next()
        })
        // The same global pipes main.ts uses: snake_case in, validation.
        app.useGlobalPipes(new SnakeToCamelPipe(), createValidationPipe())
        await app.init()
    })

    afterAll(async () => {
        await app.close()
    })

    it('checks the normalised form of a valid username', async () => {
        // No global prefix in this small app: the real API serves it under /api/v1.
        await request(app.getHttpServer()).get('/users/username-available/Alice_1').expect(200)

        const [query] = queryBus.execute.mock.calls[0]
        expect(query.username).toBe('alice_1')
    })
})
```

To test with real tokens and the real guard, write an integration suite
instead: `auth-http.integration-spec.ts` builds the whole `AppModule` against
the test services.

---

## Common Jest Matchers

```typescript
// Equality
expect(value).toBe(5)                    // Strict equality (===)
expect(value).toEqual({ a: 1 })          // Deep equality for objects
expect(value).not.toBe(5)                // Negation

// Truthiness
expect(value).toBeTruthy()
expect(value).toBeFalsy()
expect(value).toBeNull()
expect(value).toBeUndefined()
expect(value).toBeDefined()

// Numbers
expect(value).toBeGreaterThan(3)
expect(value).toBeLessThan(5)
expect(value).toBeCloseTo(0.3, 1)        // Floating point

// Strings
expect(value).toMatch(/pattern/)
expect(value).toContain('substring')

// Arrays
expect(array).toContain('item')
expect(array).toHaveLength(3)

// Objects
expect(obj).toHaveProperty('key')
expect(obj).toHaveProperty('key', 'value')

// Exceptions
expect(() => fn()).toThrow()
expect(() => fn()).toThrow('error message')

// Async
await expect(promise).resolves.toBe(5)
await expect(promise).rejects.toThrow()
```

---

## Code Coverage

Run with coverage:

```bash
pnpm test:cov
```

Coverage report is generated in `./coverage/` directory. Open `coverage/lcov-report/index.html` in a browser to see detailed report.

**Target Coverage:** 60-80% is usually sufficient for most projects.

---

## Best Practices

1. **Test behavior, not implementation** - Focus on what the function does, not how
2. **One assertion per test** - Makes failures easier to debug
3. **Use descriptive test names** - `it('should return null when user not found')`
4. **AAA Pattern** - Arrange, Act, Assert
5. **Mock external dependencies** - Database, HTTP calls, etc.
6. **Keep tests fast** - Unit tests should run in milliseconds
7. **Don't test framework code** - Trust that NestJS, Prisma work correctly

---

## Troubleshooting

### "Reflect.getMetadata is not a function"
Ensure `reflect-metadata` is imported in `test/setup.ts`

### Tests timing out
Increase `testTimeout` in `jest.config.js` or use `jest.setTimeout()` in tests

### Module not found errors
Check `moduleNameMapper` in `jest.config.js` matches your `tsconfig.json` paths

---

## What this page does not cover

These tests check that the code is correct. They say nothing about how much
traffic it can take, which is a different question with different tools — see
[load-testing.md](./load-testing.md).
