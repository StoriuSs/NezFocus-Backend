# Rate limits on sign-in and accounts

A rate limit caps how often something can happen in a window of time: "at most
5 wrong passwords for one address in 15 minutes". Without them a script could
guess passwords and codes forever, or use "forgot password" to flood someone's
inbox. This page lists every limit the auth routes are under, what each one
counts, what the API answers when one is reached, and how to change them.

Read it if you are building the frontend (to show the right message and wait),
if real users report "Too many requests", or if you want to tune the numbers.

- [Two layers](#two-layers)
- [The global throttler](#the-global-throttler)
- [The auth limits](#the-auth-limits)
- [How the auth limits behave](#how-the-auth-limits-behave)
- [What a refusal looks like](#what-a-refusal-looks-like)
- [Which limits each route uses](#which-limits-each-route-uses)
- [Other caps that are not rate limits](#other-caps-that-are-not-rate-limits)
- [When Redis is down](#when-redis-is-down)
- [Unlocking someone early](#unlocking-someone-early)
- [Changing the numbers](#changing-the-numbers)
- [Watching them](#watching-them)

## Two layers

| Layer | Counts | Keyed on | Where |
|---|---|---|---|
| **Global throttler** | every request to every route | client IP, per route | every module, set by `THROTTLE_*` |
| **Auth limits** | one operation: a failed sign-in, a code email, a wrong code | an address, an IP or a user, per operation | the auth module, set in code |

A request has to pass both. The throttler is a blunt shield against floods; the
auth limits are precise, and know what they are protecting.

## The global throttler

Every route, auth routes included, is under `@nestjs/throttler`, which runs
before authentication:

| Setting | Default | Meaning |
|---|---|---|
| `THROTTLE_TTL` | 60 | Window length, in seconds |
| `THROTTLE_LIMIT` | 100 | Requests allowed per window, **per client IP, per route** |

So one IP can call `POST /auth/login` 100 times a minute and, separately,
`POST /auth/refresh` 100 times a minute. Over that, the answer is:

- **429**, `meta.type: "THROTTLE_ERROR"`, code `429001`;
- a `Retry-After` header in seconds (readable by the web app, as CORS exposes
  it), plus the library's own `Retry-After-relaxed` and
  `X-RateLimit-*-relaxed` headers.

Two things to know for auth:

- The client IP is the real one only because the app trusts one proxy hop
  (`trust proxy 1`, for nginx). Behind a second proxy that does not pass the
  address on, every visitor shares one IP and they all hit the limit together.
- A whole office or school behind one IP shares the limit too. 100 a minute per
  route is comfortable; lowering `THROTTLE_LIMIT` a lot can make
  `/auth/refresh` fail for them.

How the throttler counts, its Redis keys and how to exempt a route are on
[../rate-limit.md](../rate-limit.md).

## The auth limits

All in one file, [rate-limits.ts](../../src/modules/auth/application/rate-limits.ts).
"Reason" is what the 429 says in `data.reason`
([below](#what-a-refusal-looks-like)).

| Name | Limit | Keyed on | Reason | Used by | What counts | Cleared |
|---|---|---|---|---|---|---|
| `login-fail-email` | 5 per 15 min | the email address | `sign_ins` | `login` | failed sign-ins only | when the right password is given for that address |
| `login-fail-ip` | 10 per 15 min | IP | `network` | `login` | failed sign-ins only, any address | never early: the window runs out |
| `register-ip` | 5 per hour | IP | `network` | `register` | every accepted sign-up | — |
| `register-email-min` | 1 per minute | the email address | `emails` | `register` | every accepted sign-up | — |
| `code-email-min` | 1 per minute | the email address | `emails` | `resend-verification`, `forgot-password`, `password/code`, `account/delete-code` | every accepted request | — |
| `code-email-hour` | 5 per hour | the email address | `emails` | `register`, `resend-verification`, `forgot-password`, `password/code`, `account/delete-code` | every accepted request | — |
| `code-email-ip` | 10 per hour | IP | `network` | `resend-verification`, `forgot-password` | every accepted request, any address | — |
| `code-try-ip` | 20 per hour | IP | `network` | `verify-email`, `reset-password`, `password`, `account/delete` (with a code) | **wrong** emailed codes only, any address | — |
| `change-pw-fail` | 5 per 15 min | the user | `wrong_password` | `change-password`, `account/delete` (with a password) | wrong current passwords only | on a successful change or deletion |

All routes are under `/api/v1/auth/`. Why each exists:

- **Per address** limits stop a botnet guessing one account's password from
  thousands of IPs, and stop mail-bombing one inbox. The trade-off is
  deliberate: anyone can lock a person out of password sign-in for 15 minutes by
  failing 5 times on purpose.
- **Per IP** limits stop one machine spraying many addresses: trying one common
  password on 10 000 accounts, or emailing codes to 10 000 strangers.
- **Per user** limits protect actions that need a session but also a second
  proof (the current password), so a stolen session cannot guess the rest.
- **Sign-up's own one-a-minute counter** (`register-email-min`) exists so that
  "sign up, then press *resend code* straight away" is not refused for the
  minute sign-up used. The five an hour are shared with every code email.

Limits keyed on an address count whether or not an account exists, so being
refused says nothing about whether the address is registered. Addresses are
trimmed and lower-cased first, so `Ada@Example.com` and `ada@example.com` share
a counter.

## How the auth limits behave

- **Fixed windows.** A counter starts at the first hit and lasts the whole
  window (15 minutes, an hour), then disappears. It is not a sliding window.
- **Refused without counting.** Before doing anything, a route checks its
  limits without counting. If one is used up, the request is refused and counts
  against nothing. So pressing "send code again" during the one-minute wait does
  not use up the five an hour.
- **Failures only, where it matters.** Sign-in, code checks and password
  checks count only wrong answers. A person who gets it right is never slowed
  down by their own successes.
- **Counted while being checked.** Each guess at a password or a code takes its
  place in the count *before* it is checked, and gives it back if it was right
  (`withGuess` in limits.ts). Checking first and counting a failure afterwards
  would let a burst through: a hundred requests sent at the same moment would
  all pass the check before the first was counted, and a limit of five would
  allow a hundred guesses. Counted first, the sixth request of a burst is
  refused like the sixth of a slow series.
- **The 6th attempt is refused.** A limit of 5 allows five failures; the next
  attempt answers 429 before the password is even checked.
- **The longest wait wins.** When several limits are used up at once, the
  answer names the one with the longest remaining wait, so retrying after
  `Retry-After` actually works.
- **Counted atomically, across instances.** Counters live in Redis and are
  increased by a small Lua script, so two app instances, or two simultaneous
  requests, cannot both slip through.
- **No addresses in Redis.** Keys are `rl:<name>:<SHA-256 of the subject>`.
- **IPv6 counts per /64.** A limit "per IP" counts an IPv4 address on its own,
  and an IPv6 address by its first half, the /64 network. Any IPv6 connection
  (a home, a phone, a rented server) is given a whole /64 and can use a new
  address from it for every request, so counting full IPv6 addresses would
  limit nothing. An IPv4 address in IPv6 form (`::ffff:203.0.113.5`) counts
  as the IPv4 address. The same goes for the global throttler
  ([rate-limit.md](../rate-limit.md)). The code is
  [ip-network.ts](../../src/shared/utils/ip-network.util.ts).
- **They fail open.** See [When Redis is down](#when-redis-is-down).

The machinery is the shared `RateLimiter`
([rate-limiter.ts](../../src/shared/infrastructure/rate-limit/rate-limiter.ts));
the auth module's helpers that decide "check" versus "count" are in
[limits.ts](../../src/modules/auth/application/services/limits.ts).

## What a refusal looks like

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 712

{
  "meta": {
    "code": "429001",
    "type": "RATE_LIMIT_EXCEEDED",
    "message": "Too many failed sign-ins for this address. Try again in 12 minutes.",
    ...
  },
  "data": { "reason": "sign_ins", ... }
}
```

- `Retry-After` is the seconds left in the window, at least 1. CORS exposes it,
  so the web app can show a countdown or disable the button.
- The message gives the wait in seconds under 90 seconds, otherwise in minutes.
- `data.reason` says which kind of limit it was, so the page can say what to do:

| `reason` | Message starts | What the page can say |
|---|---|---|
| `sign_ins` | "Too many failed sign-ins for this address." | Wait, or reset the password |
| `network` | "Too many requests from your network." | Wait. Everyone on this connection (an office, a school) shares this one. |
| `emails` | "We have already sent several emails to this address." | Check the inbox (and spam) for the last email; wait before asking again |
| `wrong_password` | "Too many wrong passwords." | Wait, or reset the password |

Compare with the [global throttler](#the-global-throttler)'s 429: its
`meta.type` is `THROTTLE_ERROR` and it has no `data.reason`.

## Which limits each route uses

| Route | Limits |
|---|---|
| `POST /auth/register` | `register-ip`, `register-email-min`, `code-email-hour` |
| `POST /auth/verify-email` | `code-try-ip` |
| `POST /auth/resend-verification` | `code-email-ip`, `code-email-min`, `code-email-hour` |
| `POST /auth/login` | `login-fail-email`, `login-fail-ip` |
| `POST /auth/forgot-password` | `code-email-ip`, `code-email-min`, `code-email-hour` |
| `POST /auth/reset-password` | `code-try-ip` |
| `POST /auth/change-password` | `change-pw-fail` |
| `POST /auth/password/code` | `code-email-min`, `code-email-hour` (the account's address) |
| `POST /auth/password` | `code-try-ip` |
| `POST /auth/account/delete-code` | `code-email-min`, `code-email-hour` |
| `POST /auth/account/delete` | `change-pw-fail` (password), `code-try-ip` (emailed code) |
| `POST /auth/refresh`, `logout`, `logout-all`, `GET` routes, Google | none beyond the global throttler |

[api-reference.md](api-reference.md) has every route's full error list.

## Other caps that are not rate limits

| Cap | Size | Page |
|---|---|---|
| Tries per emailed code | 5, then the code is dead (`AUTH_CODE_EXPIRED`); a new code replaces the old | [passwords-and-codes.md](passwords-and-codes.md) |
| Emailed code lifetime | 10 minutes | [passwords-and-codes.md](passwords-and-codes.md) |

## When Redis is down

Both layers **fail open**: if Redis cannot be reached, every check allows the
request, and the failure is logged at most once a minute ("Rate limiting
unavailable, allowing the request" for the auth limits, "Rate limit storage
unavailable, allowing requests" for the throttler).

That is a choice. A Redis outage already degrades the app; refusing every
sign-in on top would make it a total outage. The cost is real: while Redis is
down, the brute-force protection is off. The `RedisDown` alert fires, and the
outage should be short. See [security.md](security.md) for how each outside
service fails.

## Unlocking someone early

Waiting is the normal answer: the longest window is an hour. If a real person is
stuck and you have checked it is them, delete their counter in Redis. The key is
the limit's name and the SHA-256 of the lower-cased subject:

```bash
# Which key: here, the per-address sign-in limit for you@example.com
printf '%s' 'you@example.com' | sha256sum
# rl:login-fail-email:<that hash>

docker compose --env-file .env.production -f docker-compose.prod.yaml \
  exec redis redis-cli DEL rl:login-fail-email:<that hash>
```

For the per-user limit (`change-pw-fail`) the subject is the user's id.

## Changing the numbers

The auth limits are code, not environment variables: each number is a decision
with a reason next to it, and changing one should be reviewed. Edit
[rate-limits.ts](../../src/modules/auth/application/rate-limits.ts). Every rule
has a `name` (part of the Redis key), a `limit`, a `windowMs` and a `reason`.

The global throttler is set with `THROTTLE_TTL` and `THROTTLE_LIMIT` in the env
file ([../environment.md](../environment.md)).

The integration test `test/integration/rate-limiter.integration-spec.ts`
covers the limiter against a real Redis.

## Watching them

- `auth_events_total{event="login_rate_limited"}` counts sign-ins refused by a
  limit; the API dashboard in Grafana shows it as "Refused by the limits" in the
  "Sign-in and accounts" row.
- Every refusal is logged at warn level with its message.
- The `AuthFailedLoginSpike` alert fires on more than 50 failed sign-ins in 10
  minutes. See [operations.md](operations.md).
