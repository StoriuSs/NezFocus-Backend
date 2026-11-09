# The response envelope

Every response this API sends has the same shape, and every error does too.
This page is the contract: what the shape is, how a handler produces it, how a
module reports an error, and how a client reads it. Read it before writing a
controller, or a frontend that calls one.

- [Response format](#response-format)
- [Errors with extra data](#errors-with-extra-data)
- [Error codes and types](#error-codes-and-types)
- [Who produces the envelope](#who-produces-the-envelope)
- [Throwing errors from a module: DomainError](#throwing-errors-from-a-module-domainerror)
- [CustomException, for shared infrastructure](#customexception-for-shared-infrastructure)
- [Returning success: ServiceResponse](#returning-success-serviceresponse)
- [Payload case transformation](#payload-case-transformation)
- [Request tracking](#request-tracking)
- [Messages](#messages)
- [Skipping response transformation](#skipping-response-transformation)
- [Adding a new error type](#adding-a-new-error-type)
- [Testing](#testing)

## Response format

### Success response

```json
{
  "meta": {
    "message": "Login successful",
    "timestamp": "2026-10-05T10:30:00.000Z",
    "request_id": "8f3c2a1b-7d4e-4c3b-9a1f-2e5d6c7b8a90",
    "request_duration": 123
  },
  "data": {
    "access_token": "eyJhbGciOi...",
    "token_type": "Bearer",
    "expires_in": 900
  }
}
```

A success has no `code` or `type`. The route and the HTTP status already say
what happened, and `data` is the result. Only an error carries them, because
a client has to tell apart failures that share a status: four different 401s
need four different reactions.

### Error response

```json
{
  "meta": {
    "code": "401001",
    "type": "AUTH_INVALID_CREDENTIALS",
    "message": "Incorrect email or password.",
    "timestamp": "2026-10-05T10:30:00.000Z",
    "request_id": "8f3c2a1b-7d4e-4c3b-9a1f-2e5d6c7b8a90",
    "request_duration": 87
  },
  "data": {
    "details": "Incorrect email or password.",
    "path": "/api/v1/auth/login",
    "method": "POST"
  }
}
```

> [!IMPORTANT]
> **Translation note:**
> - `meta.type` is the **key** a frontend looks up to show a message in the user's language.
> - `meta.message` is an **English fallback**, for logs and debugging.
>
> Switch on `meta.type`, never on `meta.message` or on `meta.code`'s text.

`data.stack` is added in development only, for unexpected errors. In
production the stack trace is in the log, never in the answer. A 500 tells the
client nothing but "Internal server error".

### Validation failure (422)

A body that does not match its DTO (a missing field, a wrong type, a field the
DTO does not declare) answers `422 VALIDATION_ERROR`, with one entry per failing
field in `data.details`:

```json
{
  "meta": {
    "code": "422000",
    "type": "VALIDATION_ERROR",
    "message": "Validation failed",
    "timestamp": "2026-10-05T13:26:26.948Z",
    "request_id": "12388208-6466-40e3-85f8-ea34ade4041f",
    "request_duration": 4
  },
  "data": {
    "details": [
      {
        "property": "email",
        "constraints": { "isEmail": "email must be an email address" },
        "value": "not-an-email"
      },
      {
        "property": "nickname",
        "constraints": { "whitelistValidation": "property nickname should not exist" },
        "value": "x"
      }
    ],
    "path": "/api/v1/auth/email-code",
    "method": "POST"
  }
}
```

A nested field is named by its dotted path (`address.street`, `items.0.qty`).

## Errors with extra data

Some errors carry facts a client can act on, beside `details`, `path` and
`method` in `data`. They are `snake_case` like everything else. Examples:

| Error | Extra fields in `data` |
| --- | --- |
| `422 AUTH_PASSWORD_REJECTED` | `rules`: each broken rule (`min_length`, `uppercase`, `matches_email`, ...), so a form can mark them one by one |
| `429 RATE_LIMIT_EXCEEDED` (sign-in limits) | `reason`: `network`, `recent_email`, `emails`, `sign_ins`, `wrong_password` or `codes` |
| `429 RATE_LIMIT_EXCEEDED` (the time zone, `PATCH /users/me/settings`) | `reason`: `timezone`, and `changeable_at`: when the zone may change again (it changes once every 24 hours) |
| `401 AUTH_TOKEN_REVOKED` | `reason`: why the session ended |
| `401 AUTH_REFRESH_FAILED` | `reason`: why the session ended; with `account_deleted` while the account waits to be deleted, `deletes_at` |
| `403 ACCOUNT_PENDING_DELETION` | `deletes_at`: when the account is deleted unless restored |
| `409 OWNERSHIP_TRANSFER_REQUIRED` | `servers`: `[{ id, name, member_count }]`, the servers to hand over before deleting the account |

A password the policy refuses:

```json
{
  "meta": { "code": "422004", "type": "AUTH_PASSWORD_REJECTED", "message": "Use at least 8 characters. Include a digit.", "...": "..." },
  "data": {
    "rules": ["min_length", "digit"],
    "details": "Use at least 8 characters. Include a digit.",
    "path": "/api/v1/auth/reset-password",
    "method": "POST"
  }
}
```

Every `429` also sends the standard **`Retry-After`** header, in seconds: the
global throttler's, the sign-in limits' and the time zone's alike. Every auth error, with what a
frontend should do about it: [auth/api-reference.md](./auth/api-reference.md).

## Error codes and types

Codes are six digits: the HTTP status, then a number within it. `404001` is a
404, `422004` a 422. The constants are the source of truth:
[`error-response.ts`](../src/shared/constants/error-response.ts).

Successes used to have codes too (`200000` and up). Nothing read them, so they
were dropped; no `2xxxxx` code is sent any more.

| Code | Type | Meaning |
| --- | --- | --- |
| `400000` | `BAD_REQUEST_ERROR` | A 400 with no code of its own |
| `400002` | `UPLOAD_INVALID_FILE` | The upload is not a usable file |
| `400102` | `AUTH_CODE_INVALID` | The emailed code is wrong (only the newest one works) |
| `400103` | `AUTH_CODE_EXPIRED` | The code expired or had too many wrong tries: ask for a new one |
| `400104` | `AUTH_CURRENT_PASSWORD_INVALID` | The current password, given to change it or delete the account, is wrong. Not a 401: the session is fine |
| `401000` | `AUTH_UNAUTHORIZED` | A 401 with no code of its own |
| `401001` | `AUTH_INVALID_CREDENTIALS` | Wrong email or password (the same answer for an unknown address) |
| `401003` | `AUTH_TOKEN_MISSING` | No `Authorization: Bearer` header on a protected route |
| `401004` | `AUTH_TOKEN_EXPIRED` | The access token expired: refresh |
| `401005` | `AUTH_TOKEN_INVALID` | The access token is not one this API issued |
| `401006` | `AUTH_TOKEN_REVOKED` | The session behind the token has ended (`data.reason`) |
| `401008` | `AUTH_REFRESH_FAILED` | The refresh cookie is missing, expired or ended: sign in again |
| `403000` | `FORBIDDEN_ERROR` | Missing a permission in a server (SRS appendix B). A server or channel the caller may not know about answers `NOT_FOUND_ERROR` instead |
| `403003` | `AUTH_ACCOUNT_DISABLED` | The account was deleted |
| `403004` | `AUTH_FORBIDDEN` | Not allowed: a missing role, or a cookie route called from an origin not in `CORS_ORIGINS` |
| `403100` | `ACCOUNT_INCOMPLETE` | The account has not done "complete your account"; only routes marked `@AllowIncomplete()` answer. Not a 401: do not sign out |
| `403101` | `ACCOUNT_PENDING_DELETION` | The account is waiting to be deleted (D-141); only routes marked `@AllowPendingDeletion()` answer (`GET /users/me`, `POST /auth/account/restore`). Not a 401: do not sign out, offer to restore |
| `403200` | `MAX_SERVERS_REACHED` | Creating or joining a server when already in 100 |
| `403201` | `OWNER_CANNOT_LEAVE` | The owner leaving a server: transfer it first |
| `403202` | `ROLE_HIERARCHY_VIOLATION` | Acting on a role or member ranked the same as or above oneself |
| `403203` | `BANNED_FROM_SERVER` | Joining a server one is banned from |
| `403204` | `MEMBER_TIMED_OUT` | Doing more than viewing while timed out (`data.until`) |
| `404000` | `NOT_FOUND_ERROR` | No such route or resource (also an unknown sign-in provider) |
| `404001` | `USER_NOT_FOUND` | No such user |
| `404002` | `UPLOAD_FILE_NOT_FOUND` | No such stored file |
| `408000` | `REQUEST_TIMEOUT_ERROR` | The request ran past `REQUEST_TIMEOUT_MS` |
| `409000` | `CONFLICT_ERROR` | A 409 with no code of its own |
| `409100` | `ACCOUNT_ALREADY_COMPLETE` | "Complete your account" sent for an account already completed |
| `409101` | `OWNERSHIP_TRANSFER_REQUIRED` | Deleting an account that owns servers with other members (D-76): hand them over first |
| `409200` | `USERNAME_CONFLICT` | The username is taken |
| `410200` | `INVITE_INVALID` | An invite that expired, ran out of uses, was revoked, or whose server was deleted |
| `413000` | `PAYLOAD_TOO_LARGE_ERROR` | A JSON body over body-parser's limit |
| `413001` | `UPLOAD_FILE_TOO_LARGE` | The file is over its route's limit (an avatar: 8 MB); any 413 raised inside Nest gets this one |
| `415000` | `UNSUPPORTED_MEDIA_TYPE_ERROR` | A body encoding the server does not take |
| `415001` | `UPLOAD_INVALID_TYPE` | A file type that is not accepted, declared or decoded (an avatar: JPG, PNG or WEBP) |
| `422000` | `VALIDATION_ERROR` | The body does not match the DTO (`data.details`) |
| `422001` | `IMAGE_PROCESSING_FAILED` | The image could not be processed |
| `422003` | `IDEMPOTENCY_KEY_MISMATCH` | An `Idempotency-Key` reused with a different body |
| `422004` | `AUTH_PASSWORD_REJECTED` | The password policy refused it (`data.rules`) |
| `429001` | `THROTTLE_ERROR` | The global limit, per user when signed in, per IP otherwise (`Retry-After`) |
| `429001` | `RATE_LIMIT_EXCEEDED` | A sign-in limit, or a time zone changed again within 24 hours (`Retry-After`, `data.reason`) |
| `500000` | `GENERIC_ERROR` | An unexpected error. Logged in full, reported to error tracking |
| `500002` | `UPLOAD_DELETE_FAILED` | Deleting a stored file failed |
| `500003` | `UPLOAD_FAILED` | Storing a file failed |
| `503000` | `SERVICE_UNAVAILABLE_ERROR` | A dependency is down (Redis, for the sign-in limits: D-137), or the image queue is full |

The two `429001` rows share a code; tell them apart by `meta.type`.
Retired, never reused (a code must keep one meaning in logs and tickets):
`400001`, `400100`, `400101`, `401002`, `401007`, `403001`, `409001`,
`422002`, `500001`, `503001` (Keycloak's), and two-step sign-in's and
Turnstile's `400105`, `400106`, `400107`, `401009`, `403005`, `409002`,
`409003`, `503002`, `503003`, and `400200` (`USERNAME_ALREADY_SET`, the old
"set a username once" route). A refused CORS origin gets no
error code at all: without CORS headers the browser blocks the answer before
the app could read one.

## Who produces the envelope

Nothing builds it by hand. There are exactly four places it comes from:

| Source | When |
| --- | --- |
| `TransformInterceptor` | Every successful response. A handler returns plain data, or a `ServiceResponse` from `createResponse(...)` for a message of its own. |
| `DomainExceptionFilter` | Every `DomainError`, the errors modules throw (every auth and users error). It maps the error's `kind` to a status, its `errorKey` to the code and type, adds its `details` to `data`, and sets `Retry-After` for a rate limit. |
| `GlobalExceptionFilter` | Every other error that reaches the edge, whatever threw it: `CustomException`, Nest's `HttpException`s (the throttler's 429, a body-parser 413), and anything unexpected (a 500). |
| `createValidationPipe()` | Validation failures, as a 422 with one entry per failing field. |

All four live in `src/shared/presentation/` (filters, interceptors, pipes).

A handler that tries to return `{ meta: ..., data: ... }` itself gets it
wrapped a second time. `createResponse` marks its result with a
non-enumerable brand, and the interceptor checks for that brand rather than
guessing from the keys it has: payload data may legitimately contain a
`message` or a `data`.

The one route that opts out is `/metrics`, with `@RawResponse()`: Prometheus
needs its own text format, not JSON.

## Throwing errors from a module: DomainError

**This is how a module reports an error.** Domain and application code throw
a subclass of `DomainError` ([`src/shared/domain/domain-error.ts`](../src/shared/domain/domain-error.ts)).
It says *what kind* of failure it is and *which catalogued error*, nothing about
HTTP:

```typescript
import { DomainError } from '@/shared/domain'

export class UsernameTakenError extends DomainError {
    readonly kind = 'conflict'                 // → 409
    readonly errorKey = 'USERNAME_CONFLICT'    // → meta.code 409200, meta.type USERNAME_CONFLICT
    constructor() {
        super('That username is taken.')       // → meta.message and data.details
    }
}
```

| `kind` | Status |
| --- | --- |
| `invalid` | 400 |
| `unauthenticated` | 401 |
| `forbidden` | 403 |
| `not_found` | 404 |
| `conflict` | 409 |
| `unprocessable` | 422 |
| `rate_limited` | 429, with `Retry-After` from `retryAfterSeconds` |
| `unavailable` | 503 |

`errorKey` must be a key present in both `ERROR_CODES` and `ERROR_TYPES`: the
compiler refuses anything else. Optional `details` (an object) are added to
`data`, converted to `snake_case`. Never put user data in them.

There is no filter to write or register: `DomainExceptionFilter` handles every
module's errors. The examples to copy are
[`domain/errors/`](../src/modules/auth/domain/errors/) and
`src/modules/users/domain/errors/`.

## CustomException, for shared infrastructure

`CustomException` is the older path, still used by the shared upload and
storage code and by the validation pipe, where an error is about HTTP rather
than the domain:

```typescript
import { CustomException } from '@/shared/presentation/exceptions'
import { ERROR_CODES, ERROR_TYPES } from '@/shared/constants'
import { HttpStatus } from '@nestjs/common'

throw new CustomException({
  code: ERROR_CODES.UPLOAD_INVALID_TYPE,
  type: ERROR_TYPES.UPLOAD_INVALID_TYPE,
  message: 'Only images are accepted',
  status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  errors: optionalDetails, // optional: becomes data.details
})
```

`status` defaults to 500, so a forgotten status is loud. In a module's domain
or application layer, throw a `DomainError` instead.

## Returning success: ServiceResponse

A handler or controller returns plain data, and gets the message `Success`.
For a message of its own, it returns a `ServiceResponse`:

```typescript
import { createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'

return createResponse(MESSAGES.USER.FETCHED, user)
```

The `TransformInterceptor` turns it into the final `meta`/`data` shape.

## Payload case transformation

The wire format is `snake_case`; the code is `camelCase`. The backend converts
both ways, so nobody writes either by hand:

- **Incoming requests:** `SnakeToCamelPipe` (using `camelcase-keys`) converts
  every JSON body key to `camelCase` before validation. A client sends
  `current_password`; the DTO declares `currentPassword`.
- **Outgoing responses:** `TransformInterceptor` (using `snakecase-keys`)
  converts every key back, recursively. The code returns `accessToken`; the
  client reads `access_token`.

Both go through `toSnakeCaseKeys` / `toCamelCaseKeys` in
`src/shared/utils/case-keys.util.ts` rather than calling the libraries
directly. The libraries accept only a plain object, or an array of plain
objects, and **throw on anything else**: a handler returning `['a', 'b']`,
or `[{...}, null]`, answered 500, as did a JSON request body that was an array
of strings. The wrapper walks arrays itself and passes primitives, `null` and
non-plain objects (`Buffer`, `Date`, ...) through untouched.

One asymmetry to know about, since the round trip is not lossless:
`userID → user_id → userId`, and `weird-key → weirdKey`. `forbidNonWhitelisted`
in the validation pipe turns most such cases into a 422 rather than silent
data loss, but do not design a payload that depends on the round trip.

## Request tracking

All requests are tracked with:

- `request_id`: a UUID per request (from `requestIdMiddleware`). A client may
  send its own as `x-request-id`; it is kept only if it is a well-formed UUID.
- `request_duration`: time in milliseconds.

Both are in the success and the error `meta`, and in every log line for the
request, so a `request_id` a user reports finds the logs at once
([logging.md](./logging.md)).

## Messages

`src/shared/constants/messages.ts` holds the English text for success
messages, in groups: `SUCCESS`, `AUTH`, `VALIDATION`, `ERROR`, `UPLOAD`,
`EMAIL`, `USER`, `HEALTH`, `CACHE`, `RATE_LIMIT`. Error messages from a
`DomainError` are written in its class instead, beside the rule they describe.

## Skipping response transformation

Use the `@RawResponse()` decorator when you need to return raw data without the
standard wrapper (CSV exports, binary files, Prometheus metrics):

```typescript
import { RawResponse } from '@/shared/presentation/decorators'

@Controller('export')
export class ExportController {
    @RawResponse()
    @Get('csv')
    exportCsv() {
        return 'name,email\nJohn,john@example.com'  // Returns raw CSV text
    }
}
```

With `@RawResponse()`, the `TransformInterceptor` does not wrap the response in
the `meta`/`data` structure.

## Adding a new error type

1. Add the type and the code to `src/shared/constants/error-response.ts`, under
   the **same key** in both objects. Pick the next free number under the right
   status:

```typescript
export const ERROR_TYPES = {
  // ...existing
  ORDER_ALREADY_PAID: 'ORDER_ALREADY_PAID',
}

export const ERROR_CODES = {
  // ...existing
  ORDER_ALREADY_PAID: '409300',
}
```

2. Throw it as a `DomainError` from your module:

```typescript
export class OrderAlreadyPaidError extends DomainError {
  readonly kind = 'conflict'
  readonly errorKey = 'ORDER_ALREADY_PAID'
  constructor() {
    super('This order is already paid.')
  }
}
```

3. Tell the frontend: the new `meta.type` is its translation key.
   `src/shared/constants/error-response.spec.ts` checks the catalogue stays
   consistent.

## Testing

```bash
API=http://localhost:8888/api/v1

# Success
curl $API/users/me -H "Authorization: Bearer $TOKEN"
# { "meta": { "message": "User fetched successfully", ... }, "data": { ... } }

# An error from a guard
curl $API/users/me
# 401: { "meta": { "code": "401003", "type": "AUTH_TOKEN_MISSING", ... }, "data": { "details", "path", "method" } }

# A route that does not exist
curl $API/users/does-not-exist
# 404: { "meta": { "code": "404000", "type": "NOT_FOUND_ERROR", ... }, ... }
```

Getting a token: [GETTING_STARTED.md](../GETTING_STARTED.md#5-make-yourself-an-account).
