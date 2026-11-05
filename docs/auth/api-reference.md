# Auth API reference

Every sign-in route the API offers, with exactly what to send, what comes back,
and every error each one can answer. It is written for whoever builds the web
or mobile client: keep it open while you wire up the forms. If you want the
story first (what a refresh token is, why sign-up asks for a code), read
[concepts.md](./concepts.md) and [flows.md](./flows.md), then come back.

Everything here was taken from the code:
the controllers in [presentation/http/](../../src/modules/auth/presentation/http/) (which route is in which:
[in-the-code.md](./in-the-code.md#the-controllers)),
[dto/](../../src/modules/auth/presentation/http/dto/),
[domain/errors/](../../src/modules/auth/domain/errors/),
[error-response.ts](../../src/shared/constants/error-response.ts),
[messages.ts](../../src/shared/constants/messages.ts) and the command handlers
in [application/commands/](../../src/modules/auth/application/commands/). When
they disagree with this page, the code wins: please fix the page.

- [Before you start](#before-you-start)
- [Routes at a glance](#routes-at-a-glance)
- [Signing up](#signing-up)
- [Signing in and staying signed in](#signing-in-and-staying-signed-in)
- [Passwords](#passwords)
- [Deleting the account](#deleting-the-account)
- [Google and other providers](#google-and-other-providers)
- [The current user](#the-current-user)
- [Rate limits by route](#rate-limits-by-route)
- [Error catalogue](#error-catalogue)
- [Success messages](#success-messages)
- [How a client should react](#how-a-client-should-react)
- [Related](#related)

## Before you start

### Paths and the wire format

- Every path below starts with `/api/v1`. `api` is `API_PREFIX` (its
  default), `v1` is the URI version. In development the API listens on
  `http://localhost:8888`, so sign-in is `POST http://localhost:8888/api/v1/auth/login`.
- **Bodies are JSON in snake_case, both ways.** You send `current_password`;
  you receive `access_token`. The API converts to camelCase internally.
- **Unknown body fields are refused** with `422 VALIDATION_ERROR`. A typo such
  as `pasword` is an error, not an ignored field.
- Field checks in the tables below (lengths, the six-digit pattern) are done
  before any handler runs. A failure is `422 VALIDATION_ERROR` (see
  [the envelope](#the-envelope)). Password *rules* (8 characters, a digit and
  so on) are checked later and answer `422 AUTH_PASSWORD_REJECTED` instead,
  so a form can mark each broken rule.
- The full machine-readable schema is the OpenAPI document at `/api-docs`
  ([openapi.md](../openapi.md)).

### The envelope

Every JSON answer, success or error, has the same two parts: `meta` (what
happened) and `data` (the payload).

A success: `POST /api/v1/auth/login` with the right password.

```json
{
  "meta": {
    "message": "Login successful",
    "timestamp": "2026-10-05T09:12:44.120Z",
    "request_id": "3f6c2a5e-1b7d-4c1e-9a3f-2d8e4b6a9c10",
    "request_duration": 212
  },
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOi...",
    "token_type": "Bearer",
    "expires_in": 900
  }
}
```

A success has no `meta.code` or `meta.type`: the route and the status
already say what happened. Only errors have them.

An error raised by the auth module: the sixth wrong password for one address
in 15 minutes. The response also carries the header `Retry-After: 812`.

```json
{
  "meta": {
    "code": "429001",
    "type": "RATE_LIMIT_EXCEEDED",
    "message": "Too many failed sign-ins for this address. Try again in 14 minutes.",
    "timestamp": "2026-10-05T09:14:02.511Z",
    "request_id": "9a1d0c4b-77e2-4f3a-b5c8-0e6f1a2b3c4d",
    "request_duration": 9
  },
  "data": {
    "reason": "sign_ins",
    "details": "Too many failed sign-ins for this address. Try again in 14 minutes.",
    "path": "/api/v1/auth/login",
    "method": "POST"
  }
}
```

What to read in an error:

| Field | Use it for |
|---|---|
| HTTP status | The broad class: 400 fix the input, 401 signed out, 403 not allowed, 409 wrong state, 422 rules, 429 wait, 503 try later |
| `meta.type` | **What your code switches on.** Stable names like `AUTH_CODE_EXPIRED` |
| `meta.code` | The same thing as six digits (`400103`), for logs and support tickets |
| `meta.message` | A sentence you may show the user as it is. It never reveals whether an address has an account |
| `data.<extra>` | Machine-readable details: `reason`, `rules`, `needs` (each listed per route below) |
| `data.details` | The message again (domain errors), or the list of failing fields (validation errors) |
| `meta.request_id` | Quote it when reporting a problem: it finds the request in the logs. Also sent as the `x-request-id` header |

A validation error looks slightly different. `data.details` is a list of
failing fields. Property names in it are the **camelCase** names (the
conversion has already happened), and in development `data.stack` is added.
Sending `full_name` to `/auth/register`:

```json
{
  "meta": {
    "code": "422000",
    "type": "VALIDATION_ERROR",
    "message": "Validation failed",
    "timestamp": "2026-10-05T09:15:10.004Z",
    "request_id": "c2b7e9f1-0d3a-4e5b-8c6d-7f8091a2b3c4",
    "request_duration": 3
  },
  "data": {
    "details": [
      {
        "property": "fullName",
        "constraints": { "whitelistValidation": "property fullName should not exist" },
        "value": "Ada"
      }
    ],
    "path": "/api/v1/auth/register",
    "method": "POST"
  }
}
```

### Who may call a route

| Label in this page | Means |
|---|---|
| **Public** | No token needed. The route has `@Public()` |
| **Signed in** | Send `Authorization: Bearer <access_token>`. The access token is the `access_token` from a sign-in or refresh. Keep it in memory, never in `localStorage` ([sessions-and-tokens.md](./sessions-and-tokens.md)) |
| **Cookie + Origin** | Public, but the route reads a cookie, so it also checks the `Origin` header. Send the request from a page whose origin is in `CORS_ORIGINS`, with credentials (`fetch(..., { credentials: 'include' })` or axios `withCredentials: true`) |
| **Browser navigation** | Not an API call. Point the browser at it (`window.location.href = ...`); it answers with a redirect |

Every signed-in route can answer the [guard errors](#errors-any-route-can-return)
before its own logic runs.

### Cookies

The API sets two cookies. Both are `HttpOnly`: page JavaScript can never read
them, so your code never handles them. It only has to make sure the browser
sends them, by calling with credentials.

| Cookie | Set by | Path | Lives | SameSite | Holds |
|---|---|---|---|---|---|
| `refresh_token` | Every route that signs in ([sign in](#sign-in), [confirm the address](#confirm-the-address), [reset password](#reset-password), [refresh](#refresh), [provider callback](#provider-callback)) | `/api/v1/auth` | Until the session's absolute end (`AUTH_SESSION_TTL_DAYS`, 30 days) | `AUTH_COOKIE_SAMESITE` (default `lax`) | The refresh token. Replaced on every refresh |
| `oauth_state` | [Start a provider sign-in](#start-a-provider-sign-in) | `/api/v1/auth/<provider>/callback` | 10 minutes | `none` if `AUTH_COOKIE_SAMESITE=none`, else `lax` | Ties Google's return to this browser |

`Secure` is on for both in production (and whenever SameSite is `none`),
or as `AUTH_COOKIE_SECURE` says. Cross-site setups are explained in
[sessions-and-tokens.md](./sessions-and-tokens.md).

The cookie is scoped to `/api/v1/auth`, so the browser sends it only to the
auth routes. A cookie-clearing answer (`logout`, `logout-all`,
`account/delete`, a failed `refresh`) only takes effect in the browser if the
request was sent with credentials.

### Errors any route can return

These come from the app's shared layers, not from a handler, so they are not
repeated in every route below.

| When | Status | `meta.type` | `meta.code` | Extras |
|---|---|---|---|---|
| A signed-in route without `Authorization: Bearer ...` | 401 | `AUTH_TOKEN_MISSING` | `401003` | |
| The access token has expired | 401 | `AUTH_TOKEN_EXPIRED` | `401004` | |
| The token is not one this API signed, has the wrong issuer or audience (for example after `BASE_URL` or `JWT_SECRET` changed), or names another user's session | 401 | `AUTH_TOKEN_INVALID` | `401005` | |
| The token is genuine but its session has ended | 401 | `AUTH_TOKEN_REVOKED` | `401006` | `data.reason` (see [session end reasons](#session-end-reasons)) |
| The account was deleted | 403 | `AUTH_ACCOUNT_DISABLED` | `403003` | |
| A body field fails its check, or an unknown field is sent | 422 | `VALIDATION_ERROR` | `422000` | `data.details[]` |
| Malformed JSON | 400 | `BAD_REQUEST_ERROR` | `400000` | |
| The global per-IP throttler: more than `THROTTLE_LIMIT` (default 100) requests to **this route** from one IP in `THROTTLE_TTL` (60) seconds | 429 | `THROTTLE_ERROR` | `429001` | `Retry-After` header (seconds). No `data.reason` |
| The request took longer than the request timeout | 408 | `REQUEST_TIMEOUT_ERROR` | `408000` | |
| Something broke on the server (database or Redis down, a bug) | 500 | `GENERIC_ERROR` | `500000` | The message is "Internal server error" in production |

<a id="session-end-reasons"></a>
**Session end reasons.** `data.reason` on `401 AUTH_TOKEN_REVOKED` (any
signed-in route) and on `401 AUTH_REFRESH_FAILED` (refresh) says why the
session ended. Only the holder of that dead session is told.

| `data.reason` | Why |
|---|---|
| `signed_out` | This session signed out (`POST /auth/logout`) |
| `signed_out_everywhere` | "Sign out everywhere", from any device |
| `password_changed` | The password was changed (other devices) or reset (every device) |
| `security` | Its refresh token was used twice, so it is presumed stolen |
| `account_deleted` | The account was deleted (on refresh only: signed-in routes answer `403 AUTH_ACCOUNT_DISABLED` instead) |
| `expired` | It reached its absolute end |
| (absent) | Unknown token, no cookie, or nothing more to say |

A deleted account gets `403 AUTH_ACCOUNT_DISABLED` on signed-in routes rather
than a 401.

## Routes at a glance

`/api/v1` is left out of this table for width.

| Method and path | Who | Success | Section |
|---|---|---|---|
| `POST /auth/register` | Public | 202 | [Sign up](#sign-up) |
| `POST /auth/verify-email` | Public | 200, signs in | [Confirm the address](#confirm-the-address) |
| `POST /auth/resend-verification` | Public | 202 | [Send the sign-up email again](#send-the-sign-up-email-again) |
| `POST /auth/login` | Public | 200, signs in | [Sign in](#sign-in) |
| `POST /auth/refresh` | Cookie + Origin | 200 | [Refresh](#refresh) |
| `POST /auth/logout` | Cookie + Origin | 200 | [Sign out](#sign-out) |
| `POST /auth/logout-all` | Signed in | 200 | [Sign out everywhere](#sign-out-everywhere) |
| `POST /auth/forgot-password` | Public | 202 | [Forgot password](#forgot-password) |
| `POST /auth/reset-password` | Public | 200, signs in | [Reset password](#reset-password) |
| `POST /auth/change-password` | Signed in | 200 | [Change password](#change-password) |
| `GET /auth/sign-in-methods` | Signed in | 200 | [Sign-in methods](#sign-in-methods) |
| `POST /auth/password/code` | Signed in | 200 | [Email a code to set a first password](#email-a-code-to-set-a-first-password) |
| `POST /auth/password` | Signed in | 200 | [Set a first password](#set-a-first-password) |
| `POST /auth/account/delete-code` | Signed in | 200 | [Email a deletion code](#email-a-deletion-code) |
| `POST /auth/account/delete` | Signed in | 200 | [Delete the account](#delete-the-account) |
| `GET /auth/options` | Public | 200 | [Sign-in options](#sign-in-options) |
| `GET /auth/{provider}` | Browser navigation | 302 | [Start a provider sign-in](#start-a-provider-sign-in) |
| `GET /auth/{provider}/callback` | Browser navigation (from Google) | 302 | [Provider callback](#provider-callback) |
| `GET /users/me` | Signed in | 200 | [The current user](#the-current-user) |

<a id="token-answer"></a>
**The token answer.** Every route that signs someone in answers `200` with
this `data`, and sets the `refresh_token` cookie in the same response:

| Field | Type | Meaning |
|---|---|---|
| `access_token` | string | A JWT. Send it as `Authorization: Bearer <access_token>` |
| `token_type` | `"Bearer"` | Always `Bearer` |
| `expires_in` | integer | Seconds until it expires (`JWT_ACCESS_TTL_SECONDS`, default 900). Refresh shortly before |

The refresh token is never in a body.

## Signing up

### Sign up

`POST /api/v1/auth/register` · Public · no cookies

Creates an account and emails a six-digit code to confirm the address. It
does **not** sign in. The answer is the same for a new address, one that
already has an account, and one registered but never confirmed, so this route
cannot be used to find out who has an account. (A confirmed address gets a
"you already have an account" email instead of a code; an unconfirmed one gets
the new password and a fresh code.)

| Field | Type | Required | Checked by the DTO |
|---|---|---|---|
| `email` | string | yes | Trimmed, a valid email address, at most 254 characters |
| `password` | string | yes | 1 to 1024 characters. The password rules come later ([passwords-and-codes.md](./passwords-and-codes.md)) |

**Success:** `202`,
message "Check your email to continue.", `data: null`.

**Errors**, in the order they are checked:

| Status | `meta.type` | `meta.code` | When | Extras |
|---|---|---|---|---|
| 422 | `AUTH_PASSWORD_REJECTED` | `422004` | The password breaks a rule (checked against the address only) | `data.rules`: rule ids such as `["uppercase","special"]` |
| 429 | `RATE_LIMIT_EXCEEDED` | `429001` | `register-ip` (5 an hour per IP) | `data.reason: "network"`, `Retry-After` |
| 429 | `RATE_LIMIT_EXCEEDED` | `429001` | `register-email-min` (1 a minute per address) or `code-email-hour` (5 an hour per address) | `data.reason: "emails"`, `Retry-After` |

### Confirm the address

`POST /api/v1/auth/verify-email` · Public · sets `refresh_token`

Confirms the address with the emailed code and the password chosen at
sign-up, and signs in. The password stops someone who signs the same address
up again before you confirm from taking the account over
([accounts.md](./accounts.md#confirming-the-address)).

| Field | Type | Required | Checked by the DTO |
|---|---|---|---|
| `email` | string | yes | Trimmed, valid email, at most 254 |
| `code` | string | yes | Trimmed, exactly six digits (`^\d{6}$`); otherwise "code must be the six digits from the email" |
| `password` | string | yes | 1 to 1024 characters. The password from the last sign-up for this address |

**Success:** `200`,
message "Your email address is confirmed. You are signed in.",
`data`: [the token answer](#token-answer).

**Errors:**

| Status | `meta.type` | `meta.code` | When | Extras |
|---|---|---|---|---|
| 429 | `RATE_LIMIT_EXCEEDED` | `429001` | `code-try-ip`: 20 wrong codes an hour from this IP | `data.reason: "network"`, `Retry-After` |
| 400 | `AUTH_CODE_INVALID` | `400102` | Wrong code, wrong password, no code pending (already confirmed, or a newer code replaced it), or no such account. One error for all, on purpose. A wrong password does not use up one of the code's tries | |
| 400 | `AUTH_CODE_EXPIRED` | `400103` | The code is older than 10 minutes, or this was its 5th wrong try | |

Each wrong code counts against `code-try-ip`.

### Send the sign-up email again

`POST /api/v1/auth/resend-verification` · Public · no cookies

Sends a new code to an unconfirmed address, "you already have an account" to
a confirmed one, and nothing to an unknown one. The answer is the same in
every case.

| Field | Type | Required | Checked by the DTO |
|---|---|---|---|
| `email` | string | yes | Trimmed, valid email, at most 254 |

**Success:** `202`,
message "If that address has an account, an email is on its way.", `data: null`.

**Errors:**

| Status | `meta.type` | `meta.code` | When | Extras |
|---|---|---|---|---|
| 429 | `RATE_LIMIT_EXCEEDED` | `429001` | `code-email-ip`: 10 an hour from this IP | `data.reason: "network"`, `Retry-After` |
| 429 | `RATE_LIMIT_EXCEEDED` | `429001` | `code-email-min` (1 a minute) or `code-email-hour` (5 an hour) for this address | `data.reason: "emails"`, `Retry-After` |

Every accepted request counts, whether or not the address has an account.

## Signing in and staying signed in

### Sign in

`POST /api/v1/auth/login` · Public · sets `refresh_token`

| Field | Type | Required | Checked by the DTO |
|---|---|---|---|
| `email` | string | yes | Trimmed, valid email, at most 254 |
| `password` | string | yes | 1 to 1024 characters |

**Success:** `200`,
message "Login successful", `data`: [the token answer](#token-answer).

**Errors**, in the order they are checked:

| Status | `meta.type` | `meta.code` | When | Extras |
|---|---|---|---|---|
| 429 | `RATE_LIMIT_EXCEEDED` | `429001` | `login-fail-email`: 5 failed sign-ins for this address in 15 minutes | `data.reason: "sign_ins"`, `Retry-After` |
| 429 | `RATE_LIMIT_EXCEEDED` | `429001` | `login-fail-ip`: 10 failed sign-ins from this IP in 15 minutes, any addresses | `data.reason: "network"`, `Retry-After` |
| 401 | `AUTH_INVALID_CREDENTIALS` | `401001` | Wrong password, unknown address, or an account with no password (made with Google). One error for all three, on purpose | |
| 403 | `AUTH_EMAIL_NOT_VERIFIED` | `403002` | The password was right but the address is not confirmed yet. Offer to [resend the code](#send-the-sign-up-email-again) | |

Only failures count against the two limits. A right password clears the
address's count (not the IP's).

### Refresh

`POST /api/v1/auth/refresh` · Cookie + Origin · reads and replaces `refresh_token`

A new access token from the refresh cookie. No body. Send it with credentials.
Each refresh token works once: the answer carries a new cookie. Two tabs
refreshing at once with the same cookie both succeed, if the second comes
within 10 seconds of the first.

**Success:** `200`,
message "Token refreshed successfully", `data`: [the token answer](#token-answer).

**Errors:**

| Status | `meta.type` | `meta.code` | When | Extras |
|---|---|---|---|---|
| 403 | `AUTH_FORBIDDEN` | `403004` | The request has an `Origin` header that is not in `CORS_ORIGINS`. The cookie is left alone. A request with no `Origin` (curl, a mobile app) is allowed | |
| 401 | `AUTH_REFRESH_FAILED` | `401008` | No cookie, an unknown or expired token, a token presented twice (theft), or its session has ended. **The cookie is cleared** | `data.reason` (optional): `expired`, `signed_out`, `signed_out_everywhere`, `password_changed`, `security`, `account_deleted` ([reasons](#session-end-reasons)) |

No auth limit applies, only the global throttler. A refresh does not extend
the session: it ends `AUTH_SESSION_TTL_DAYS` after sign-in whatever happens.

### Sign out

`POST /api/v1/auth/logout` · Cookie + Origin · reads, then clears `refresh_token`

Ends the session the cookie belongs to. No body, no bearer token needed.

**Success:** `200`,
message "Logout successful", `data: null`. Always, even with no cookie or a
dead one: the result is the same, signed out.

**Errors:**

| Status | `meta.type` | `meta.code` | When |
|---|---|---|---|
| 403 | `AUTH_FORBIDDEN` | `403004` | `Origin` present and not in `CORS_ORIGINS`. Nothing changes |

### Sign out everywhere

`POST /api/v1/auth/logout-all` · Signed in · clears `refresh_token`

Ends every session of the user, this one included. No body.

**Success:** `200`,
message "Signed out on every device", `data: null`. Other devices get
`401 AUTH_TOKEN_REVOKED` with `reason: "signed_out_everywhere"` on their next
request. Send it with credentials so the cookie-clearing header applies.

**Errors:** the guard errors only.

## Passwords

### Forgot password

`POST /api/v1/auth/forgot-password` · Public · no cookies

Emails a code for choosing a new password. For an account without a password
(made with Google), the email offers to choose one. The answer is the same
whether or not the address has an account.

| Field | Type | Required | Checked by the DTO |
|---|---|---|---|
| `email` | string | yes | Trimmed, valid email, at most 254 |

**Success:** `202`,
message "If that address has an account, an email is on its way.", `data: null`.

**Errors:**

| Status | `meta.type` | `meta.code` | When | Extras |
|---|---|---|---|---|
| 429 | `RATE_LIMIT_EXCEEDED` | `429001` | `code-email-ip`: 10 an hour from this IP | `data.reason: "network"`, `Retry-After` |
| 429 | `RATE_LIMIT_EXCEEDED` | `429001` | `code-email-min` (1 a minute) or `code-email-hour` (5 an hour) for this address | `data.reason: "emails"`, `Retry-After` |

### Reset password

`POST /api/v1/auth/reset-password` · Public · sets `refresh_token`

Sets a new password with the emailed code, ends **every** earlier session,
confirms the address, and signs in on this device.

| Field | Type | Required | Checked by the DTO |
|---|---|---|---|
| `email` | string | yes | Trimmed, valid email, at most 254 |
| `code` | string | yes | Trimmed, exactly six digits |
| `password` | string | yes | 1 to 1024. The new password |

**Success:** `200`, message "Your password has been changed. You
are signed in.", `data`: [the token answer](#token-answer).

**Errors**, in the order they are checked:

| Status | `meta.type` | `meta.code` | When | Extras |
|---|---|---|---|---|
| 429 | `RATE_LIMIT_EXCEEDED` | `429001` | `code-try-ip`: 20 wrong codes an hour from this IP | `data.reason: "network"`, `Retry-After` |
| 422 | `AUTH_PASSWORD_REJECTED` | `422004` | The new password breaks a rule. Checked against the address before the account is looked up, then against the username. The code is not used up | `data.rules` |
| 400 | `AUTH_CODE_INVALID` | `400102` | Wrong code, no code pending, or no such account | |
| 400 | `AUTH_CODE_EXPIRED` | `400103` | Older than 10 minutes, or its 5th wrong try | |

### Change password

`POST /api/v1/auth/change-password` · Signed in

Changes the password, knowing the current one. Ends every **other** session;
this one stays signed in.

| Field | Type | Required | Checked by the DTO |
|---|---|---|---|
| `current_password` | string | yes | 1 to 1024 |
| `new_password` | string | yes | 1 to 1024 |

**Success:** `200`, message "Password has been changed
successfully", `data: null`.

**Errors**, besides the guard errors:

| Status | `meta.type` | `meta.code` | When | Extras |
|---|---|---|---|---|
| 429 | `RATE_LIMIT_EXCEEDED` | `429001` | `change-pw-fail`: 5 wrong current passwords for this account in 15 minutes | `data.reason: "wrong_password"`, `Retry-After` |
| 400 | `AUTH_CURRENT_PASSWORD_INVALID` | `400104` | The current password is wrong, or the account has no password (use [set a first password](#set-a-first-password)). A 400, not a 401: the session is fine, and clients sign out on any 401 | |
| 422 | `AUTH_PASSWORD_REJECTED` | `422004` | The new password breaks a rule (checked against the address and the username) | `data.rules` |

The new password may equal the old one: there is no "different from current"
rule.

### Sign-in methods

`GET /api/v1/auth/sign-in-methods` · Signed in

How this account signs in, for a settings page that offers "set a password"
only when there is none.

**Success:** `200`, message
"Operation completed successfully".

| `data` field | Type | Meaning |
|---|---|---|
| `password` | boolean | The account has a password |
| `providers` | string[] | Linked providers by id, sorted, for example `["google"]` |

**Errors:** the guard errors only.

### Email a code to set a first password

`POST /api/v1/auth/password/code` · Signed in

For an account without a password (made with Google): emails a code to set
one. No body.

**Success:** `200`, `data: null`.

**Errors**, besides the guard errors:

| Status | `meta.type` | `meta.code` | When | Extras |
|---|---|---|---|---|
| 409 | `AUTH_PASSWORD_ALREADY_SET` | `409004` | The account already has a password: use [change password](#change-password) | |
| 429 | `RATE_LIMIT_EXCEEDED` | `429001` | `code-email-min` (1 a minute) or `code-email-hour` (5 an hour) for the account's address | `data.reason: "emails"`, `Retry-After` |
| 400 | `AUTH_CODE_INVALID` | `400102` | The account has no address (its data was erased). Should not happen to a signed-in user | |

### Set a first password

`POST /api/v1/auth/password` · Signed in

Sets the first password with the code from the route above. Sessions and the
Google link are kept.

| Field | Type | Required | Checked by the DTO |
|---|---|---|---|
| `code` | string | yes | Trimmed, exactly six digits |
| `new_password` | string | yes | 1 to 1024 |

**Success:** `200`, `data: null`.

**Errors**, in order, besides the guard errors:

| Status | `meta.type` | `meta.code` | When | Extras |
|---|---|---|---|---|
| 429 | `RATE_LIMIT_EXCEEDED` | `429001` | `code-try-ip`: 20 wrong codes an hour from this IP | `data.reason: "network"`, `Retry-After` |
| 400 | `AUTH_CODE_INVALID` | `400102` | The account has no address | |
| 409 | `AUTH_PASSWORD_ALREADY_SET` | `409004` | The account already has a password | |
| 422 | `AUTH_PASSWORD_REJECTED` | `422004` | The password breaks a rule. The code is not used up | `data.rules` |
| 400 | `AUTH_CODE_INVALID` | `400102` | Wrong code, or none pending | |
| 400 | `AUTH_CODE_EXPIRED` | `400103` | Older than 10 minutes, or its 5th wrong try | |

## Deleting the account

[accounts.md](./accounts.md) explains what deletion removes, and when.

### Email a deletion code

`POST /api/v1/auth/account/delete-code` · Signed in

For an account without a password (made with Google), which has nothing else
to prove it is the owner: emails a code. No body.

**Success:** `200`, `data: null`.

**Errors**, besides the guard errors:

| Status | `meta.type` | `meta.code` | When | Extras |
|---|---|---|---|---|
| 409 | `AUTH_USE_PASSWORD` | `409005` | The account has a password: send it to [delete the account](#delete-the-account) instead | |
| 429 | `RATE_LIMIT_EXCEEDED` | `429001` | `code-email-min` or `code-email-hour` for the account's address | `data.reason: "emails"`, `Retry-After` |
| 403 | `AUTH_ACCOUNT_DISABLED` | `403003` | The account has no address or was deleted | |

### Delete the account

`POST /api/v1/auth/account/delete` · Signed in · clears `refresh_token`

Deletes the signed-in user's own account, with proof it is them. Every
session ends, this one included. The owner is emailed.

| Field | Type | Needed when | Checked by the DTO |
|---|---|---|---|
| `password` | string | the account has a password | 1 to 1024 |
| `code` | string | the account has **no** password (from [email a deletion code](#email-a-deletion-code)) | Trimmed, exactly six digits |

**Success:** `200`,
message "Account deleted successfully", `data: null`. Send it with
credentials so the cookie is cleared.

**Errors**, in the order they are checked, besides the guard errors:

| Status | `meta.type` | `meta.code` | When | Extras |
|---|---|---|---|---|
| 400 | `AUTH_CONFIRMATION_REQUIRED` | `400108` | Some proof is missing. Ask for exactly what `needs` lists, then send again | `data.needs`: `["password"]` or `["code"]` |
| 429 | `RATE_LIMIT_EXCEEDED` | `429001` | `change-pw-fail`: 5 wrong passwords in 15 minutes | `data.reason: "wrong_password"`, `Retry-After` |
| 400 | `AUTH_CURRENT_PASSWORD_INVALID` | `400104` | Wrong password | |
| 429 | `RATE_LIMIT_EXCEEDED` | `429001` | `code-try-ip`: 20 wrong emailed codes an hour from this IP | `data.reason: "network"`, `Retry-After` |
| 400 | `AUTH_CODE_INVALID` | `400102` | Wrong emailed code, or none pending | |
| 400 | `AUTH_CODE_EXPIRED` | `400103` | Emailed code older than 10 minutes, or its 5th wrong try | |
| 404 | `USER_NOT_FOUND` | `404001` | Two deletions of the same account raced and this one lost | |
| 403 | `AUTH_ACCOUNT_DISABLED` | `403003` | Already deleted | |

## Google and other providers

[google-sign-in.md](./google-sign-in.md) explains the flow; the routes are
below. The provider id in the path is `google` (the only provider the starter
configures).

### Sign-in options

`GET /api/v1/auth/options` · Public

What the sign-in pages need to draw themselves. Call it once when the page
loads.

**Success:** `200`.

| `data` field | Type | Meaning |
|---|---|---|
| `providers` | string[] | Configured providers, for example `["google"]`; `[]` when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are empty. Show a "Continue with ..." button per id |

**Errors:** none of its own.

### Start a provider sign-in

`GET /api/v1/auth/{provider}?redirect=/path` · Browser navigation · sets `oauth_state`

Send the browser here (not `fetch`). It answers `302` to Google's consent
screen.

| Query | Required | Meaning |
|---|---|---|
| `redirect` | no | A path of the web app to land on afterwards, such as `/settings`. Anything that is not a plain path (starts with `//`, has a `\`, a control character, or is over 2048 characters) becomes `/` |

**Errors** (as JSON, since the browser is still on the API):

| Status | `meta.type` | `meta.code` | When |
|---|---|---|---|
| 404 | `NOT_FOUND_ERROR` | `404000` | No provider with that id is configured |
| 500 | `GENERIC_ERROR` | `500000` | Google's discovery document or Redis could not be reached |

### Provider callback

`GET /api/v1/auth/{provider}/callback` · Browser navigation (Google sends the browser here) · reads and clears `oauth_state`; sets `refresh_token`

You never call this yourself: it is the redirect URI registered with Google.
It always answers `302` to the web app's `FRONTEND_URL/auth/callback`, with
one of these query strings:

| Outcome | Query | Cookie set | What the callback page does |
|---|---|---|---|
| Signed in | `redirect=<path>` and maybe `notice=password_removed` | `refresh_token` | Call [refresh](#refresh) to get an access token, then go to `redirect` |
| Did not work | `error=<reason>` and, if the attempt was found, `redirect=<path>` | none | Show the message for the reason below |

| `error` | Meaning |
|---|---|
| `cancelled` | The person chose not to continue at Google |
| `email_unverified` | Google has not verified the account's address |
| `account_deleted` | The Google account is linked to a deleted account |
| `failed` | Anything else: the return does not match this browser's cookie, the attempt expired (10 minutes) or was used, Google refused the code or ID token, or the database or Redis failed. The API log says which |

`notice=password_removed` means an account registered with this address but
never confirmed had its password removed when Google linked it (someone else
may have registered it first). The web app must check `redirect` again before
following it. The only JSON this route answers is `404 NOT_FOUND_ERROR` for an
unknown provider.

## The current user

`GET /api/v1/users/me` · Signed in

Not an auth route, but where a client learns who is signed in. It is read
through the same per-request session check, so it reflects the account as it
is now.

**Success:** `200`,
message "User fetched successfully".

| `data` field | Type | Auth meaning |
|---|---|---|
| `id` | string | The user id (the access token's `sub`) |
| `email` | string | The sign-in address, lower-case |
| `email_verified` | boolean | Always `true` for a signed-in user: sign-in needs a confirmed address |
| `roles` | string[] | `["user"]` by default; `admin` and others are given with `pnpm user:promote` ([accounts.md](./accounts.md)). Not in the token: read them here |
| `username`, `display_name`, `avatar_url`, `bio`, `has_set_username` | | The profile, owned by the users module |

**Errors:** the guard errors.

## Rate limits by route

Auth limits answer `429 RATE_LIMIT_EXCEEDED` with `data.reason` and
`Retry-After`. On top of them, every route has the global throttler
(`429 THROTTLE_ERROR`, per IP per route). Details and tuning:
[rate-limits.md](./rate-limits.md).

| Limit | Allows | Counted per | `data.reason` | Routes | What counts |
|---|---|---|---|---|---|
| `login-fail-email` | 5 per 15 min | address | `sign_ins` | login | Failed sign-ins; cleared by a right password |
| `login-fail-ip` | 10 per 15 min | IP | `network` | login | Failed sign-ins |
| `register-ip` | 5 per hour | IP | `network` | register | Accepted sign-ups |
| `register-email-min` | 1 per minute | address | `emails` | register | Accepted sign-ups |
| `code-email-min` | 1 per minute | address | `emails` | resend-verification, forgot-password, password/code, account/delete-code | Emails sent |
| `code-email-hour` | 5 per hour | address | `emails` | register and the four above | Emails sent |
| `code-email-ip` | 10 per hour | IP | `network` | resend-verification, forgot-password | Requests |
| `code-try-ip` | 20 per hour | IP | `network` | verify-email, reset-password, password, account/delete (emailed code) | Wrong codes only |
| `change-pw-fail` | 5 per 15 min | account | `wrong_password` | change-password, account/delete | Wrong passwords; cleared on success |

A refused request counts against nothing. When several limits refuse, the
answer names the one with the longest wait. The 429 message says the wait in
words ("Try again in 14 minutes"); `Retry-After` gives it in seconds, and CORS
exposes that header to the page.

## Error catalogue

Every error type an auth route can answer. HTTP status follows from the error's
kind; `meta.code` and `meta.type` come from
[error-response.ts](../../src/shared/constants/error-response.ts).

| `meta.type` | Status | `meta.code` | Message (as sent) | `data` extras |
|---|---|---|---|---|
| `AUTH_INVALID_CREDENTIALS` | 401 | `401001` | Incorrect email or password. | |
| `AUTH_TOKEN_MISSING` | 401 | `401003` | Sign in to continue. | |
| `AUTH_TOKEN_EXPIRED` | 401 | `401004` | Your access token has expired. | |
| `AUTH_TOKEN_INVALID` | 401 | `401005` | Your access token is not valid. | |
| `AUTH_TOKEN_REVOKED` | 401 | `401006` | This session has ended. Sign in again. | `reason` (optional) |
| `AUTH_REFRESH_FAILED` | 401 | `401008` | Your session has ended. Sign in again. | `reason` (optional) |
| `AUTH_CODE_INVALID` | 400 | `400102` | That code is not right. If you asked for more than one, only the newest works. | |
| `AUTH_CODE_EXPIRED` | 400 | `400103` | This code no longer works: it expired, or had too many wrong tries. Ask for a new one. | |
| `AUTH_CURRENT_PASSWORD_INVALID` | 400 | `400104` | Your current password is not right. | |
| `AUTH_CONFIRMATION_REQUIRED` | 400 | `400108` | Confirm it is you first. | `needs` |
| `AUTH_EMAIL_NOT_VERIFIED` | 403 | `403002` | Confirm your email address before signing in. We can send you a new code. | |
| `AUTH_ACCOUNT_DISABLED` | 403 | `403003` | This account has been deleted. | |
| `AUTH_FORBIDDEN` | 403 | `403004` | This request did not come from an allowed site. | |
| `NOT_FOUND_ERROR` | 404 | `404000` | There is no sign-in with that provider here. | |
| `USER_NOT_FOUND` | 404 | `404001` | (from the users module) | |
| `AUTH_PASSWORD_ALREADY_SET` | 409 | `409004` | This account already has a password. Change it instead. | |
| `AUTH_USE_PASSWORD` | 409 | `409005` | This account has a password: confirm with it instead. | |
| `AUTH_PASSWORD_REJECTED` | 422 | `422004` | One sentence per broken rule, joined | `rules` |
| `VALIDATION_ERROR` | 422 | `422000` | Validation failed | `details[]` |
| `RATE_LIMIT_EXCEEDED` | 429 | `429001` | "<reason sentence> Try again in N seconds/minutes." | `reason`, `Retry-After` header |
| `THROTTLE_ERROR` | 429 | `429001` | ThrottlerException: Too Many Requests | `Retry-After` header |

The `RATE_LIMIT_EXCEEDED` sentence per `data.reason`:

| `data.reason` | Sentence | Counted per |
|---|---|---|
| `network` | Too many requests from your network. | IP (everyone behind one office or school connection shares it) |
| `emails` | We have already sent several emails to this address. | address |
| `sign_ins` | Too many failed sign-ins for this address. | address |
| `wrong_password` | Too many wrong passwords. | account |

The wait is in seconds under 90 seconds, in minutes from there.

`data.rules` values for `AUTH_PASSWORD_REJECTED`: `min_length`, `max_length`,
`lowercase`, `uppercase`, `digit`, `special`, `matches_email`,
`matches_username`, `common` (their messages and exact meaning:
[passwords-and-codes.md](./passwords-and-codes.md)). The policy is plain
TypeScript in [password-policy.ts](../../src/modules/auth/domain/password-policy.ts),
so a client can copy it to check as the user types.

`401000` (`AUTH_UNAUTHORIZED`) is only the fallback for a bare 401 thrown
outside the auth module. `401002`, `401007`, `409001` and `503001` (Keycloak's)
are retired, never reused: sign-up never says an address is taken.

## Success messages

A success carries no code or type, only `meta.message`, an English sentence
for logs; react to the status and `data`.

| Route | Status | `meta.message` |
|---|---|---|
| register | 202 | Check your email to continue. |
| resend-verification, forgot-password | 202 | If that address has an account, an email is on its way. |
| verify-email | 200 | Your email address is confirmed. You are signed in. |
| login | 200 | Login successful |
| refresh | 200 | Token refreshed successfully |
| logout | 200 | Logout successful |
| logout-all | 200 | Signed out on every device |
| reset-password | 200 | Your password has been changed. You are signed in. |
| change-password | 200 | Password has been changed successfully |
| account/delete | 200 | Account deleted successfully |
| sign-in-methods, password/code, password, account/delete-code, options | 200 | Operation completed successfully |
| users/me | 200 | User fetched successfully |

## How a client should react

Switch on `meta.type` (and the HTTP status for the generic cases).

| You get | Do this |
|---|---|
| `401 AUTH_TOKEN_EXPIRED` on any signed-in route | Call [refresh](#refresh) once, then retry the request with the new token. Better: refresh a little before `expires_in` runs out |
| `401 AUTH_TOKEN_INVALID` | Refresh once; if that fails too, treat it as signed out |
| `401 AUTH_TOKEN_REVOKED` | Signed out. Clear the access token, go to sign-in, and use `data.reason` to say why ("You signed out on another device", "Your password was changed") |
| `401 AUTH_TOKEN_MISSING` | You forgot the header, or nobody is signed in: go to sign-in |
| `401 AUTH_REFRESH_FAILED` | Signed out (the cookie is already cleared). Go to sign-in; `data.reason` says why. On page load this just means "no session": show the signed-out page quietly |
| `403 AUTH_ACCOUNT_DISABLED` | The account was deleted. Clear everything, go to the signed-out page |
| `403 AUTH_FORBIDDEN` on refresh or logout | A configuration problem, not the user's: the page's origin is not in `CORS_ORIGINS`. Log it; the user can only try again later |
| `403 AUTH_EMAIL_NOT_VERIFIED` | Go to the "enter the code" screen with the address filled in, and offer "send a new code" ([resend](#send-the-sign-up-email-again)) |
| `401 AUTH_INVALID_CREDENTIALS` | "Incorrect email or password", nothing more specific |
| `422 AUTH_PASSWORD_REJECTED` | Mark each rule in `data.rules` under the password field. Keep what they typed in other fields |
| `422 VALIDATION_ERROR` | A client bug or a malformed field: show the field from `data.details[].property` (camelCase) |
| `400 AUTH_CODE_INVALID` | "That code is not right" and let them retry. If they asked for several, only the newest works |
| `400 AUTH_CODE_EXPIRED` | The code is dead: offer to send a new one |
| `400 AUTH_CURRENT_PASSWORD_INVALID` | Mark the current-password field. Do **not** sign out |
| `400 AUTH_CONFIRMATION_REQUIRED` | Ask for the item in `data.needs` (the password or an emailed code) and send again. For `code`, first call [email a deletion code](#email-a-deletion-code) |
| `409 AUTH_USE_PASSWORD` | Ask for the password instead of sending a code |
| `409 AUTH_PASSWORD_ALREADY_SET` | Show "change password" instead of "set a password" |
| `429 RATE_LIMIT_EXCEEDED` | Show `meta.message` (it says how long). Read `Retry-After` to disable the button until then. `data.reason` tells you what to suggest (`emails`: check spam; `sign_ins`: reset the password) |
| `429 THROTTLE_ERROR` | Too many requests from this IP to this route: wait `Retry-After` seconds |
| `?error=` on the callback page | Show a message per reason (`cancelled` needs none). Keep `redirect` for the next attempt |
| `?notice=password_removed` | Tell the person a password set before the address was confirmed was removed; they can set one in settings |
| `500 GENERIC_ERROR` | "Something went wrong", with `meta.request_id` for support |

## Related

- [README.md](./README.md): the auth set's start page
- [flows.md](./flows.md): the same routes as step-by-step flows with diagrams
- [sessions-and-tokens.md](./sessions-and-tokens.md): the access token, the cookie, and cross-site setups
- [rate-limits.md](./rate-limits.md): every limit, and how to tune them
- [in-the-code.md](./in-the-code.md): which file handles each route
- [operations.md](./operations.md): what to check when a route answers something unexpected in production
- [../openapi.md](../openapi.md): the generated OpenAPI document
