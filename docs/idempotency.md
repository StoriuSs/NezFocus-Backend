<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**  *generated with [DocToc](https://github.com/thlorenz/doctoc)*

- [Idempotency Implementation Guide](#idempotency-implementation-guide)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
  - [Where the starter uses it](#where-the-starter-uses-it)
  - [Architecture](#architecture)
    - [Components](#components)
    - [Data Flow](#data-flow)
  - [How It Works](#how-it-works)
    - [1. Decorator Marks Endpoint](#1-decorator-marks-endpoint)
    - [2. Client Sends Idempotency-Key Header](#2-client-sends-idempotency-key-header)
    - [3. Interceptor Checks Cache (Race Condition Prevention)](#3-interceptor-checks-cache-race-condition-prevention)
    - [4. Handler Executes & Response Cached](#4-handler-executes--response-cached)
    - [5. Duplicate Requests (Concurrent vs Subsequent)](#5-duplicate-requests-concurrent-vs-subsequent)
    - [6. Same Key, Different Body: 422](#6-same-key-different-body-422)
    - [Step-by-Step Execution Example](#step-by-step-execution-example)
  - [Usage](#usage)
    - [Basic Usage](#basic-usage)
    - [TTL Formats](#ttl-formats)
    - [Without Decorator](#without-decorator)
  - [Never on routes that set cookies or issue tokens](#never-on-routes-that-set-cookies-or-issue-tokens)
  - [Requirements for Client](#requirements-for-client)
    - [Send Idempotency-Key Header](#send-idempotency-key-header)
    - [Example Client Implementation (TypeScript)](#example-client-implementation-typescript)
  - [Error Handling](#error-handling)
    - [Errors Are NOT Cached](#errors-are-not-cached)
    - [Missing Idempotency-Key](#missing-idempotency-key)
    - [Invalid Idempotency-Key](#invalid-idempotency-key)
    - [Key Reused With Another Body](#key-reused-with-another-body)
  - [Redis Cache Details](#redis-cache-details)
    - [Cache Key Format](#cache-key-format)
    - [Cached Data Structure](#cached-data-structure)
    - [The Processing Claim and Its Lease](#the-processing-claim-and-its-lease)
    - [TTL Expiration](#ttl-expiration)
      - [Why use long TTLs (like 24h)?](#why-use-long-ttls-like-24h)
      - [Why the starter's routes use short ones](#why-the-starters-routes-use-short-ones)
      - [Do we manually invalidate this cache?](#do-we-manually-invalidate-this-cache)
    - [When Redis Is Down](#when-redis-is-down)
  - [Security Considerations](#security-considerations)
    - [1. Idempotency-Key Must Be Unique Per Action](#1-idempotency-key-must-be-unique-per-action)
    - [2. Use Strong Identifiers](#2-use-strong-identifiers)
    - [3. Idempotency Is Not a Lock on the Data](#3-idempotency-is-not-a-lock-on-the-data)
  - [Best Practices](#best-practices)
    - [1. Choose Appropriate TTLs](#1-choose-appropriate-ttls)
    - [2. Monitor Cache Size](#2-monitor-cache-size)
  - [Real-World Examples](#real-world-examples)
    - [Example 1: Setting a Username](#example-1-setting-a-username)
    - [Example 2: Avatar Upload](#example-2-avatar-upload)
    - [Example 3: Updating the Profile](#example-3-updating-the-profile)
    - [Trying It: the Race Script](#trying-it-the-race-script)
  - [Troubleshooting](#troubleshooting)
    - [Cache Not Working](#cache-not-working)
    - [Unexpected Cache Hit](#unexpected-cache-hit)
  - [Disabling Idempotency for Specific Endpoints](#disabling-idempotency-for-specific-endpoints)
  - [Future Enhancements](#future-enhancements)
  - [Summary](#summary)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

# Idempotency Implementation Guide

This page is for anyone writing a route that changes something, or a client
that calls one. It explains how the starter stops one user action from
running twice when the request is sent twice, which routes use it, and what a
client must send.

## Table of Contents

- [Overview](#overview)
- [Where the starter uses it](#where-the-starter-uses-it)
- [Architecture](#architecture)
- [How It Works](#how-it-works)
- [Usage](#usage)
- [Never on routes that set cookies or issue tokens](#never-on-routes-that-set-cookies-or-issue-tokens)
- [Requirements for Client](#requirements-for-client)
- [Error Handling](#error-handling)
- [Redis Cache Details](#redis-cache-details)
- [Security Considerations](#security-considerations)
- [Best Practices](#best-practices)
- [Real-World Examples](#real-world-examples)
- [Troubleshooting](#troubleshooting)
- [Disabling Idempotency for Specific Endpoints](#disabling-idempotency-for-specific-endpoints)
- [Future Enhancements](#future-enhancements)
- [Summary](#summary)

## Overview

A request is **idempotent** when sending it twice has the same effect as
sending it once. Many requests are not: a double-clicked "Upload" uploads two
files, and a retry after a dropped connection repeats work that already
succeeded.

The starter fixes this per route. The client sends an `Idempotency-Key`
header, a UUID it makes once for one user action. The first request with that
key runs; a duplicate that arrives while it is still running gets `409
Conflict`; a duplicate that arrives after it finished gets the first answer
again, without running anything. The answers are kept in Redis.

## Where the starter uses it

Three routes, all on the users module
([`users.controller.ts`](../src/modules/users/presentation/http/users.controller.ts)):

| Route | `@Idempotent` | What a duplicate would otherwise do |
|---|---|---|
| `POST /api/v1/users/me/username` | `'1h'` | try to set the username a second time, and answer 400 "already set" for something that worked |
| `PATCH /api/v1/users/me` | `'10m'` | apply the profile change twice |
| `POST /api/v1/users/me/avatar` | `'10m'` | process and store a second copy of the image, and replace the first |

Each of these requires the header: without it the answer is `400`. The auth
routes (`/api/v1/auth/...`) do not use it, and must not; see
[Never on routes that set cookies or issue tokens](#never-on-routes-that-set-cookies-or-issue-tokens).

## Architecture

### Components

1. **`@Idempotent(ttl)` decorator**
   ([`idempotent.decorator.ts`](../src/shared/presentation/decorators/idempotent.decorator.ts)) - marks a route and says how long to keep its answer
2. **`IdempotencyInterceptor`**
   ([`idempotency.interceptor.ts`](../src/shared/presentation/interceptors/idempotency.interceptor.ts)) - a global interceptor; does nothing on routes without the decorator
3. **`IdempotencyService`**
   ([`idempotency.service.ts`](../src/shared/infrastructure/idempotency/idempotency.service.ts)) - reads and writes the records in Redis

### Data Flow

```
Client Request with Idempotency-Key
         ↓
IdempotencyInterceptor reads Redis
         ↓
      Found?
     /       \
   YES        NO (First Request)
    ↓          ↓
 Same body?   Claim the key ("PROCESSING", SET NX PX)
  /    \       ↓
 NO    YES    Execute Handler
  ↓     ↓      ↓
 422  Status?  Success → store "COMPLETED" answer
      /   \    Failure → release the claim
  COMP    PROC
    ↓       ↓
 replay    409
```

## How It Works

### 1. Decorator Marks Endpoint

```typescript
@Patch('me')
@HttpCode(HttpStatus.OK)
@Idempotent('10m') // keep the answer for 10 minutes
async updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileRequestDto) {
    // ...
}
```

### 2. Client Sends Idempotency-Key Header

```bash
curl -X PATCH http://localhost:8888/api/v1/users/me \
  -H "Authorization: Bearer <access token>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{"display_name":"Ada"}'
```

### 3. Interceptor Checks Cache (Race Condition Prevention)

Before allowing the handler to run, the interceptor checks Redis to prevent concurrent duplicate executions (e.g., a user double-clicking a button):

- If **Not Found**: The interceptor writes a `{ status: 'PROCESSING' }` claim with a single atomic `SET … NX PX` and lets the handler run. Only one of two simultaneous requests can win that write; the other gets `409`.
- If **Found (PROCESSING)**: Another request is executing this right now. The interceptor answers `409 Conflict` at once.
- If **Found (COMPLETED)**: The operation already finished. The stored answer is sent again, with its status code.

In both "found" cases the body is compared first ([step 6](#6-same-key-different-body-422)).

### 4. Handler Executes & Response Cached

- The handler processes the request normally.
- On success, the answer is stored in Redis (replacing the `PROCESSING` claim with `status: 'COMPLETED'`, the status code and the body) for the decorator's TTL.
- On error, the claim is **deleted** so that the client can retry the request fresh.
- On a **timeout or a client disconnect**, the claim is **kept until the handler really finishes**. The client's request is gone (it got `408`, or hung up), but the handler's work carries on. Releasing the key then would let a retry run the operation a second time alongside the first. So the interceptor keeps following the handler: when it succeeds, its answer is stored and the retry gets it; when it fails, the claim is released.

### 5. Duplicate Requests (Concurrent vs Subsequent)

- **Concurrent:** A second request arriving while the first still runs hits the `PROCESSING` claim and gets `409 Conflict`. The client should wait a moment and retry with the same key.
- **Subsequent:** A retry arriving after the first finished finds the `COMPLETED` record and gets the stored answer instantly, without running the handler.

### 6. Same Key, Different Body: 422

For a JSON body, the interceptor stores a SHA-256 fingerprint of the body with
the claim. A later request with the same key and a **different body** is
refused with **422** `IDEMPOTENCY_KEY_MISMATCH` ("This Idempotency-Key was
already used with a different request body"), whether the first is still
running or finished.

Why refuse rather than replay: the same key with another body is a client
bug, usually a key generated once per form and reused after the user edited
it. Replaying the first answer would silently drop the edit; running the
second would break the promise the key makes. A 422 makes the bug visible.

Multipart bodies (the avatar upload) are **not** compared: the file is parsed
by the route's own interceptor, after the global one has already run, so
there is nothing to fingerprint yet.

---

### Step-by-Step Execution Example

A user uploads a new avatar, their connection hiccups, and they click
"Upload" again.

**First Request (Request A)**
1. The web app generates a UUID (`550e8400-…`) for this upload, and sends it in the `Idempotency-Key` header.
2. The interceptor finds nothing in Redis.
3. It writes the `{ status: 'PROCESSING' }` claim.
4. The handler starts resizing the image.

**Second Request (The Panic Double-Click) - Request B**
1. Arrives 200 ms later with the same key.
2. The interceptor finds `{ status: 'PROCESSING' }`.
3. It answers `409 Conflict`. No second image is processed or stored.

**Handler Completes**
1. Request A finishes: the image is stored, and the old one is queued for deletion.
2. The interceptor stores `{ status: 'COMPLETED', statusCode: 200, body: … }` for 10 minutes.

**Third Request (The Delayed Retry) - Request C**
1. The web app retries 5 seconds later, with the same key.
2. The interceptor finds `{ status: 'COMPLETED' }`.
3. It answers `200 OK` with Request A's body, including its avatar URL. The user sees the new avatar.

## Usage

### Basic Usage

The real `UsersController`, shortened:

```typescript
import { Controller, Post, Patch, Body, HttpCode, HttpStatus } from '@nestjs/common'
import { CurrentUser, Idempotent } from '@/shared/presentation/decorators'

@Controller({ path: 'users', version: '1' })
export class UsersController {
    @Post('me/username')
    @HttpCode(HttpStatus.OK)
    @Idempotent('1h')
    async setUsername(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetUsernameRequestDto) {
        // ...
    }

    @Patch('me')
    @HttpCode(HttpStatus.OK)
    @Idempotent('10m')
    async updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileRequestDto) {
        // ...
    }

    @Post('me/avatar')
    @HttpCode(HttpStatus.OK)
    @Idempotent('10m')
    @UseInterceptors(FileInterceptor('avatar', { /* ... */ }))
    async uploadAvatar(/* ... */) {
        // ...
    }
}
```

`@Idempotent` also documents the required `Idempotency-Key` header in the
OpenAPI spec, so the generated client types know to send it
([openapi.md](./openapi.md)).

### TTL Formats

A number and one unit:

| Format | Meaning |
|--------|---------|
| `30s`  | 30 seconds |
| `5m`   | 5 minutes |
| `1h`   | 1 hour |
| `1d`   | 1 day |
| `10ms`, `2h30m`, `1.5h` | Not supported: the request fails. Use `150m` instead of `2h30m` |

Default TTL is `24h` if not specified (`@Idempotent()`).

### Without Decorator

If a route doesn't have `@Idempotent`, the interceptor does nothing and the
header is ignored:

```typescript
@Get('username-available/:username')
async checkUsernameAvailability(@Param() { username }: CheckUsernameParamsDto) {
    // Reading changes nothing, so a duplicate does no harm
}
```

## Never on routes that set cookies or issue tokens

Do **not** put `@Idempotent` on `POST /auth/login`, `/auth/refresh`,
`/auth/email-code/verify`, `/auth/reset-password`, or any route
that sets a cookie or returns a token. The interceptor stores the response
**body** and replays it; it does not store or replay headers. For these
routes that breaks things:

- **The cookie is lost.** These routes put the refresh token in a
  `Set-Cookie` header. A replay sends the body without it, so the browser
  keeps no session, or keeps one that was already rotated away.
- **Refresh tokens are single-use.** A replayed `/auth/refresh` answer
  carries an access token the first request already handed out, while the
  refresh cookie it was paired with has been rotated. The client ends up with
  a mismatched pair, and a later refresh can look like a stolen token being
  reused ([sessions-and-tokens.md](./auth/sessions-and-tokens.md)).
- **Tokens would sit in Redis.** The stored body holds the access token for
  the whole TTL, readable by anyone who can read Redis.

These routes are safe to repeat for other reasons: a code is used once in the
database, a refresh token is rotated under a row lock with a short grace
window for a second tab, and a sign-in simply makes another session. See
[race-conditions-and-locks.md](./race-conditions-and-locks.md).

## Requirements for Client

### Send Idempotency-Key Header

**The frontend generates the key, never the backend!** If the backend generated it, every retry would get a brand new key, completely defeating the protection.

Must include `Idempotency-Key` header with:
- A UUID (required — anything else is rejected with `400`)
- The **same** value when retrying the same request — so generate it for the user's action, not inside an HTTP interceptor, which runs once per attempt
- A **new** value when the payload changes. Reusing a key with an edited JSON body is refused with `422 IDEMPOTENCY_KEY_MISMATCH`; for a file upload, which is not compared, it replays the first upload's answer and the new file is never stored
- A **new** value after a success, if the user deliberately does the same thing again

The React starter implements exactly these rules in `useIdempotentMutation` (see its `docs/data-fetching.md`). Note that `crypto.randomUUID()` only exists on HTTPS/localhost origins; fall back to `crypto.getRandomValues()` elsewhere.

### Example Client Implementation (TypeScript)

```typescript
async function updateProfile(accessToken: string, data: { display_name?: string; bio?: string }, idempotencyKey: string) {
    const response = await fetch('https://api.example.com/api/v1/users/me', {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(data)
    })
    if (response.status === 409) {
        // The first attempt is still running: wait, then retry with the SAME key
        await new Promise((resolve) => setTimeout(resolve, 1000))
        return updateProfile(accessToken, data, idempotencyKey)
    }
    return response
}

// Create the key once for this save, and reuse it if the request has to be retried
const idempotencyKey = crypto.randomUUID()
const payload = { display_name: 'Ada' }
const result = await updateProfile(token, payload, idempotencyKey).catch(() =>
    updateProfile(token, payload, idempotencyKey) // same key, same body: never applied twice
)
```

## Error Handling

### Errors Are NOT Cached

If the handler throws an error, the answer is not stored and the claim is
released:

```
POST /api/v1/users/me/username with key "550e8400-…"  → 409 "Username already taken: ada"
POST /api/v1/users/me/username with key "550e8400-…"  → runs again (not cached)
```

This allows clients to retry failed requests and get a fresh attempt.

### Missing Idempotency-Key

If `@Idempotent` is applied but the client doesn't send the header:

```
400 Bad Request: "Idempotency-Key header is required for this endpoint"
```

### Invalid Idempotency-Key

```
// ❌ Anything that is not a UUID
400 Bad Request: "Idempotency-Key header must be a valid UUID"
"order-request-1"
"user-signup-001"

// ✅ Valid
"550e8400-e29b-41d4-a716-446655440000"
```

A fixed format keeps a hostile header from shaping the key space.

### Key Reused With Another Body

```
PATCH /api/v1/users/me  key "550e8400-…"  {"display_name":"Ada"}    → 200
PATCH /api/v1/users/me  key "550e8400-…"  {"display_name":"Grace"}  → 422
```

The 422 answer has `meta.code` `422003` and `meta.type`
`IDEMPOTENCY_KEY_MISMATCH`. The fix is always in the client: a new key for the
new body.

## Redis Cache Details

### Cache Key Format

```
idempotency:{sha256(userId \0 method \0 routePath \0 idempotencyKey)}
```

The key is **scoped to the caller and the route**, not just the header value. Keying on the header alone would let one user replay another user's cached response by sending the same key, and let a key reused on a different endpoint return the wrong endpoint's body. Anonymous requests use `anonymous` as the user id.

Idempotency records are written with the shared `REDIS_CLIENT` directly, not through the 2-layer cache — the claim needs Redis' atomic `SET NX`, and an in-memory layer would let two instances each believe they hold it.

### Cached Data Structure

```typescript
interface CachedResponse {
    status: 'PROCESSING' | 'COMPLETED'
    statusCode: number        // HTTP status (200, 201, etc.)
    body: unknown             // Response body
    timestamp: number         // When stored
    envelope?: boolean        // The body was a ServiceResponse: rebuild the { meta, data } envelope on replay
    fingerprint?: string      // SHA-256 of the JSON body that claimed the key (absent for multipart)
    owner?: string            // A random id per claim, so only its own request can renew or release it
}
```

`envelope` exists because the marker that makes a handler's return value a
`ServiceResponse` does not survive JSON. Without it, a replay would be wrapped
a second time (`data.data`) and the retry would get a different shape from
the original.

### The Processing Claim and Its Lease

The `PROCESSING` claim does not live for the whole TTL. It lives for a
**lease**: the request timeout (`REQUEST_TIMEOUT_MS`, 30 s by default) plus 30
seconds. While the handler runs, the interceptor renews the lease every third
of its length. If the process crashes mid-request, nobody renews it, and the
claim expires a minute later; retries then run fresh. (Before the lease, one
crash left every retry answering 409 for the whole TTL.)

Renewing and releasing only touch the key while it still holds *this*
request's claim (a small Lua script compares it first), so a request whose
claim expired can't remove the claim a retry made after it.

### TTL Expiration

Stored answers expire on their own after the decorator's TTL:

```typescript
@Idempotent('24h') // Recommended for actions with real-world consequences
async chargePayment(@Body() dto: ChargeDto) {
    return this.paymentService.charge(dto)
}
```

#### Why use long TTLs (like 24h)?
The Idempotency Key represents a **single human intention**. Imagine a user clicks "Pay" while on a train:
1. The server charges them $50.
2. The user loses cell service. The success response drops.
3. Three hours later, they reconnect to Wi-Fi and their browser automatically background-retries the request.

If the TTL was only `5m`, the delayed retry would look like a brand-new request, double-charging them. Industry standards (like Stripe) use 24-hour TTLs to guarantee protection against delayed mobile retries.

#### Why the starter's routes use short ones

`PATCH /users/me` and `POST /users/me/avatar` keep their answers for 10
minutes, not 24 hours. Their answers contain the avatar URL, which on S3 is a
presigned link valid for one hour. A replay returns the original body as it
was, link included, so the TTL must be well inside the link's life. Genuine
retries of a profile save happen within seconds anyway.

#### Do we manually invalidate this cache?
**NO.** This is the crucial difference between Data Caching and Idempotency.
* **Data Cache**: If a product price changes, delete the cache so the next user gets the fresh price.
* **Idempotency Cache**: This is a **record of a completed action**. If you manually delete an idempotency key early, you destroy the shield. A delayed retry will hit the server, see the key is missing, assume it's fresh, and execute the action a second time. Idempotency records must live out their full natural TTL uninterrupted.

### When Redis Is Down

The interceptor **fails open**: if Redis can't be read or written, the request
runs as if the route had no `@Idempotent`, and the failure is logged at
`error` (once a minute). Duplicates are then possible, but the app keeps
working. The `RedisDown` alert covers the gap.

## Security Considerations

### 1. Idempotency-Key Must Be Unique Per Action

```
// ✅ Good: Different keys for different actions
PATCH /users/me with key "550e8400-…"  {"bio":"first"}
PATCH /users/me with key "6f9619ff-…"  {"bio":"second"}

// ❌ Bad: Same key for different data
PATCH /users/me with key "550e8400-…"  {"bio":"first"}
PATCH /users/me with key "550e8400-…"  {"bio":"second"}
// → 422 IDEMPOTENCY_KEY_MISMATCH
```

Keys are scoped per user and route on the server, so another user sending your key does not receive your response.

### 2. Use Strong Identifiers

```
// ✅ Good: UUID v4
"550e8400-e29b-41d4-a716-446655440000"

// ❌ Rejected: not a UUID
"user-123-request-1"
```

### 3. Idempotency Is Not a Lock on the Data

The key protects against **the same client** sending **the same request**
twice. It does nothing against two different requests racing, because an
attacker (or a second tab) simply sends another key. Whatever must not happen
twice must also be enforced where the data is written. The starter's
username route shows both: `@Idempotent` for the double-click, and a
conditional `UPDATE ... WHERE hasSetUsername = false` in the repository, so
two different keys still cannot both set it. See
[race-conditions-and-locks.md](./race-conditions-and-locks.md).

## Best Practices

### 1. Choose Appropriate TTLs

```typescript
// The answer contains a short-lived link (a presigned URL): stay well inside its life
@Idempotent('10m')
async updateProfile() {}

// A one-off change the user won't repeat soon
@Idempotent('1h')
async setUsername() {}

// Side effects with consequences, and nothing in the answer that expires: very long TTL
@Idempotent('24h')
async chargePayment() {}
```

### 2. Monitor Cache Size

Every record expires by itself. To see how many there are:

```bash
docker exec -it redis-nezfocus-web redis-cli -a "$REDIS_PASSWORD" --scan --pattern 'idempotency:*' | wc -l
```

Don't delete them by hand (see above). The Redis dashboard shows memory use
([monitoring.md](./monitoring.md)).

## Real-World Examples

### Example 1: Setting a Username

```typescript
@Post('me/username')
@Idempotent('1h')
async setUsername(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetUsernameRequestDto) {
    // First attempt:
    // - Username set (one conditional UPDATE)
    // - UserProfileUpdatedEvent published (the auth module drops its cached user)
    // - Answer stored for 1 hour

    // Duplicate attempt (same key, same body):
    // - The stored answer: 200 with the username
    // - Without idempotency it would get 400 "Username has already been set",
    //   and the web app would show an error for something that worked
}
```

### Example 2: Avatar Upload

```typescript
@Post('me/avatar')
@Idempotent('10m')
async uploadAvatar(/* multipart file "avatar" */) {
    // First attempt:
    // - Image resized and stored
    // - Old avatar queued for deletion
    // - Answer stored (avatar_url, width, height)

    // Duplicate attempt (same key):
    // - The stored answer
    // - No second image processed, stored, or deleted
    // - The body is not compared (multipart): a different file with the same key
    //   gets the first upload's answer
}
```

### Example 3: Updating the Profile

```typescript
@Patch('me')
@Idempotent('10m')
async updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileRequestDto) {
    // First attempt:
    // - Display name and bio saved
    // - Answer stored

    // Duplicate attempt, same body: the stored answer
    // Same key, edited body: 422 IDEMPOTENCY_KEY_MISMATCH
}
```

### Trying It: the Race Script

[`scripts/idempotency-race.ts`](../scripts/idempotency-race.ts) fires five
identical `PATCH /api/v1/users/me` requests with one key at the same moment,
against a running API:

```bash
TOKEN=<access token> npx ts-node -r tsconfig-paths/register scripts/idempotency-race.ts
# API_URL defaults to http://localhost:8888/api/v1/users/me
```

Expected: one `200`, and the others `409` (the claim was held) or `200` (a
replay, if the first had already finished). All five send the same body, so
none gets 422. The automated version is `test/e2e/idempotency-replay.e2e-spec.ts`
(`pnpm test:e2e`).

## Troubleshooting

### Cache Not Working

1. **Check Redis Connection**
   ```bash
   docker exec -it redis-nezfocus-web redis-cli -a "$REDIS_PASSWORD" ping
   # Should return: PONG
   ```
   With Redis down the interceptor lets every request through; the app's log says "allowing the request".

2. **Verify Decorator Applied**
   ```typescript
   // ✅ Correct: on the route
   @Patch('me')
   @Idempotent('10m')
   async updateProfile() {}

   // ❌ Wrong: on the class (the interceptor reads the route's metadata only)
   @Idempotent('10m')
   @Controller()
   export class MyController {}
   ```

3. **Verify Header Sent**
   ```bash
   curl -i -X PATCH http://localhost:8888/api/v1/users/me \
     -H "Authorization: Bearer <access token>" \
     -H "Content-Type: application/json" \
     -H "Idempotency-Key: $(uuidgen)" \
     -d '{"bio":"hello"}'
   # A 400 mentioning Idempotency-Key means the header is missing or not a UUID
   ```

### Unexpected Cache Hit

1. **Verify Idempotency-Key is unique per action**
   ```typescript
   // This sends the same key twice - the second gets the first's answer
   const key = crypto.randomUUID()
   await fetch('/api/v1/users/me', { method: 'PATCH', headers: { 'Idempotency-Key': key }, body })
   await fetch('/api/v1/users/me', { method: 'PATCH', headers: { 'Idempotency-Key': key }, body }) // replay
   ```

2. **Check TTL expiration**
   Stored keys are hashes (see [Cache Key Format](#cache-key-format)), so find them by scanning:
   ```bash
   redis-cli --scan --pattern 'idempotency:*'
   redis-cli TTL idempotency:<hash>
   # Returns: -2 (key expired), -1 (no expiry), or seconds remaining
   ```

3. **Clear a record manually if needed** (development only; see [Do we manually invalidate this cache?](#do-we-manually-invalidate-this-cache))
   ```bash
   redis-cli DEL idempotency:<hash>
   ```

## Disabling Idempotency for Specific Endpoints

If `@Idempotent` is applied, it's always enforced, and the header is
required. To disable it for a route, remove the decorator:

```typescript
// ✅ Idempotent: the client must send Idempotency-Key
@Patch('me')
@Idempotent('10m')
async updateProfile() {}

// Not idempotent (no decorator): the header is ignored
@Get('me')
async getProfile() {}
```


## Future Enhancements

Possible improvements:

1. **Batch Operations** - Handle multiple requests with same key differently
2. **Metrics** - Track replays, conflicts and mismatches per endpoint
3. **Custom Key Generator** - Allow endpoints to define custom cache keys
4. **Fingerprinting multipart bodies** - Compare uploads too (the file's hash, once it is parsed)

The atomic claim (`SET … NX PX` on the raw Redis client) is already how it
works.

## Summary

Idempotency prevents duplicate side effects in APIs:

1. Apply `@Idempotent('TTL')` to routes with side effects; the starter does on `POST /users/me/username`, `PATCH /users/me` and `POST /users/me/avatar`
2. Clients send a UUID `Idempotency-Key` per user action, and the same one on retries
3. Duplicate requests get the stored answer; concurrent ones get `409`
4. The same key with a different JSON body gets `422 IDEMPOTENCY_KEY_MISMATCH`
5. Errors are not stored (retries run fresh)
6. Answers expire after the TTL; a crashed request's claim expires after its lease
7. Never on routes that set cookies or issue tokens

This pattern is essential for robust APIs dealing with network retries, mobile apps, and distributed systems.
