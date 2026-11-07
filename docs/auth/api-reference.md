# Auth API reference

Every sign-in route the API offers, with exactly what to send, what comes back,
and every error each one can answer. It is written for whoever builds the web
or mobile client: keep it open while you wire up the forms. If you want the
story first (what a refresh token is, why sign-up is a code by email), read
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
- [Signing up or in with a code](#signing-up-or-in-with-a-code)
- [Completing the account](#completing-the-account)
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
Sending `full_name` to `/auth/email-code`:

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
    "path": "/api/v1/auth/email-code",
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
before its own logic runs. Among them is `403 ACCOUNT_INCOMPLETE` for an
account that has not done [complete your account](#complete-your-account);
only three signed-in routes answer such an account ([the gate](#the-gate)).

### Cookies

The API sets two cookies. Both are `HttpOnly`: page JavaScript can never read
them, so your code never handles them. It only has to make sure the browser
sends them, by calling with credentials.

| Cookie | Set by | Path | Lives | SameSite | Holds |
|---|---|---|---|---|---|
| `refresh_token` | Every route that signs in ([sign in with the code](#sign-in-with-the-code), [sign in](#sign-in), [reset password](#reset-password), [refresh](#refresh), [provider callback](#provider-callback)) | `/api/v1/auth` | Until the session's absolute end (`AUTH_SESSION_TTL_DAYS`, 30 days) | `AUTH_COOKIE_SAMESITE` (default `lax`) | The refresh token. Replaced on every refresh |
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
| The account has not done "complete your account", and the route is not one of the [three that allow it](#the-gate) | 403 | `ACCOUNT_INCOMPLETE` | `403100` | |
| A body field fails its check, or an unknown field is sent | 422 | `VALIDATION_ERROR` | `422000` | `data.details[]` |
| Malformed JSON | 400 | `BAD_REQUEST_ERROR` | `400000` | |
| The global throttler: more than `THROTTLE_LIMIT` (default 100) requests to **this route** from one signed-in user, or `THROTTLE_ANONYMOUS_LIMIT` (default 300) from one IP without a valid access token, in `THROTTLE_TTL` (60) seconds (D-135) | 429 | `THROTTLE_ERROR` | `429001` | `Retry-After` header (seconds). No `data.reason` |
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
| `POST /auth/email-code` | Public | 202 | [Email a sign-in code](#email-a-sign-in-code) |
| `POST /auth/email-code/verify` | Public | 200, signs in | [Sign in with the code](#sign-in-with-the-code) |
| `POST /auth/complete-account` | Signed in, not completed | 200 | [Complete your account](#complete-your-account) |
| `POST /auth/login` | Public | 200, signs in | [Sign in](#sign-in) |
| `POST /auth/refresh` | Cookie + Origin | 200 | [Refresh](#refresh) |
| `POST /auth/logout` | Cookie + Origin | 200 | [Sign out](#sign-out) |
| `POST /auth/logout-all` | Signed in | 200 | [Sign out everywhere](#sign-out-everywhere) |
| `POST /auth/forgot-password` | Public | 202 | [Forgot password](#forgot-password) |
| `POST /auth/reset-password` | Public | 200, signs in | [Reset password](#reset-password) |
| `POST /auth/change-password` | Signed in | 200 | [Change password](#change-password) |
| `GET /auth/sign-in-methods` | Signed in | 200 | [Sign-in methods](#sign-in-methods) |
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

The refresh token is never in a body. [Sign in with the code](#sign-in-with-the-code)
adds one more field, `account`.

<a id="language-field"></a>
**The `language` field.** Every route that sends an email takes an optional
`language`: `vi` or `en`, default `en`. It is the language of the page, and
the email is written in it (D-132). Anything else is `422 VALIDATION_ERROR`
("language must be vi or en"). The routes: `email-code`, `forgot-password`,
`reset-password`, `change-password` and `account/delete`.

## Signing up or in with a code

Creating an account and signing in with a code are one flow (D-59, D-60):
ask for a code, then send it back. A right code signs in to the address's
account, or creates one at that moment.

### Email a sign-in code

`POST /api/v1/auth/email-code` · Public · no cookies

Emails a six-digit code to the address. Every address gets one, with an
account or not; only the email's wording differs ("your sign-in code", or
"your code to create an account"). The answer is the same for every address,
so this route cannot be used to find out who has an account. Asking again is
the same call: the new code replaces the old one.

| Field | Type | Required | Checked by the DTO |
|---|---|---|---|
| `email` | string | yes | Trimmed, a valid email address, at most 254 characters |
| `language` | string | no | `vi` or `en` ([the `language` field](#language-field)) |

**Success:** `202`,
message "Check your email for the code.", `data: null`.

**Errors:**

| Status | `meta.type` | `meta.code` | When | Extras |
|---|---|---|---|---|
| 429 | `RATE_LIMIT_EXCEEDED` | `429001` | `code-email-ip`: 30 in 5 minutes from this IP | `data.reason: "network"`, `Retry-After` |
| 429 | `RATE_LIMIT_EXCEEDED` | `429001` | `code-email-min` (1 a minute) or `code-email-hour` (5 an hour) for this address, shared with reset codes | `data.reason: "recent_email"` (the minute) or `"emails"` (the hour), `Retry-After` |

Every accepted request counts, whether or not the address has an account.

### Sign in with the code

`POST /api/v1/auth/email-code/verify` · Public · sets `refresh_token`

Signs in with the emailed code. If the address has no account, one is made
now: no password, no username, not completed yet.

| Field | Type | Required | Checked by the DTO |
|---|---|---|---|
| `email` | string | yes | Trimmed, valid email, at most 254 |
| `code` | string | yes | Trimmed, exactly six digits (`^\d{6}$`); otherwise "code must be the six digits from the email" |

**Success:** `200`, message "You are signed in.", `data`:
[the token answer](#token-answer) plus `account`:

| `data.account` field | Type | Meaning |
|---|---|---|
| `created` | boolean | This sign-in made the account: the address had none |
| `completed` | boolean | The account has done the "complete your account" step. `false` for every new account |

An account with `completed: false` must do
[complete your account](#complete-your-account) next: until then most
signed-in routes answer `403 ACCOUNT_INCOMPLETE` ([the gate](#the-gate)).

**Errors:**

| Status | `meta.type` | `meta.code` | When | Extras |
|---|---|---|---|---|
| 429 | `RATE_LIMIT_EXCEEDED` | `429001` | `code-try-ip`: 30 wrong codes in 5 minutes from this IP | `data.reason: "network"`, `Retry-After` |
| 429 | `RATE_LIMIT_EXCEEDED` | `429001` | `code-fail-email`: 10 wrong codes an hour for this address, across its codes (D-134) | `data.reason: "codes"`, `Retry-After` |
| 400 | `AUTH_CODE_INVALID` | `400102` | Wrong code, no code sent, a newer code replaced it, or another request used it first | |
| 400 | `AUTH_CODE_EXPIRED` | `400103` | The code is older than 10 minutes, or this was its 5th wrong try | |

Each wrong code counts against `code-try-ip` and `code-fail-email`. A right
code is used up before the account is touched, so one code makes one session.

## Completing the account

Every new account, made by a code or by Google, starts not completed (D-61).
[accounts.md](./accounts.md#completing-the-account) explains what the step
stores and why in that order.

### The gate

Until the account is completed, every signed-in route answers
`403 ACCOUNT_INCOMPLETE` (`403100`), except the three the "complete your
account" page needs (they carry `@AllowIncomplete()`):

| Route | Why it answers |
|---|---|
| `POST /auth/complete-account` | The step itself |
| `GET /users/me` | Its `completed` field says where the client should go |
| `GET /users/username-available/:username` | The username check while typing |

Public routes (sign-in, `refresh`, `logout`, `forgot-password`, `reset-password`)
are not gated. Not a 401: the session is fine, so a client must not sign out
on it.

### Complete your account

`POST /api/v1/auth/complete-account` · Signed in, not completed yet · no cookies

| Field | Type | Required | Checked by the DTO |
|---|---|---|---|
| `display_name` | string | yes | Trimmed, 1 to 32 characters |
| `username` | string | yes | Trimmed and lower-cased, then 2 to 32 of `a-z 0-9 _ .` ("username must be 2-32 lowercase letters, numbers, underscores or dots"). Permanent |
| `password` | string | yes | 1 to 1024. The rules are checked by the handler |
| `timezone` | string | yes | An IANA zone name such as `Asia/Ho_Chi_Minh`, stored as sent, but in ICU's letter case (`asia/tokyo` is stored `Asia/Tokyo`). An offset (`+07:00`, or `Etc/GMT+7` in any letter case) is refused |
| `language` | string | yes | `vi` or `en`: the account's language, also used for emails nobody asked for |
| `terms_accepted` | boolean | yes | Must be `true` ("terms_accepted must be true") |

**Success:** `200`, message "Account completed", `data: null`. The access
token in use keeps working and now passes the gate; read
[`GET /users/me`](#the-current-user) again for the profile. No email is sent,
except "password changed" when the account already had a password (chosen
through "forgot password"). If that email or dropping the cached user fails,
it is logged and the answer is still `200`: the account is completed.

**Errors**, in the order they are checked, besides the guard errors:

| Status | `meta.type` | `meta.code` | When | Extras |
|---|---|---|---|---|
| 403 | `AUTH_ACCOUNT_DISABLED` | `403003` | The account was deleted a moment ago | |
| 409 | `ACCOUNT_ALREADY_COMPLETE` | `409100` | The account is already completed, including by another submission at the same moment | |
| 422 | `AUTH_PASSWORD_REJECTED` | `422004` | The password breaks a rule, or is the email, the part before `@`, or this username (D-66) | `data.rules` |
| 409 | `USERNAME_CONFLICT` | `409200` | A live account has the username. Decided as it is written: [username-available](#the-gate) is only a hint | |

The password is written in the same transaction that completes the account.
If the username is taken, or another submission completed the account first,
nothing is written, the password included: send again with another username.

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
| 429 | `RATE_LIMIT_EXCEEDED` | `429001` | `login-fail-ip`: 30 failed sign-ins from this IP in 5 minutes, any addresses | `data.reason: "network"`, `Retry-After` |
| 401 | `AUTH_INVALID_CREDENTIALS` | `401001` | Wrong password, unknown address, or an account with no password (made by a code or with Google, and not completed). One error for all three, on purpose | |

Only failures count against the two limits. A right password clears the
address's count (not the IP's). A right password that a reset replaced while
it was being checked answers `401 AUTH_INVALID_CREDENTIALS` too, without
counting: the reset ended every session, and this sign-in must not open one.

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
(not completed, or made with Google), the email offers to choose one. The
answer is the same whether or not the address has an account. An address with
no account still gets a stored code that nobody is sent, so guesses at it
wear it out after five exactly like a real one (D-121).

| Field | Type | Required | Checked by the DTO |
|---|---|---|---|
| `email` | string | yes | Trimmed, valid email, at most 254 |
| `language` | string | no | `vi` or `en` ([the `language` field](#language-field)) |

**Success:** `202`,
message "If that address has an account, an email is on its way.", `data: null`.
Also when the email cannot be queued: that is logged, and the answer stays the
same as for an address with no account.

**Errors:**

| Status | `meta.type` | `meta.code` | When | Extras |
|---|---|---|---|---|
| 429 | `RATE_LIMIT_EXCEEDED` | `429001` | `code-email-ip`: 30 in 5 minutes from this IP | `data.reason: "network"`, `Retry-After` |
| 429 | `RATE_LIMIT_EXCEEDED` | `429001` | `code-email-min` (1 a minute) or `code-email-hour` (5 an hour) for this address, shared with sign-in codes | `data.reason: "recent_email"` (the minute) or `"emails"` (the hour), `Retry-After` |

### Reset password

`POST /api/v1/auth/reset-password` · Public · sets `refresh_token`

Sets a new password with the emailed code, ends **every** earlier session,
and signs in on this device. On an account with no password this adds one,
and the owner is emailed "password added" instead of "password changed".

| Field | Type | Required | Checked by the DTO |
|---|---|---|---|
| `email` | string | yes | Trimmed, valid email, at most 254 |
| `code` | string | yes | Trimmed, exactly six digits |
| `password` | string | yes | 1 to 1024. The new password |
| `language` | string | no | `vi` or `en`, for the email that follows ([the `language` field](#language-field)) |

**Success:** `200`, message "Your password has been changed. You
are signed in.", `data`: [the token answer](#token-answer). Once the password
is changed and the sessions ended, dropping cached copies and queueing the
email are logged if they fail; the answer is still `200`.

**Errors**, in the order they are checked:

| Status | `meta.type` | `meta.code` | When | Extras |
|---|---|---|---|---|
| 429 | `RATE_LIMIT_EXCEEDED` | `429001` | `code-try-ip`: 30 wrong codes in 5 minutes from this IP | `data.reason: "network"`, `Retry-After` |
| 429 | `RATE_LIMIT_EXCEEDED` | `429001` | `code-fail-email`: 10 wrong codes an hour for this address (D-134) | `data.reason: "codes"`, `Retry-After` |
| 422 | `AUTH_PASSWORD_REJECTED` | `422004` | The new password breaks a rule that needs only the address. Checked before the code, so it does not use a try | `data.rules` |
| 400 | `AUTH_CODE_INVALID` | `400102` | Wrong code, no code pending, or no such account | |
| 400 | `AUTH_CODE_EXPIRED` | `400103` | Older than 10 minutes, or its 5th wrong try | |
| 422 | `AUTH_PASSWORD_REJECTED` | `422004` | The password is the username (D-66). Checked only once the code is known right; the code is not used up, and sending it again with another password uses no try | `data.rules: ["matches_username"]` |

### Change password

`POST /api/v1/auth/change-password` · Signed in

Changes the password, knowing the current one. Ends every **other** session;
this one stays signed in.

| Field | Type | Required | Checked by the DTO |
|---|---|---|---|
| `current_password` | string | yes | 1 to 1024 |
| `new_password` | string | yes | 1 to 1024 |
| `language` | string | no | `vi` or `en`, for the "password changed" email ([the `language` field](#language-field)) |

**Success:** `200`, message "Password has been changed
successfully", `data: null`.

**Errors**, besides the guard errors:

| Status | `meta.type` | `meta.code` | When | Extras |
|---|---|---|---|---|
| 429 | `RATE_LIMIT_EXCEEDED` | `429001` | `change-pw-fail`: 5 wrong current passwords for this account in 15 minutes | `data.reason: "wrong_password"`, `Retry-After` |
| 400 | `AUTH_CURRENT_PASSWORD_INVALID` | `400104` | The current password is wrong, or the account has no password (it chooses one with [forgot password](#forgot-password)). A 400, not a 401: the session is fine, and clients sign out on any 401 | |
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

An account without a password chooses its first one with
[forgot password](#forgot-password) and [reset password](#reset-password).

## Deleting the account

[accounts.md](./accounts.md) explains what deletion removes, and when.

### Delete the account

`POST /api/v1/auth/account/delete` · Signed in · clears `refresh_token`

Deletes the signed-in user's own account, with the password as proof it is
them. Every session ends, this one included. The owner is emailed. An account
without a password chooses one with [forgot password](#forgot-password) first.

| Field | Type | Required | Checked by the DTO |
|---|---|---|---|
| `password` | string | no, but without it the answer is `AUTH_CONFIRMATION_REQUIRED` | 1 to 1024 |
| `language` | string | no | `vi` or `en`, for the "account deleted" email ([the `language` field](#language-field)) |

**Success:** `200`,
message "Account deleted successfully", `data: null`. Send it with
credentials so the cookie is cleared.

**Errors**, in the order they are checked, besides the guard errors:

| Status | `meta.type` | `meta.code` | When | Extras |
|---|---|---|---|---|
| 400 | `AUTH_CONFIRMATION_REQUIRED` | `400108` | No password was sent, or the account has none (it chooses one with [forgot password](#forgot-password) first) | `data.needs`: `["password"]` |
| 429 | `RATE_LIMIT_EXCEEDED` | `429001` | `change-pw-fail`: 5 wrong passwords in 15 minutes | `data.reason: "wrong_password"`, `Retry-After` |
| 400 | `AUTH_CURRENT_PASSWORD_INVALID` | `400104` | Wrong password | |
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
| Signed in | `redirect=<path>` | `refresh_token` | Call [refresh](#refresh) to get an access token, then go to `redirect` |
| Did not work | `error=<reason>` and, if the attempt was found, `redirect=<path>` | none | Show the message for the reason below |

| `error` | Meaning |
|---|---|
| `cancelled` | The person chose not to continue at Google |
| `email_unverified` | Google has not verified the account's address |
| `account_deleted` | The Google account is linked to a deleted account |
| `failed` | Anything else: the return does not match this browser's cookie, the attempt expired (10 minutes) or was used, Google refused the code or ID token, or the database or Redis failed. The API log says which |

A new address gets a new account, not completed, with no password and the
display name from Google cut to 32 characters; an existing account is linked,
and its owner is emailed that a sign-in method was added, in the account's
language (English if it has none yet). The web app must check `redirect` again before
following it. The only JSON this route answers is `404 NOT_FOUND_ERROR` for an
unknown provider.

## The current user

`GET /api/v1/users/me` · Signed in, completed or not

Not an auth route, but where a client learns who is signed in. It is read
through the same per-request session check, so it reflects the account as it
is now. It answers before the account is completed too ([the gate](#the-gate)).

**Success:** `200`,
message "User fetched successfully".

| `data` field | Type | Auth meaning |
|---|---|---|
| `id` | string | The user id (the access token's `sub`) |
| `email` | string | The sign-in address, lower-case |
| `roles` | string[] | `["user"]` by default; `admin` and others are given with `pnpm user:promote` ([accounts.md](./accounts.md)). Not in the token: read them here |
| `completed` | boolean | The account has done [complete your account](#complete-your-account). While `false`, open that step: other signed-in routes answer `403 ACCOUNT_INCOMPLETE` |
| `username`, `display_name`, `avatar_url`, `bio` | | The profile, owned by the users module. `username` is absent until the account is completed |

**Errors:** the guard errors.

## Rate limits by route

Auth limits answer `429 RATE_LIMIT_EXCEEDED` with `data.reason` and
`Retry-After`. On top of them, every route has the global throttler
(`429 THROTTLE_ERROR`, per route, per user when signed in and per IP
otherwise). Details and tuning:
[rate-limits.md](./rate-limits.md).

| Limit | Allows | Counted per | `data.reason` | Routes | What counts |
|---|---|---|---|---|---|
| `login-fail-email` | 5 per 15 min | address | `sign_ins` | login | Failed sign-ins; cleared by a right password |
| `login-fail-ip` | 30 per 5 min | IP | `network` | login | Failed sign-ins |
| `code-email-min` | 1 per minute | address | `recent_email` | email-code, forgot-password | Emails asked for |
| `code-email-hour` | 5 per hour | address | `emails` | email-code, forgot-password | Emails asked for |
| `code-email-ip` | 30 per 5 min | IP | `network` | email-code, forgot-password | Requests |
| `code-try-ip` | 30 per 5 min | IP | `network` | email-code/verify, reset-password | Wrong codes only |
| `code-fail-email` | 10 per hour | address | `codes` | email-code/verify, reset-password | Wrong codes only, across the address's codes (D-134) |
| `change-pw-fail` | 5 per 15 min | account | `wrong_password` | change-password, account/delete | Wrong passwords; cleared on success |

With Redis down, these limits cannot be counted and every route listed here
answers `503 SERVICE_UNAVAILABLE_ERROR` (D-137); the global throttler lets
requests through.

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
| `AUTH_ACCOUNT_DISABLED` | 403 | `403003` | This account has been deleted. | |
| `AUTH_FORBIDDEN` | 403 | `403004` | This request did not come from an allowed site. | |
| `ACCOUNT_INCOMPLETE` | 403 | `403100` | Complete your account first. | |
| `NOT_FOUND_ERROR` | 404 | `404000` | There is no sign-in with that provider here. | |
| `USER_NOT_FOUND` | 404 | `404001` | (from the users module) | |
| `ACCOUNT_ALREADY_COMPLETE` | 409 | `409100` | This account is already complete. | |
| `USERNAME_CONFLICT` | 409 | `409200` | Username already taken: {username} (from the users module) | |
| `AUTH_PASSWORD_REJECTED` | 422 | `422004` | One sentence per broken rule, joined | `rules` |
| `VALIDATION_ERROR` | 422 | `422000` | Validation failed | `details[]` |
| `RATE_LIMIT_EXCEEDED` | 429 | `429001` | "<reason sentence> Try again in N seconds/minutes." | `reason`, `Retry-After` header |
| `THROTTLE_ERROR` | 429 | `429001` | ThrottlerException: Too Many Requests | `Retry-After` header |
| `SERVICE_UNAVAILABLE_ERROR` | 503 | `503000` | Signing in is unavailable for a moment. Try again shortly. | Redis is down, and the auth limits fail closed (D-137): any route with an [auth limit](#rate-limits-by-route) |

The `RATE_LIMIT_EXCEEDED` sentence per `data.reason`:

| `data.reason` | Sentence | Counted per |
|---|---|---|
| `network` | Too many requests from your network. | IP (everyone behind one office or school connection shares it) |
| `recent_email` | We have just sent an email with a code to this address. | address |
| `emails` | We have already sent several emails to this address. | address |
| `sign_ins` | Too many failed sign-ins for this address. | address |
| `wrong_password` | Too many wrong passwords. | account |
| `codes` | Too many wrong codes for this address. | address |

The wait is in seconds under 90 seconds, in minutes from there.

`data.rules` values for `AUTH_PASSWORD_REJECTED`: `min_length`, `max_length`,
`lowercase`, `uppercase`, `digit`, `special`, `matches_email`,
`matches_username` (their messages and exact meaning:
[passwords-and-codes.md](./passwords-and-codes.md)). The policy is plain
TypeScript in [password-policy.ts](../../src/modules/auth/domain/password-policy.ts),
so a client can copy it to check as the user types.

`401000` (`AUTH_UNAUTHORIZED`) is only the fallback for a bare 401 thrown
outside the auth module. `401002`, `401007`, `409001` and `503001` (Keycloak's)
are retired, never reused: sign-up never says an address is taken. `403002`,
`409004` and `409005` belonged to the old sign-up and first-password routes
and are retired too. `400200` (`USERNAME_ALREADY_SET`, the old
"set a username once" route) is retired.

## Success messages

A success carries no code or type, only `meta.message`, an English sentence
for logs; react to the status and `data`.

| Route | Status | `meta.message` |
|---|---|---|
| email-code | 202 | Check your email for the code. |
| forgot-password | 202 | If that address has an account, an email is on its way. |
| email-code/verify | 200 | You are signed in. |
| complete-account | 200 | Account completed |
| login | 200 | Login successful |
| refresh | 200 | Token refreshed successfully |
| logout | 200 | Logout successful |
| logout-all | 200 | Signed out on every device |
| reset-password | 200 | Your password has been changed. You are signed in. |
| change-password | 200 | Password has been changed successfully |
| account/delete | 200 | Account deleted successfully |
| sign-in-methods, options | 200 | Operation completed successfully |
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
| `401 AUTH_INVALID_CREDENTIALS` | "Incorrect email or password", nothing more specific |
| `422 AUTH_PASSWORD_REJECTED` | Mark each rule in `data.rules` under the password field. Keep what they typed in other fields |
| `422 VALIDATION_ERROR` | A client bug or a malformed field: show the field from `data.details[].property` (camelCase) |
| `400 AUTH_CODE_INVALID` | "That code is not right" and let them retry. If they asked for several, only the newest works |
| `400 AUTH_CODE_EXPIRED` | The code is dead: offer to send a new one |
| `400 AUTH_CURRENT_PASSWORD_INVALID` | Mark the current-password field. Do **not** sign out |
| `400 AUTH_CONFIRMATION_REQUIRED` | Ask for the password and send again. An account with no password ([sign-in methods](#sign-in-methods) says `password: false`) chooses one with [forgot password](#forgot-password) first |
| `200` from `email-code/verify` with `account.completed: false`, or `completed: false` from `GET /users/me` | Open the "complete your account" step ([`POST /auth/complete-account`](#complete-your-account)) |
| `403 ACCOUNT_INCOMPLETE` | Not signed out: go to the "complete your account" step. Keep the session |
| `409 ACCOUNT_ALREADY_COMPLETE` | Already done (another tab, a double click): read `GET /users/me` and go into the app |
| `409 USERNAME_CONFLICT` on complete-account | Mark the username field "taken" and let them pick another; keep the other fields |
| `429 RATE_LIMIT_EXCEEDED` | Show `meta.message` (it says how long). Read `Retry-After` to disable the button until then. `data.reason` tells you what to suggest (`recent_email`: the last email is on its way, from another tab or flow; `emails`: check spam; `sign_ins`: reset the password; `codes`: ask for a new code later) |
| `429 THROTTLE_ERROR` | Too many requests to this route from this user, or from this IP when not signed in: wait `Retry-After` seconds |
| `?error=` on the callback page | Show a message per reason (`cancelled` needs none). Keep `redirect` for the next attempt |
| `500 GENERIC_ERROR` | "Something went wrong", with `meta.request_id` for support |

## Related

- [README.md](./README.md): the auth set's start page
- [flows.md](./flows.md): the same routes as step-by-step flows with diagrams
- [sessions-and-tokens.md](./sessions-and-tokens.md): the access token, the cookie, and cross-site setups
- [rate-limits.md](./rate-limits.md): every limit, and how to tune them
- [in-the-code.md](./in-the-code.md): which file handles each route
- [operations.md](./operations.md): what to check when a route answers something unexpected in production
- [../openapi.md](../openapi.md): the generated OpenAPI document
