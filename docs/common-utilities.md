# The shared layer

Everything under `src/shared/` — the decorators, interceptors, pipes, filters
and small helpers that every module uses. If you are adding a feature, this is
the list of things you should not write yourself.

- [Where things live](#where-things-live)
- [Decorators](#decorators)
- [Errors](#errors)
- [Interceptors](#interceptors)
- [Pipes](#pipes)
- [Middleware](#middleware)
- [Constants](#constants)
- [RateLimiter](#ratelimiter)
- [Utilities](#utilities)
- [Utilities that nothing calls yet](#utilities-that-nothing-calls-yet)

## Where things live

`src/shared/` has a domain layer, an infrastructure layer and the HTTP edge.
There is no shared application layer: use cases belong to a module.

```
src/shared/
├── constants/          # Response and error codes, messages, enums
├── domain/             # DomainError, the base of every module's errors
├── infrastructure/     # Adapters: auth (the @Public/@Roles/@CurrentUser
│                       # decorators and RolesGuard), cache, email, logging,
│                       # monitoring, persistence, queue, rate-limit
│                       # (RateLimiter), services, storage, throttler
├── presentation/       # The HTTP edge: decorators, filters, interceptors,
│                       # middlewares, pipes, exceptions
├── types/              # ServiceResponse, AuthenticatedUser and other cross-cutting types
└── utils/              # Small pure functions
```

The sign-in itself (the access-token guard, sessions, passwords) is not here:
it is the `auth` module, `src/modules/auth/` ([auth/README.md](./auth/README.md)).

The import alias is `@/shared`, and most folders have an `index.ts`, so
`import { CustomException } from '@/shared/presentation/exceptions'` works.

## Decorators

All of these are re-exported from `@/shared/presentation/decorators`.

| Decorator | What it does |
| --- | --- |
| `@Public()` | The route skips authentication (the global `AccessTokenGuard`). Still rate-limited. |
| `@CurrentUser()` | Injects the authenticated user (`AuthenticatedUser`: `id`, `sessionId`, `email`, `roles`, ...). `@CurrentUser('email')` injects one field. |
| `@Roles('admin')` | The route requires the role, from the user's `roles`; otherwise `403 AUTH_FORBIDDEN` ([auth/accounts.md](./auth/accounts.md)). |
| `@Idempotent('1h')` | Replays of the same `Idempotency-Key` return the first response for this long. See [idempotency.md](./idempotency.md). |
| `@SkipRateLimit()` | The throttler ignores this route. Use sparingly. |
| `@ApiEnvelopeResponse(Dto)` | Documents the response in OpenAPI *with* the `{ meta, data }` envelope, which the plain `@ApiResponse` would miss. |
| `@RawResponse()` | The response is not wrapped in the envelope. Used by `/metrics`, which has to return Prometheus' text format. |
| `@ExcludeFromMetrics()` | No request metrics for this route. On the health controller, which is probed constantly. |
| `@SkipSuccessLog()` | No "request completed" log line. Same reason. |

```typescript
import { CurrentUser, Public, Roles } from '@/shared/presentation/decorators'

@Public()
@Get('status')
status() {
    return { ok: true }
}

@Roles('admin')
@Get('admin/stats')
stats(@CurrentUser() user: AuthenticatedUser) { ... }
```

These are metadata, not URL patterns, on purpose. An earlier version decided
what was public by matching the request URL against a regular expression, and
a route whose name happened to start with `metrics` would have inherited both
the authentication and the rate-limit bypass.

## Errors

Two ways to raise an error that ends up in the envelope. Modules use the
first; the second is for shared HTTP-level code. The full code list is in
[BACKEND_RESPONSE_HANDLING.md](./BACKEND_RESPONSE_HANDLING.md#error-codes-and-types).

### DomainError and DomainExceptionFilter

A module's domain and application code throw subclasses of `DomainError`
(`src/shared/domain/domain-error.ts`). Each states its `kind` and its
`errorKey`, a key of `ERROR_CODES` / `ERROR_TYPES`, and nothing about HTTP:

```typescript
import { DomainError } from '@/shared/domain'

// src/modules/users/domain/errors/user.errors.ts
export class UserNotFoundError extends DomainError {
    readonly kind = 'not_found'
    readonly errorKey = 'USER_NOT_FOUND'

    constructor(public readonly identifier: string) {
        super(`User not found: ${identifier}`)
    }
}
```

`DomainExceptionFilter` maps every one of them, for every module, so there is
no filter to write:

| `kind` | Status |
| --- | --- |
| `invalid` | 400 |
| `unauthenticated` | 401 |
| `forbidden` | 403 |
| `not_found` | 404 |
| `conflict` | 409 |
| `unprocessable` | 422 |
| `rate_limited` | 429, and `Retry-After` from the error's `retryAfterSeconds` |
| `unavailable` | 503 |

An error's optional `details` object is added to `data` in `snake_case`
(`AUTH_PASSWORD_REJECTED` sends `data.rules` this way). Domain errors are
logged as warnings and never sent to error tracking: they are the app saying
no on purpose.

### CustomException

An exception class carrying the code and type that end up in the response
envelope, for shared code that works at the HTTP level (uploads, storage, the
validation pipe).

```typescript
import { CustomException } from '@/shared/presentation/exceptions'
import { ERROR_CODES, ERROR_TYPES } from '@/shared/constants'
import { HttpStatus } from '@nestjs/common'

throw new CustomException({
    code: ERROR_CODES.USER_NOT_FOUND,
    type: ERROR_TYPES.USER_NOT_FOUND,
    message: 'User not found',
    status: HttpStatus.NOT_FOUND
})
```

`status` defaults to 500 — deliberately, so an exception thrown without one is
loud rather than quietly a 400.

Domain code does not throw this. It throws a `DomainError` (above), and the
filter maps it to HTTP at the edge; the domain has no idea what a status code
is.

### GlobalExceptionFilter

Catches everything that is not a `DomainError` and gives it the same shape.

- `CustomException` keeps its code and type.
- `HttpException` from Nest or from a library (a body-parser 413, a multer
  `LIMIT_FILE_SIZE`) is mapped to a matching code. The throttler's 429 becomes
  `THROTTLE_ERROR` with the standard `Retry-After` header.
- Anything else is a 500. It is logged in full, reported to error tracking, and
  the client is told nothing but "Internal server error": no stack, no paths,
  no Prisma internals.

The stack trace goes into the response only in development.

```json
{
    "meta": {
        "code": "404001",
        "type": "USER_NOT_FOUND",
        "message": "User not found",
        "timestamp": "2026-01-01T00:00:00.000Z",
        "request_id": "8f3c...",
        "request_duration": 45
    },
    "data": {
        "details": "User not found",
        "path": "/api/v1/users/me",
        "method": "GET"
    }
}
```

For a validation failure, `data.details` is the list of failing fields. In
development `data.stack` is there too; in production it is not.

## Interceptors

Registered in `src/app.module.ts`, and **the order matters** — index 0 is the
outermost:

1. `TransformInterceptor` — wraps the payload in the envelope and converts keys
   to `snake_case`. A handler returns plain data or a `ServiceResponse`; it
   never builds the envelope by hand.
2. `LoggingInterceptor` — one line per request, through Pino. See
   [logging.md](./logging.md).
3. `TimeoutInterceptor` — answers `408` for a request that runs past
   `REQUEST_TIMEOUT_MS`. It is **outside** the idempotency interceptor. A
   timeout answers the client but does not stop the handler; from outside, it
   only tears down the idempotency interceptor's outer stream, and that
   interceptor keeps following the handler to record how it really ended, so
   a retry gets 409 while the work runs and the stored result once it is done.
   The other way round, the timeout reached the idempotency interceptor as an
   error, released the key, and the retry ran the operation a second time.
4. `IdempotencyInterceptor` — claims the key, replays the stored response, and
   records the outcome however the request ends.

Request metrics are *not* an interceptor. They are recorded by
`HttpMetricsMiddleware` on `res.on('finish')`, so a response produced by an
exception filter is counted too — as an interceptor they were missed, and the
5xx rate a dashboard showed was not the one the server was serving.

```typescript
// What a handler returns
return createResponse(MESSAGES.USER.FETCHED, { userId: '123', fullName: 'John' })
```

```json
{
    "meta": { "message": "User fetched successfully", "...": "..." },
    "data": { "user_id": "123", "full_name": "John" }
}
```

## Pipes

### The global validation pipe

`createValidationPipe()` in `src/shared/presentation/pipes/app-validation.pipe.ts`:

- `whitelist` and `forbidNonWhitelisted` — an unexpected field is an error, not
  something silently dropped.
- `transform` with implicit conversion — `"5"` in a query string reaches a
  `number` field as `5`.
- Failures become a **422** in the standard envelope, with one entry per failing
  field. `flattenValidationErrors` walks `children`, so a failure inside a
  `@ValidateNested()` object says which nested field was wrong instead of just
  naming the parent.

### SnakeToCamelPipe

The wire format is `snake_case` and the code is `camelCase`, so request bodies
are converted on the way in. Applied where raw Express routes are mounted
(`src/bootstrap/operational-endpoints.ts`, `src/main.ts`).

Note the asymmetry, because it will bite eventually: `userID → user_id →
userId`, and a key with a non-word separator like `weird-key` comes back as
`weirdKey`. `forbidNonWhitelisted` turns most such cases into a 422 rather than
silent data loss, but do not rely on a perfect round trip.

## Middleware

| Middleware | What it does |
| --- | --- |
| `requestIdMiddleware` | Every request gets an id, used in logs and in `meta.request_id`. A client-supplied `x-request-id` is accepted **only** if it is a well-formed UUID; anything else is replaced. It is reflected back and logged, so an unvalidated value would be a free field in every log line. |
| `HttpMetricsMiddleware` | Records the request in Prometheus on `res.on('finish')`, using the matched route (`/users/:id`) rather than the URL — recording the URL gave Prometheus one series per id. |

## Constants

| File | Holds |
| --- | --- |
| `src/shared/constants/error-response.ts` | Error codes (`404001`) and types (`USER_NOT_FOUND`) |
| `src/shared/constants/messages.ts` | The human-readable strings |
| `src/shared/constants/logging.ts` | Log context names |
| `src/shared/constants/sensitive-fields.ts` | The one list of field names that Pino redacts and that error reports scrub — shared so the two can't drift |

Only errors have codes and types; a success has a message and its data. The
codes are `<http status><series>`, so `404001` is a 404 and `422000` is a
validation failure (`422001` is `IMAGE_PROCESSING_FAILED`). The frontend
switches on `meta.type`, not on the message: see
[BACKEND_RESPONSE_HANDLING.md](./BACKEND_RESPONSE_HANDLING.md#error-codes-and-types)
for every code, and the error catalogue in the React starter.

## RateLimiter

`src/shared/infrastructure/rate-limit/rate-limiter.ts`: fixed-window counters
in Redis, shared by every instance, for limits that belong to one operation
rather than to every route. The auth module's sign-in limits (failed sign-ins
per address, code emails per address, wrong codes per account) are built on
it; reuse it for your own ("5 invitations per user per hour").

```typescript
const rule = { name: 'invite-user', limit: 5, windowMs: 60 * 60_000 }

const state = await this.limiter.check(rule, userId)   // limited? without counting
if (state.limited) throw new MyRateLimitedError(state.retryAfterSeconds)
await this.limiter.hit(rule, userId)                    // count this one
// this.limiter.reset(rule, userId) clears the window, e.g. after a success
```

- The key is `rl:<rule name>:<sha256 of the lower-cased subject>`, so no email
  address sits in Redis in clear.
- `hit` is one atomic Lua script (`INCR`, and start the window on the first
  hit), so two instances cannot both let the sixth request through.
- **It fails closed** (D-137): if Redis is down, `hit` and `check` throw
  `LimitsUnavailableError` (`src/shared/domain`, kind `unavailable`, answered
  503) and the failure is logged once a minute. `release` and `reset` only
  log. The auth limits are what stops guessing at codes and passwords, so
  they refuse rather than let requests through uncounted; the cost is that
  nobody can sign in until Redis is back. A limit of your own that should not
  stop its route during an outage must catch the error itself.

Throw a `DomainError` with `kind = 'rate_limited'` and `retryAfterSeconds` to
answer 429 with `Retry-After`. How the auth module combines its limits:
[auth/rate-limits.md](./auth/rate-limits.md). `CacheModule` is global and
exports it, so any provider can inject `RateLimiter` directly.

## Utilities

In `src/shared/utils/`, all pure functions, all exported from the folder's
`index.ts` except where noted.

| Function | What it does |
| --- | --- |
| `parseIntSafe(value, fallback)` | An environment variable as a number, falling back when it is unset or not a number. |
| `parseBooleanEnv(value)` | `"true"` in any case is true, everything else is false. Written because `CORS_CREDENTIALS=TRUE` was being read as false. |
| `toSnakeCaseKeys` / `toCamelCaseKeys` | Key conversion that survives arrays, primitives, `Date`, `Blob` and `Buffer` (`case-keys.util.ts`, not in the index). |
| `validateAndTransform(Dto, plain)` | Turns a plain object into a validated DTO instance — the response side of the contract, so a handler cannot return a shape the OpenAPI spec does not describe. |
| `serialize` / `serializeArray` | `class-transformer` without the validation step. |
| `calculateExpiryDate('15m')` / `calculateTTLInSeconds('24h')` | Duration strings to a date or to seconds. Used by the idempotency TTLs. |
| `getFullUrl(path, baseUrl)` | Prefixes a relative storage path with the app's base URL, and leaves an absolute presigned URL alone. |
| `throttledLog(write, intervalMs)` | Logs the first occurrence, then at most one an interval. For per-request failures — a Redis outage would otherwise write a line per request. |
| `calculatePagination`, `getSkip`, `createPaginatedResponse` | Page arithmetic and the paginated envelope. |
| `ConcurrencyLimiter` | Runs at most N tasks at once with a bounded queue, and throws `ConcurrencyLimitError` past that. What keeps image processing from exhausting memory (`concurrency-limiter.ts`). |

## Utilities that nothing calls yet

These are in the repository because the next thing most people build needs
them. They have tests; they have no callers.

- **`code-generator.util.ts`** — `generateAlphanumericCode` and
  `generateSecureToken`. (`generateVerificationCode`, from the same file, makes
  the auth module's emailed codes.) All use `crypto.randomInt`, not
  `Math.random`, and the numeric one pads, so `004213` is a possible code. (The
  obvious implementation cannot produce a leading zero and quietly loses a
  tenth of its key space.)
- **`pagination.util.ts`** — nothing in the starter returns a list yet.

## Related

- [hexagonal-architecture.md](./hexagonal-architecture.md) — why the layers are arranged this way
- [BACKEND_RESPONSE_HANDLING.md](./BACKEND_RESPONSE_HANDLING.md) — the response envelope in detail
- [idempotency.md](./idempotency.md), [rate-limit.md](./rate-limit.md), [logging.md](./logging.md)
