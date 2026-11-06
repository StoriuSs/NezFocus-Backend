# The auth module in the code

Where everything in the auth set lives in `src/modules/auth/`, how a request
moves through it, what it stores in Postgres and Redis, what it measures, how
it is tested, and how to extend it. Read this when you are about to change the
module, or when you need to find the file behind a behaviour. For what the
module does from the outside, start at [README.md](./README.md).

The module follows the starter's hexagonal layout: the core (domain and
application) never names a library, and every outside thing (Postgres, Redis,
argon2, Google) sits behind an interface it owns. If "port" and "adapter" are
new words, read [hexagonal-architecture.md](../hexagonal-architecture.md)
first; for commands and handlers, [cqrs-guide.md](../cqrs-guide.md).

- [Module layout](#module-layout)
- [How a request travels](#how-a-request-travels)
- [Ports and adapters](#ports-and-adapters)
- [Routes, commands and handlers](#routes-commands-and-handlers)
- [Application services](#application-services)
- [Events: how auth and users meet](#events-how-auth-and-users-meet)
- [Jobs and schedules](#jobs-and-schedules)
- [Redis keys](#redis-keys)
- [Prisma tables](#prisma-tables)
- [Metrics, alerts and logs](#metrics-alerts-and-logs)
- [Tests](#tests)
- [Extending the module](#extending-the-module)

## Module layout

```
src/modules/auth/
├── domain/                       pure TypeScript, no Nest, no libraries
│   ├── errors/                   every error the module throws, as DomainError subclasses, by topic
│   ├── ports/                    the four repository ports (credential, session, codes, Google links)
│   ├── password-policy.ts        the password rules (a client may copy this file)
├── application/
│   ├── commands/<name>/          one folder per operation: <name>.command.ts and <name>.handler.ts
│   ├── queries/<name>/           the same for the two queries
│   ├── events/handlers/          reacting to the users module (account deleted, profile changed)
│   ├── services/                 shared steps: sign-in gate, session issuer, codes, limits, ...
│   ├── ports/                    the outside services the handlers need (one file each)
│   ├── rate-limits.ts            every auth limit, in one table
│   ├── auth-settings.ts          lifetimes and attempt counts (AUTH_SETTINGS)
│   └── oauth-settings.ts         the callback base URL and attempt lifetime (OAUTH_SETTINGS)
├── infrastructure/
│   ├── adapters/                 *.adapter.ts: argon2, jose, openid-client, Redis, BullMQ,
│   │                             Prometheus
│   ├── email/                    auth-emails.ts (sends each email), email-copy.ts (the words, per
│   │                             language) and templates/email.hbs (the one layout)
│   └── persistence/              prisma-*.repository.ts, one per repository port
├── presentation/
│   ├── http/                     the /auth routes in four *.controller.ts, by topic (below); auth-cookies.ts;
│   │                             dto/ holds one request or response class per file
│   ├── guards/access-token.guard.ts  the global bearer-token check
│   └── consumers/auth-jobs.consumer.ts  the `auth` queue worker: sends the emails
├── index.ts                      what the rest of the app may import (the access-token guard, the clean-up command)
└── auth.module.ts                wiring: which adapter answers which port
```

Outside the folder, auth also owns:

| File | What |
|---|---|
| [prisma/models/auth.prisma](../../prisma/models/auth.prisma) | Its five tables ([below](#prisma-tables)) |
| [src/config/auth.config.ts](../../src/config/auth.config.ts) | Reads the `JWT_*`, `AUTH_*` and `GOOGLE_*` variables |
| [src/config/validation.ts](../../src/config/validation.ts) | Refuses bad values at start-up (key lengths, pairs, production rules) |
| [src/bootstrap/user-roles.ts](../../src/bootstrap/user-roles.ts) | The CLI `pnpm user:promote` |
| [src/shared/infrastructure/rate-limit/rate-limiter.ts](../../src/shared/infrastructure/rate-limit/rate-limiter.ts) | The shared Redis counter the auth limits use |
| [src/shared/infrastructure/cache/versioned-cache.ts](../../src/shared/infrastructure/cache/versioned-cache.ts) | The cache that cannot be put back stale, used by the session check |
| [src/shared/infrastructure/email/](../../src/shared/infrastructure/email/) | `EmailService`, which delivers auth's emails over SMTP ([emails.md](./emails.md)) |
| [src/maintenance/maintenance-tasks.ts](../../src/maintenance/maintenance-tasks.ts) | When the hourly clean-up runs ([below](#jobs-and-schedules)) |
| [src/shared/constants/error-response.ts](../../src/shared/constants/error-response.ts) | Error codes and types ([api-reference.md](./api-reference.md#error-catalogue)) |
| [src/shared/constants/sensitive-fields.ts](../../src/shared/constants/sensitive-fields.ts) | Fields and query parameters redacted from logs and Sentry |

**The users module does not know auth exists.** The user row (address,
`completedAt`, roles, profile) belongs to users. Auth imports only what
users publishes in [src/modules/users/index.ts](../../src/modules/users/index.ts)
(an ESLint rule refuses anything deeper): the `USER_DIRECTORY` port
([user-directory.port.ts](../../src/modules/users/application/ports/user-directory.port.ts)),
the events it reacts to, `DeleteAccountCommand`, and `normaliseEmail`.

## How a request travels

Every route follows the same path:

```
A controller method           presentation/http/<topic>.controller.ts
  → sends a command            e.g. new LoginCommand(email, password, client)
    → its handler.execute()    application/commands/<name>/<name>.handler.ts
      → calls ports            interfaces in domain/ports/ (repositories) and application/ports/
        → adapters do the work classes in infrastructure/, bound in auth.module.ts
```

A handler never says "Prisma" or "Redis". It asks for, say,
`SESSION_REPOSITORY`, and gets whatever
[auth.module.ts](../../src/modules/auth/auth.module.ts) binds to that name
(`{ provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository }`). To find
the code behind a port, look it up in that file's providers.

Errors go the other way. A handler throws a `DomainError` subclass from
[domain/errors/](../../src/modules/auth/domain/errors/) with a `kind`
(`invalid`, `unauthenticated`, `forbidden`, `conflict`, `unprocessable`,
`rate_limited`, `unavailable`, `not_found`) and an `errorKey`. The shared
[domain-exception.filter.ts](../../src/shared/presentation/filters/domain-exception.filter.ts)
turns the kind into the HTTP status, the key into `meta.code` and `meta.type`,
the error's `details` into snake_case `data` fields, and a
`retryAfterSeconds` into the `Retry-After` header.

The controllers do the HTTP-only parts themselves: the redirects of the
Google routes, and the cookies (set, clear, read) and the `Origin` check on
the cookie routes, through [auth-cookies.ts](../../src/modules/auth/presentation/http/auth-cookies.ts).

**Guards on every request.** [app.module.ts](../../src/app.module.ts)
registers the global guards in this order: request context, the throttler,
`AccessTokenGuard`, `RolesGuard`. The throttler comes before the auth guard so
anonymous floods are limited before any token work.
[access-token.guard.ts](../../src/modules/auth/presentation/guards/access-token.guard.ts):

1. `@Public()` on the route: let it through.
2. Read `Authorization: Bearer <token>`. None: `AUTH_TOKEN_MISSING`.
3. `TOKEN_SERVICE.verifyAccessToken()`: signature, issuer, audience, expiry,
   `typ: "access"`. No database yet.
4. `PRINCIPAL.resolve()` (`RedisSessionCache`): one Redis round trip for the
   session and the user, Postgres on a miss. Ended session: 401; deleted
   account: 403.
5. The account's `completedAt` is empty and the route has no
   `@AllowIncomplete()`
   ([allow-incomplete.decorator.ts](../../src/shared/presentation/decorators/allow-incomplete.decorator.ts)):
   `403 ACCOUNT_INCOMPLETE` (D-61). Read from the account step 4 loaded, not
   from a token claim (D-128). Marked: `POST /auth/complete-account`,
   `GET /users/me`, `GET /users/username-available/:username`.
6. Put the user on `request.user` (with `completed`): what `@CurrentUser()`
   returns and what `@Roles()` checks.

[sessions-and-tokens.md](./sessions-and-tokens.md) explains why step 4 makes
sign-out immediate.

## The controllers

The /auth routes are in four controllers, one per topic, all under the same
`auth` path: the URLs, the Swagger tag and the web app are the same as with
one controller. Each method stays a few lines: decorators, one bus call, the
answer.

| Controller | Routes under `/api/v1/auth` |
|---|---|
| [auth.controller.ts](../../src/modules/auth/presentation/http/auth.controller.ts) | `email-code`, `email-code/verify`, `login`, `refresh`, `logout`, `complete-account`, `logout-all`, `options` |
| [password.controller.ts](../../src/modules/auth/presentation/http/password.controller.ts) | `forgot-password`, `reset-password`, `change-password`, `sign-in-methods` |
| [account-deletion.controller.ts](../../src/modules/auth/presentation/http/account-deletion.controller.ts) | `account/delete` |
| [oauth.controller.ts](../../src/modules/auth/presentation/http/oauth.controller.ts) | `:provider`, `:provider/callback` (Google) |

What they share is beside them: [auth-cookies.ts](../../src/modules/auth/presentation/http/auth-cookies.ts)
(`AuthCookies`, a provider: the two cookies, `signedIn`, the `Origin`
check) and [route-helpers.ts](../../src/modules/auth/presentation/http/route-helpers.ts) (`client`, `ok`,
`accepted`). A cookie is often set in one controller and read in another:
the Google return sets the refresh cookie, and `refresh` reads it.

**The order they are registered in matters.** `GET auth/:provider` has a
parameter where the others have a word, so it matches any `GET auth/<word>`:
`auth/google`, but also `auth/options` and
`auth/sign-in-methods`. Express tries the routes in the order they were
registered and takes the first that matches, and Nest registers them
controller by controller, in the order of the module's `controllers`. With
OAuthController first, `GET /auth/options` would be a sign-in with a provider
called "options", answered 404, and the sign-in page would never see which
providers are on. So the list is `AUTH_CONTROLLERS` in
[presentation/http/index.ts](../../src/modules/auth/presentation/http/index.ts), with OAuthController last, and
[auth-routes.e2e-spec.ts](../../test/e2e/auth-routes.e2e-spec.ts) fails if it
moves (it also shows the wrong order going wrong). In one controller the same
rule held between its methods, which is why the Google routes were at the end
of the file. A new GET route under `/auth` with a fixed path goes in any
controller but OAuthController, and in `STATIC_GETS` in that test.

## Ports and adapters

Every binding in [auth.module.ts](../../src/modules/auth/auth.module.ts). The
repository ports are in [domain/ports/](../../src/modules/auth/domain/ports/), the
others in [application/ports/](../../src/modules/auth/application/ports/).

| Token | Port (what a handler asks for) | Adapter | Library |
|---|---|---|---|
| `PASSWORD_HASHER` | Hash, verify, "needs rehash", a dummy verify for unknown addresses | [argon2-password-hasher.adapter.ts](../../src/modules/auth/infrastructure/adapters/argon2-password-hasher.adapter.ts) | `@node-rs/argon2` |
| `TOKEN_SERVICE` | Issue and verify access tokens; make refresh tokens; hash refresh tokens and emailed codes | [jose-token-service.adapter.ts](../../src/modules/auth/infrastructure/adapters/jose-token-service.adapter.ts) | `jose` |
| `CREDENTIAL_REPOSITORY` | The password hash | [prisma-credential.repository.ts](../../src/modules/auth/infrastructure/persistence/prisma-credential.repository.ts) | Prisma |
| `SESSION_REPOSITORY` | Sessions and refresh tokens: create, rotate (row lock), revoke, find, clean up | [prisma-session.repository.ts](../../src/modules/auth/infrastructure/persistence/prisma-session.repository.ts) | Prisma |
| `VERIFICATION_CODE_REPOSITORY` | The live emailed code per address and purpose: `replace`, `check` (counts the try in one `UPDATE … RETURNING`), `use` (only if the hash still matches and it is unused, so an older code cannot use up a newer one), `deleteStale` | [prisma-verification-code.repository.ts](../../src/modules/auth/infrastructure/persistence/prisma-verification-code.repository.ts) | Prisma |
| `OAUTH_ACCOUNT_REPOSITORY` | Provider links (`provider`, `sub` → user) | [prisma-oauth-account.repository.ts](../../src/modules/auth/infrastructure/persistence/prisma-oauth-account.repository.ts) | Prisma |
| `OAUTH_STATE` | An OAuth attempt while the browser is at Google, taken once | [redis-oauth-state.adapter.ts](../../src/modules/auth/infrastructure/adapters/redis-oauth-state.adapter.ts) | Redis |
| `OAUTH_PROVIDERS` | The configured providers (an array): `start()` and `finish()` | [openid-connect-provider.adapter.ts](../../src/modules/auth/infrastructure/adapters/openid-connect-provider.adapter.ts), one instance per provider, built from config in `auth.module.ts` | `openid-client` |
| `AUTH_MAILER` | Queue each email | [bullmq-auth-mailer.adapter.ts](../../src/modules/auth/infrastructure/adapters/bullmq-auth-mailer.adapter.ts) | BullMQ |
| `AUTH_EVENTS` | Count an event | [prometheus-auth-events.adapter.ts](../../src/modules/auth/infrastructure/adapters/prometheus-auth-events.adapter.ts) | prom-client |
| `PRINCIPAL` and `SESSION_CACHE` | The per-request session check; invalidation; the refresh grace replacement | [redis-session-cache.adapter.ts](../../src/modules/auth/infrastructure/adapters/redis-session-cache.adapter.ts) (one instance answers both) | Redis, Postgres fallback |
| `RATE_LIMIT` | `hit`, `check`, `reset` a fixed-window counter | the shared [rate-limiter.ts](../../src/shared/infrastructure/rate-limit/rate-limiter.ts) | Redis (Lua) |
| `USER_DIRECTORY` | The user row, owned by the users module: find, create, `complete` (the "complete your account" write), `languageOf` (for emails nobody asked for) | [user-directory.adapter.ts](../../src/modules/users/infrastructure/adapters/user-directory.adapter.ts) | Prisma |

Settings, also provided by `auth.module.ts` from config:

| Token | Holds |
|---|---|
| `AUTH_SETTINGS` | Access-token and session lifetimes (env), code lifetime 10 min, 5 code attempts, refresh grace 10 s (hard-coded) |
| `TOKEN_KEYS` | `JWT_SECRET`, issuer and audience (both `BASE_URL`) |
| `OAUTH_SETTINGS` | Callback base `<BASE_URL>/api/v1/auth`; attempt lifetime 600 s |

## Routes, commands and handlers

Each operation is a folder under `src/modules/auth/application/commands/` (or
`queries/` for the two queries, which go through the `QueryBus`), named after
its command: `<name>.command.ts` and `<name>.handler.ts`.

| Route | Command or query | Folder |
|---|---|---|
| `POST /auth/email-code` | `SendEmailCodeCommand` | [send-email-code/](../../src/modules/auth/application/commands/send-email-code/) |
| `POST /auth/email-code/verify` | `VerifyEmailCodeCommand` | [verify-email-code/](../../src/modules/auth/application/commands/verify-email-code/) |
| `POST /auth/complete-account` | `CompleteAccountCommand` | [complete-account/](../../src/modules/auth/application/commands/complete-account/) |
| `POST /auth/login` | `LoginCommand` | [login/](../../src/modules/auth/application/commands/login/) |
| `POST /auth/refresh` | `RefreshCommand` | [refresh/](../../src/modules/auth/application/commands/refresh/) |
| `POST /auth/logout` | `LogoutCommand` | [logout/](../../src/modules/auth/application/commands/logout/) |
| `POST /auth/logout-all` | `LogoutEverywhereCommand` | [logout-everywhere/](../../src/modules/auth/application/commands/logout-everywhere/) |
| `POST /auth/forgot-password` | `ForgotPasswordCommand` | [forgot-password/](../../src/modules/auth/application/commands/forgot-password/) |
| `POST /auth/reset-password` | `ResetPasswordCommand` | [reset-password/](../../src/modules/auth/application/commands/reset-password/) |
| `POST /auth/change-password` | `ChangePasswordCommand` | [change-password/](../../src/modules/auth/application/commands/change-password/) |
| `GET /auth/sign-in-methods` | `GetSignInMethodsQuery` | [get-sign-in-methods/](../../src/modules/auth/application/queries/get-sign-in-methods/) |
| `POST /auth/account/delete` | `DeleteOwnAccountCommand` | [delete-own-account/](../../src/modules/auth/application/commands/delete-own-account/) |
| `GET /auth/{provider}` | `StartOAuthCommand` | [start-oauth/](../../src/modules/auth/application/commands/start-oauth/) |
| `GET /auth/{provider}/callback` | `FinishOAuthCommand` | [finish-oauth/](../../src/modules/auth/application/commands/finish-oauth/) |
| `GET /auth/options` | `GetAuthOptionsQuery`: reads `OAUTH_PROVIDERS` | [get-auth-options/](../../src/modules/auth/application/queries/get-auth-options/) |
| (the `maintenance` queue, hourly) | `CleanUpAuthCommand` | [clean-up-auth/](../../src/modules/auth/application/commands/clean-up-auth/) |

Each handler's doc comment says what it promises and why (for example, why
`forgot-password` stores a code nobody is sent for an address with no
account). Read it next to its tests in the scenario specs in `commands/`
(`email-code.spec.ts`, `complete-account.spec.ts`, `sessions.spec.ts`,
`passwords.spec.ts`, `google.spec.ts`, `delete-account.spec.ts`).

`DeleteOwnAccountHandler` proves who is asking, then dispatches the **users**
module's `DeleteAccountCommand`
([delete-account.handler.ts](../../src/modules/users/application/commands/delete-account/delete-account.handler.ts))
through the `CommandBus`: users owns deletion; auth only owns the proof.

## Application services

In [application/services/](../../src/modules/auth/application/services/), shared
by several handlers:

| Service | What it does | Used by |
|---|---|---|
| `SignInGate` ([sign-in-gate.ts](../../src/modules/auth/application/services/sign-in-gate.ts)) | **The only way into a session** after a first step: `pass` starts it through `SessionIssuer`, so a rule every sign-in path must follow has one place to live | login, email-code/verify, reset-password, finish-oauth |
| `SessionIssuer` ([session-issuer.ts](../../src/modules/auth/application/services/session-issuer.ts)) | Creates the `Session` row and its first refresh token, and signs the access token | `SignInGate` |
| `CodeIssuer` ([code-issuer.ts](../../src/modules/auth/application/services/code-issuer.ts)) | Codes by address (D-129). `issue(address, purpose, now, email)` makes a six-digit code, stores its HMAC (replacing any earlier one for the address and purpose) and queues the email, or sends nothing when `email` is null; `check` counts a guess as one of the code's tries; `use` uses a right code up | email-code, email-code/verify, forgot-password, reset-password |
| `SignInMethods` ([sign-in-methods.ts](../../src/modules/auth/application/services/sign-in-methods.ts)) | "Has a password? Which providers?", and a provider's display name | sign-in-methods |
| `limits.ts` ([limits.ts](../../src/modules/auth/application/services/limits.ts)) | `refuseIfLimited` (check, count nothing), `enforce` (check, then count), `withGuess` (count a guess while it is checked) | every limited handler |

One rule both a handler and an adapter need is in the domain instead,
[session-end.ts](../../src/modules/auth/domain/session-end.ts): `sessionEndReason` turns a stored revoke reason
(`logout-all`) into the API's `data.reason` (`signed_out_everywhere`). Refresh
and the session cache both use it.

## Events: how auth and users meet

Auth publishes no events of its own. It reacts to two of the users module's,
in [events/handlers/](../../src/modules/auth/application/events/handlers/):

| Event (from users) | Auth handler | What it does |
|---|---|---|
| `AccountDeletedEvent` | `EndSessionsOfDeletedAccountHandler` | Drops the cached user, revokes every session (reason `account-deleted`) and drops them from the cache, deletes the password and the provider links. A failure is only logged: the guard and refresh already refuse a deleted account, and the hourly clean-up finishes the job |
| `UserProfileUpdatedEvent` | `RefreshCachedUserHandler` | Drops the cached user, so the next request sees the new profile and roles |

In the other direction, auth calls into users through `USER_DIRECTORY`
(`findByEmail`, `findById`, `create(email, displayName)`) and the
`DeleteAccountCommand`, both from the users index. The users module also
deletes the avatar on `AccountDeletedEvent` (its own
`CleanupAccountAvatarHandler`). The full deletion chain is in
[accounts.md](./accounts.md) and [account-deletion.md](../account-deletion.md).

## Jobs and schedules

Everything slow runs on BullMQ queues, never inside the request
([BULLMQ-GUIDE.md](../BULLMQ-GUIDE.md)).

**The `auth` queue.** `BullMqAuthMailer` adds the jobs;
[auth-jobs.consumer.ts](../../src/modules/auth/presentation/consumers/auth-jobs.consumer.ts)
runs them.

| Job name | What it does |
|---|---|
| `send-code` | An emailed code: `sign-in` or `password-reset`. A job with a retired purpose (queued before an upgrade) is dropped with a warning |
| `password-changed`, `password-added`, `sign-in-method-added`, `account-deleted` | One notice email each ([emails.md](./emails.md)) |

Every job carries `language` (`vi` or `en`); a job without it, queued before
emails had a language, is sent in English.

Only emails: the clean-up runs on the `maintenance` queue (below), so a
backlog of emails never delays it.

Email jobs use `EMAIL_JOB_OPTIONS`: 3 attempts, exponential back-off from
5 seconds, removed when done, failed ones kept 24 hours. The `send-code` job
data holds the plain code and address, so anyone who can open the queue
dashboard (`/admin/queues`) can read live codes: keep `BULL_BOARD_PASSWORD`
strong.

**Schedules.** Both are lines in
[src/maintenance/maintenance-tasks.ts](../../src/maintenance/maintenance-tasks.ts),
which every module's periodic jobs share: the list says when, the module's
command says what. They live in Redis (`upsertJobScheduler`), so each tick is
one job however many app instances run.

| Queue / scheduler id | Every | Handler | What |
|---|---|---|---|
| `maintenance` / `auth-clean-up` | 1 hour | [clean-up-auth.handler.ts](../../src/modules/auth/application/commands/clean-up-auth/clean-up-auth.handler.ts) | 1. Revokes open sessions of deleted accounts and deletes their passwords and provider links (only left behind if an `AccountDeletedEvent` was lost; logs a warning when it finds any). 2. Deletes sessions ended or expired more than **7 days** ago, with their refresh tokens: a stolen token presented that week is still recognised as reuse. 3. Deletes codes expired or used more than **1 day** ago |
| `maintenance` / `deleted-accounts-sweep` (users module) | 15 minutes | users' `SweepDeletedAccountsHandler` | Erases personal data of accounts deleted more than `DELETED_ACCOUNT_RETENTION_DAYS` ago. There is no sweep of unconfirmed accounts: an account is only made once its address is confirmed (D-133) |

## Redis keys

Sessions live in Postgres, so losing Redis's data signs nobody out. It does
drop queued emails, Google sign-ins in progress and the limit counters, and some features stop while Redis is down
([sessions-and-tokens.md](./sessions-and-tokens.md)).
Key builders are in [cache-keys.ts](../../src/modules/auth/infrastructure/adapters/cache-keys.ts)
and [rate-limiter.ts](../../src/shared/infrastructure/rate-limit/rate-limiter.ts).

| Key | Value | Lives | Written by | If Redis is down |
|---|---|---|---|---|
| `auth:session:<sessionId>` | The session's user id and end | min(5 min, the session's end) | The session check, on a miss | Postgres answers instead |
| `auth:user:<userId>` | The user (roles, deleted, profile) | 5 min | The session check, on a miss | Postgres answers instead |
| `auth:session:<id>:v`, `auth:user:<id>:v` | A version number, bumped on every invalidation so a slow reader cannot put back a stale copy | 24 h | `invalidate()` in [versioned-cache.ts](../../src/shared/infrastructure/cache/versioned-cache.ts) | |
| `auth:replaced:<sha256 of old refresh token>` | The replacement refresh token, for a second tab | 10 s | Refresh | The second tab's refresh fails; it signs in again |
| `auth:oauth:<state>` | The Google attempt: provider, PKCE verifier, nonce, return path | 600 s, taken once (GETDEL) | Start a provider sign-in | Google sign-in fails (`?error=failed` or a 500 on start) |
| `rl:<limit name>:<sha256 of lower-cased subject>` | An auth limit's counter (subject = address, IP or user id; never stored in clear) | the limit's window | `RateLimiter` | Limits fail **open**: nothing is limited |
| `throttle:relaxed:<hash>`, `throttle:block:relaxed:<hash>` | The global throttler (per IP per route) | `THROTTLE_TTL` | `@nestjs/throttler` | Fails open |
| `bull:auth:*` | The `auth` queue's email jobs | per job options | BullMQ | Emails cannot be queued: routes that send one fail |

To reset the auth limits on a development machine:

```bash
docker exec redis-nezfocus-web sh -c "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del"
```

## Prisma tables

All in [prisma/models/auth.prisma](../../prisma/models/auth.prisma). Every one
but `VerificationCode` (keyed by address, not by user) cascades when its user
row is deleted. Migrations: `20260923000000_self_hosted_auth`,
`20260925000000_oauth_accounts`, `20261106000000_codes_by_email`.

| Table | One row per | Key columns | Notes |
|---|---|---|---|
| `Credential` | user with a password | `userId` (primary key), `passwordHash` (argon2id, parameters in the string), `passwordUpdatedAt` | No row = no password (an account made with Google) |
| `Session` | sign-in | `id` (the access token's `sid`), `userId`, `createdAt`, `lastUsedAt`, `expiresAt` (absolute), `revokedAt`, `revokedReason`, `userAgent` (≤ 512), `ip` | `revokedReason`: `logout`, `logout-all`, `password-changed`, `password-reset`, `reuse-detected`, `account-deleted`. Indexes `(userId, revokedAt)`, `(expiresAt)` |
| `RefreshToken` | refresh token ever issued | `tokenHash` (SHA-256, unique), `sessionId`, `expiresAt`, `usedAt`, `replacedById` | Used tokens are kept with their session: presenting one again is how theft is noticed |
| `VerificationCode` | address and purpose | `email` (normalised: trimmed, lower case), `purpose` (`sign-in`, `password-reset`), `codeHash` (HMAC of `purpose:email:code`, keyed with `JWT_SECRET`), `expiresAt`, `attempts`, `consumedAt` | Unique `(email, purpose)`: a new code replaces the old. Keyed by address, not by account (D-129): a sign-in code goes to an address that may have no account, and an address without one still gets a reset row (D-121) |
| `OAuthAccount` | provider link | `provider` (`google`), `providerAccountId` (the provider's `sub`), `userId` | Unique `(provider, providerAccountId)`. Stores the `sub`, never the address |

The user columns auth relies on (`email`, unique among live accounts
case-insensitively; `completedAt`; `roles`; `deletedAt`) are in
[users.prisma](../../prisma/models/users.prisma), owned by the users module.

## Metrics, alerts and logs

**`auth_events_total{event}`**, a Prometheus counter, counted through
`AUTH_EVENTS`. All 10 label values start at 0 when the app starts
([prometheus-auth-events.adapter.ts](../../src/modules/auth/infrastructure/adapters/prometheus-auth-events.adapter.ts)),
so the very first occurrence after a restart still shows as an increase and
can alert. The list is `AUTH_EVENT_NAMES` in
[auth-events.port.ts](../../src/modules/auth/application/ports/auth-events.port.ts).

| Event | Recorded when |
|---|---|
| `login_succeeded` | A right password, or a right sign-in code |
| `login_failed` | A wrong password or unknown address |
| `login_rate_limited` | Sign-in refused by its limits |
| `refresh_reuse_detected` | A used refresh token came back: its session was ended |
| `registration` | A right sign-in code made a new account (an address that had none) |
| `password_reset` | A password reset with a code (or a first one added that way) |
| `oauth_login_succeeded`, `oauth_login_failed` | A Google return finished, or failed with an `?error=` reason |
| `oauth_account_linked` | Google linked to an existing account |
| `account_deleted` | `POST /auth/account/delete` succeeded |

Nothing is recorded for change-password, logout or logout-all.

Also: `cache_hits_total` and `cache_misses_total` with `cache="auth_session"`
and `cache="auth_user"`, from the session check.

**Dashboard.** The NestJS API dashboard in Grafana
([nestjs-api.json](../../monitoring/grafana/provisioning/dashboards/nestjs-api.json))
has a "Sign-in and accounts" row: Sign-ins, Failed sign-ins, Refused by the
limits, Refresh token reuse, and two time series, Sign-in attempts and Account
changes ([monitoring.md](../monitoring.md)).

**Alerts**, the `auth` group in
[app.yml](../../monitoring/prometheus/rules/app.yml), tested in
[app.test.yml](../../monitoring/prometheus/tests/app.test.yml):

| Alert | Fires when | Severity |
|---|---|---|
| `AuthFailedLoginSpike` | More than 50 `login_failed` in 10 minutes, for 5 minutes | warning |
| `AuthRefreshTokenReuse` | Any `refresh_reuse_detected` in 15 minutes | warning |

The auth errors that need a person (failed emails, Google sign-in failures)
log at `error` level and so raise `AppErrorLogs`
([alerts.md](../alerts.md)). [operations.md](./operations.md#monitoring) says
what to do about each.

**Log lines worth knowing**

| Level | Message (start) | From |
|---|---|---|
| warn | `Domain exception caught` (every auth 4xx, with the error's name and message) | [domain-exception.filter.ts](../../src/shared/presentation/filters/domain-exception.filter.ts) |
| warn | `A refresh token was used twice; session ... of user ... has been ended` | [refresh.handler.ts](../../src/modules/auth/application/commands/refresh/refresh.handler.ts) |
| warn | `Could not remember a refresh token's replacement` | refresh.handler.ts (Redis write failed; only a racing second tab notices) |
| warn | `google sign-in did not complete (<reason>): <detail>` | [oauth.controller.ts](../../src/modules/auth/presentation/http/oauth.controller.ts) |
| error | `google sign-in failed: ...` (database or Redis, with the stack) | oauth.controller.ts |
| error (once a minute at most) | `Session cache unavailable, reading from the database` / `Session cache update failed` | [redis-session-cache.adapter.ts](../../src/modules/auth/infrastructure/adapters/redis-session-cache.adapter.ts) |
| error (once a minute at most) | `Rate limiting unavailable, allowing the request` | [rate-limiter.ts](../../src/shared/infrastructure/rate-limit/rate-limiter.ts) |
| warn | `... of deleted accounts: an account deletion's event was not handled` | [clean-up-auth.handler.ts](../../src/modules/auth/application/commands/clean-up-auth/clean-up-auth.handler.ts) |
| log | `Removed N ended session(s) and N old code(s)` | clean-up-auth.handler.ts |
| error | `Could not end the sessions of deleted account ...` / `Could not drop the cached copy of user ...` | [events/handlers/](../../src/modules/auth/application/events/handlers/) |

What never reaches a log or Sentry: the `Authorization`, `Cookie` and
`Set-Cookie` headers, and the body fields and query parameters listed in
[sensitive-fields.ts](../../src/shared/constants/sensitive-fields.ts)
(`password`, `current_password`, `new_password`, `code`, `secret`, Google's
`code` and `state` in the callback URL, and others), in snake and
camel case. Request bodies are not logged at all. Refresh-token reuse is the
one auth event deliberately sent to Sentry (tag `auth: refresh-reuse`, with
the user and session ids); 4xx and 503 answers never are
([error-tracking.md](../error-tracking.md)).

## Tests

```bash
pnpm test                                   # unit: every *.spec.ts under src/
pnpm test -- auth                           # only the suites whose path contains "auth"
pnpm test:e2e                               # test/e2e: the app with nothing running
pnpm test:services:up && pnpm test:integration   # test/integration: real Postgres, Redis, Mailpit
```

The pre-push hook runs the unit and e2e suites. The integration suites need
the services and run in CI ([ci.md](../ci.md)); run them yourself after
changing anything under `src/modules/auth/infrastructure/`, the controllers,
or a dependency such as `jose`, `openid-client` or `@node-rs/argon2`. More on the three kinds in [testing.md](../testing.md).

**Unit suites**

| Suites | What they prove |
|---|---|
| The command specs in [commands/](../../src/modules/auth/application/commands/): `email-code`, `sessions`, `passwords`, `google`, `delete-account` | Every handler against in-memory fakes of every port ([auth-test-world.shared-spec.ts](../../src/modules/auth/application/commands/auth-test-world.shared-spec.ts)): a code request answers the same for every address; the right code makes the account or signs in to it; only the newest code, each once; the code-email and wrong-code limits (D-134); a reset code for an address with no account wears out like a real one (D-121); one error for wrong password and unknown address; the sign-in limits, bursts included; refresh rotation and reuse; reset and change password, emails in the page's language; Google's browser check, new and linked accounts, unverified address and deleted account; deletion takes only the password |
| [limits.spec.ts](../../src/modules/auth/application/services/limits.spec.ts) | A wrong guess stays counted, a right one is given back; a burst gets no more than the limit |
| [password-policy.spec.ts](../../src/modules/auth/domain/password-policy.spec.ts) | Each rule broken on its own, the length bounds, Vietnamese letters, no common-password rule (D-29), the address or username dressed up |
| [jose-token-service.adapter.spec.ts](../../src/modules/auth/infrastructure/adapters/jose-token-service.adapter.spec.ts) | An access token for another audience, from another issuer, or past its lifetime is refused |
| [validation.spec.ts](../../src/config/validation.spec.ts) | The production refusals, auth's included (a missing, weak or template-placeholder secret) |

**E2e suite** (the controllers, nothing running)

| Suite | What it proves |
|---|---|
| [auth-routes.e2e-spec.ts](../../test/e2e/auth-routes.e2e-spec.ts) | In the order the module registers the four controllers, `GET auth/sign-in-methods` and `auth/options` reach their own handlers, not `GET auth/:provider`; with OAuthController first they would not ([the controllers](#the-controllers)) |

**Integration suites** (real Postgres, Redis and Mailpit)

| Suite | What it proves |
|---|---|
| [auth.integration-spec.ts](../../test/integration/auth.integration-spec.ts) | The adapters under concurrency: the row lock decides one rotation; reuse after the replacement was used ends the session; ten simultaneous wrong codes all count, and one of five right ones wins; an older code cannot use up the newer one that replaced it; a sign-in code and a reset code for one address stay apart; a revoked session or deleted account is refused at once even when cached, and a session revoked mid-read is not cached |
| [auth-http.integration-spec.ts](../../test/integration/auth-http.integration-spec.ts) | The whole app over HTTP: an account made with an emailed code and signed in to with the next one, in the page's language; a first password through forgot-password, sign-in with it, refresh from the web app only, sign-out; an IPv6 client counted by its /64, by the sign-in limit and the global throttler |
| [oauth-http.integration-spec.ts](../../test/integration/oauth-http.integration-spec.ts) | Google sign-in against the fake issuer: a valid ID token signs in; one for another sign-in, another app, or signed with an unpublished key is refused |
| [account-reuse.integration-spec.ts](../../test/integration/account-reuse.integration-spec.ts) | A deleted account's address signs up again, by code or by Google: a new account with a new id, both rows kept until the sweep; the old password refused |
| [account-lifecycle.integration-spec.ts](../../test/integration/account-lifecycle.integration-spec.ts) | (users) concurrent avatar swaps and deletions; two accounts made for one address at once become one; a deleted account's address gets a new account |
| [rate-limiter.integration-spec.ts](../../test/integration/rate-limiter.integration-spec.ts) | Exactly `limit` hits pass when many arrive at once |

**The fake OIDC issuer.**
[fake-oidc-issuer.ts](../../test/integration/fake-oidc-issuer.ts) is a small
OpenID Connect provider on a random local port: discovery, JWKS, and a token
endpoint that checks what Google's does (client secret, a code used once, the
redirect URI it was issued for, PKCE) before signing an RS256 ID token. There
is no login page: `approve()` plays the person, given the authorization URL
the app redirected to. `tamper` makes the next ID token wrong (nonce,
audience, signing key) to test the refusals. The tests replace
`OAUTH_PROVIDERS` with a real `OpenIdConnectProvider` pointed at it
(`allowInsecureRequests: true`, for plain http), so the same `openid-client`
checks run as in production.

## Design decisions

Questions people ask when they first read this module, and why it is the way
it is.

**Why not Passport?** Passport adds strategies (its own way to read
credentials, and its own error handling) beside the guards, decorators and
error envelope this starter already has, and translates between them. For a
password check and a JWT the API verifies itself, it adds a layer and saves
nothing. Google sign-in uses `openid-client`, the library Passport's own
OpenID strategy wraps.

### Signing keys: why a shared secret (HS256), and how to move to a key pair

Only this API verifies its access tokens, so there is no public key to hand
out: one secret (`JWT_SECRET`) both signs and checks them. When a second
service must verify them too (another API, a gateway), switch to a key pair:

1. Sign with EdDSA (Ed25519) instead of HS256, keeping the private key where
   `JWT_SECRET` is kept today.
2. Publish the public key as a JSON Web Key Set at
   `/.well-known/jwks.json`, with a key id (`kid`) in each token's header so
   a new key can be added before the old one is retired.
3. The other services verify with the published key (`jose`'s
   `createRemoteJWKSet`).

[`JoseTokenService`](../../src/modules/auth/infrastructure/adapters/jose-token-service.adapter.ts)
is the one file that signs and verifies, so it is the one file that changes.
The emailed codes' HMAC also uses `JWT_SECRET`
([passwords-and-codes.md](./passwords-and-codes.md#how-codes-are-stored)):
give it its own secret at the same time.

**Why is the access token so short-lived when revocation is immediate anyway?**
The session check on every request makes revocation immediate for *this* API
([sessions-and-tokens.md](./sessions-and-tokens.md#the-check-on-every-request)).
The short lifetime bounds the damage if a token leaks into a log or a proxy,
and it is what makes refresh (and so reuse detection) happen regularly.

**Why not keep the access token in `localStorage`?** Any script on the page can
read `localStorage`, so one XSS bug would hand over the token. In memory, it
dies with the tab; the httpOnly refresh cookie brings the session back on
reload.

**Why are the roles not in the token?** A demoted administrator would stay one
until the token expired. The guard reads them fresh on every request (cached
for at most five minutes, and dropped at once when they change).

## Extending the module

### Another OpenID Connect provider

Microsoft, Apple, GitLab, Okta and most others speak OpenID Connect, so the
existing adapter works with their issuer URL. The routes, linking rules,
emails and sessions are shared.

1. **Config.** In [auth.config.ts](../../src/config/auth.config.ts) add
   `microsoft: { clientId, clientSecret }` read from `MICROSOFT_CLIENT_ID` and
   `MICROSOFT_CLIENT_SECRET`. In [validation.ts](../../src/config/validation.ts)
   add both keys (`Joi.string().trim().allow('').optional()`) and a line in
   `PAIRED_KEYS`, so one without the other fails at boot. Add them to
   `.env.example` ([environment.md](../environment.md#adding-a-variable)).
2. **Provider.** In [auth.module.ts](../../src/modules/auth/auth.module.ts),
   inside the `OAUTH_PROVIDERS` factory:

   ```ts
   if (microsoft.clientId && microsoft.clientSecret) {
       providers.push(
           new OpenIdConnectProvider({
               id: 'microsoft',
               displayName: 'Microsoft',
               issuer: 'https://login.microsoftonline.com/common/v2.0',
               clientId: microsoft.clientId,
               clientSecret: microsoft.clientSecret
           })
       )
   }
   ```

3. **Register the redirect URI** with the provider: exactly
   `<BASE_URL>/api/v1/auth/microsoft/callback`.
4. **The web app** gets `"microsoft"` in `GET /auth/options` and shows a
   button that navigates to `/api/v1/auth/microsoft`.
5. **Test** it in `oauth-http.integration-spec.ts` against a second
   `FakeOidcIssuer`.

The `id` is in the URL and in every stored `OAuthAccount` row: never rename it
once people have signed in with it. Check that the provider sets
`email_verified` honestly: an unverified address is refused, and linking by a
verified one is what makes linking safe ([google-sign-in.md](./google-sign-in.md)).

**A provider that is not OpenID Connect** (GitHub has no ID token) needs its
own adapter implementing
[oauth-provider.port.ts](../../src/modules/auth/application/ports/oauth-provider.port.ts):

```ts
export class GitHubProvider implements OAuthProviderPort {
    readonly id = 'github'
    readonly displayName = 'GitHub'

    async start(redirectUri: string) {
        // state and a PKCE verifier (no nonce: there is no ID token to carry it)
        const checks = { state: randomToken(), nonce: '', codeVerifier: randomToken() }
        const url = new URL('https://github.com/login/oauth/authorize')
        url.search = new URLSearchParams({
            client_id: this.clientId,
            redirect_uri: redirectUri,
            scope: 'read:user user:email',
            state: checks.state,
            code_challenge: s256(checks.codeVerifier),
            code_challenge_method: 'S256'
        }).toString()
        return { authorizationUrl: url.href, checks }
    }

    async finish(callbackUrl: URL, redirectUri: string, checks: OAuthChecks) {
        // 1. Compare callbackUrl's state with checks.state.
        // 2. POST https://github.com/login/oauth/access_token with the code, the
        //    code_verifier, the client id and secret (Accept: application/json).
        // 3. GET https://api.github.com/user          -> id, name
        // 4. GET https://api.github.com/user/emails   -> the primary address and
        //    whether it is verified (/user's email can be empty or unverified).
        return { subject: String(user.id), email: primary.email, emailVerified: primary.verified, name: user.name }
    }
}
```

`finish()` must throw on any mismatch: the handler turns a throw into
`?error=failed`.

### A new email

1. **The words**: a method on `EmailCopy` in
   [email-copy.ts](../../src/modules/auth/infrastructure/email/email-copy.ts),
   written once per language (`vi` and `en`). The type makes every language
   have every email (D-132). All emails share one layout,
   [templates/email.hbs](../../src/modules/auth/infrastructure/email/templates/email.hbs);
   a new email needs no template of its own.
2. **Sending**: a method on `AuthEmails`
   ([auth-emails.ts](../../src/modules/auth/infrastructure/email/auth-emails.ts))
   that takes a `language` and puts the words in the layout, like
   `sendPasswordAdded`.
3. **The port**: a method on `AuthMailerPort`
   ([auth-mailer.port.ts](../../src/modules/auth/application/ports/auth-mailer.port.ts)).
4. **The queue**: a job name in `AUTH_JOBS` and a job-data interface in
   [auth-email-jobs.ts](../../src/modules/auth/infrastructure/email/auth-email-jobs.ts), the method in
   [bullmq-auth-mailer.adapter.ts](../../src/modules/auth/infrastructure/adapters/bullmq-auth-mailer.adapter.ts)
   (with `EMAIL_JOB_OPTIONS`), and a `case` in
   [auth-jobs.consumer.ts](../../src/modules/auth/presentation/consumers/auth-jobs.consumer.ts).
   A job name the consumer does not know is logged and dropped, so deploy the
   consumer before (or with) the code that queues it.
5. **The fake**: add the method to `FakeMailer` in
   [auth-test-world.shared-spec.ts](../../src/modules/auth/application/commands/auth-test-world.shared-spec.ts).
   Check the email by sending it to Mailpit ([emails.md](./emails.md)).

Never put a secret the email does not need into the job data: job data is
visible in `/admin/queues`.

### A new limit

1. Add a rule to `AUTH_RATE_LIMITS` in
   [rate-limits.ts](../../src/modules/auth/application/rate-limits.ts): a new
   `name` (it becomes the Redis key `rl:<name>:...`), `limit`, `windowMs`, and
   a `reason`.
2. In the handler, pick the helper from
   [limits.ts](../../src/modules/auth/application/services/limits.ts):
   `enforce()` to count every accepted request (emails sent), and
   `withGuess()` around a check of a password or a code: the guess is counted
   before it is checked, so a burst cannot slip past, and given back unless
   the check calls `guess.wrong()`. `limiter.reset()` on success where a
   success should clear the count.
3. A new `reason` is a contract change: add it to `RateLimitReason` and
   `RATE_LIMIT_MESSAGES` in [domain/errors/](../../src/modules/auth/domain/errors/),
   and tell the web app, which may switch on it.
4. Key an address-based limit on the normalised address whether or not the
   account exists, or the limit itself reveals which addresses have accounts.
5. Test it with `FakeLimiter` (in the shared test world) if a burst or a bypass
   of it would matter, and document it in
   [rate-limits.md](./rate-limits.md) and the
   [API reference](./api-reference.md#rate-limits-by-route).
