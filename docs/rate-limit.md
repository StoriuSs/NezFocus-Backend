<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**  *generated with [DocToc](https://github.com/thlorenz/doctoc)*

- [Rate Limiting](#rate-limiting)
  - [Overview](#overview)
  - [Where It Runs](#where-it-runs)
  - [Configuration](#configuration)
  - [How the Global Throttler Counts](#how-the-global-throttler-counts)
    - [Tracker: the client IP](#tracker-the-client-ip)
    - [Buckets: per endpoint, per IP](#buckets-per-endpoint-per-ip)
    - [Fixed window](#fixed-window)
    - [Storage: atomic Redis counters](#storage-atomic-redis-counters)
    - [Redis unavailable: fail open](#redis-unavailable-fail-open)
  - [Redis Keys](#redis-keys)
  - [Per-Route Control](#per-route-control)
  - [Behind Nginx and Cloudflare](#behind-nginx-and-cloudflare)
  - [Limits for One Operation: RateLimiter](#limits-for-one-operation-ratelimiter)
  - [Sign-in Routes: Two Layers of Limits](#sign-in-routes-two-layers-of-limits)
  - [Monitoring & Health Checks](#monitoring--health-checks)
  - [Troubleshooting](#troubleshooting)
  - [Related Documentation](#related-documentation)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

# Rate Limiting

## Overview

This page is for anyone who needs to know why a request got `429 Too Many Requests`, or wants to change a limit. It covers the **global throttler**, which every route has, and the `RateLimiter` that the sign-in limits are built on. The sign-in limits themselves (five wrong passwords, one code email a minute...) are listed in [auth/rate-limits.md](./auth/rate-limits.md).

Every request passes through the global throttler (`@nestjs/throttler`) before authentication runs. It counts requests per client IP and per route in Redis, so the limit holds across all app instances, and answers `429 Too Many Requests` once a client exceeds it.

The throttler is a cheap first line of defence against floods and scripted abuse. It is not a per-user quota system: it runs before authentication, so it never knows who the user is (see [Where It Runs](#where-it-runs)).

## Where It Runs

Global guards run in registration order (`src/app.module.ts`):

```
Request
  │
  ▼
RequestContextGuard ← never refuses: copies the route onto the request for metrics
  │
  ▼
ThrottlerGuard      ← counts by IP and route; 429 when over the limit
  │
  ▼
AccessTokenGuard    ← 401 without a valid token (unless @Public)
  │
  ▼
RolesGuard          ← 403 without a required role
  │
  ▼
Handler
```

The throttler **must** come first. The auth guard throws on a missing token, so if it ran first, unauthenticated traffic — exactly what rate limiting is for — would never be counted.

The cost of that ordering: `req.user` is not populated yet, so the throttler cannot key on the user. Anonymous and authenticated requests are both tracked by IP.

## Configuration

```env
THROTTLE_TTL=60      # window length, seconds (default 60)
THROTTLE_LIMIT=100   # requests allowed per window, per endpoint, per IP (default 100)
```

The defaults in code ([`throttle.config.ts`](../src/config/throttle.config.ts), [`validation.ts`](../src/config/validation.ts)) and in `.env.example` are the same: 100 requests a minute. That is generous for one person and tight for a script. Lower it if you want a harsher floor; raise it if many users share one IP (an office, a school, a mobile carrier's NAT).

`src/config/throttle.config.ts` reads them; `src/app.module.ts` registers one throttler named **`relaxed`** with those values and `KeyvThrottlerStorage` as its storage.

## How the Global Throttler Counts

### Tracker: the client IP

```typescript
getTracker: (req) => Promise.resolve(ipNetwork(req.ip || req.socket?.remoteAddress || 'unknown'))
```

`ipNetwork` ([ip-network.ts](../src/shared/utils/ip-network.util.ts)) leaves an
IPv4 address as it is and turns an IPv6 address into its /64 network
(`2001:db8:85a3:42::/64`). Every IPv6 connection is given a whole /64 and can
send each request from a new address in it; counting full addresses would let
one client make unlimited requests.

`req.ip` is only the real client address because [`src/bootstrap/configure-app.ts`](../src/bootstrap/configure-app.ts) sets `app.set('trust proxy', 1)`. Without it, behind a reverse proxy every request appears to come from the proxy and all clients share one bucket — including the Docker healthcheck. See [Behind Nginx and Cloudflare](#behind-nginx-and-cloudflare).

### Buckets: per endpoint, per IP

`@nestjs/throttler` builds the storage key from the **controller class, handler name, throttler name and tracker**, hashed with SHA-256. Each endpoint therefore has its own bucket per IP: with `THROTTLE_LIMIT=100`, one IP can make 100 requests to `GET /users/me` *and* 100 to `PATCH /users/me` in the same window.

### Fixed window

The counter's expiry is set only when the counter is created, never refreshed. A client that hits the limit is refused until that window ends, then starts fresh. (Refreshing the TTL on every request would turn a one-window throttle into an indefinite lockout for a client that keeps retrying.)

### Storage: atomic Redis counters

`KeyvThrottlerStorage` (`src/shared/infrastructure/throttler/keyv-throttler.storage.ts`) talks to Redis directly through the shared `REDIS_CLIENT`, **not** through the 2-layer cache:

```lua
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return { hits, redis.call('PTTL', KEYS[1]) }
```

- **Atomic.** One script increments and reads. A get-then-set loses increments when requests interleave, so a burst of 60 parallel requests could count as a handful.
- **Shared.** An in-memory layer would give every instance its own count, making the effective limit `instances × limit`.

If a throttler is configured with `blockDuration`, exceeding the limit also writes a block key with that expiry. The default throttler does not set one.

### The 429 answer

A refused request gets the usual error envelope (`meta.code` `429001`, `meta.type` `THROTTLE_ERROR`) and two headers saying how many seconds to wait:

- `Retry-After-relaxed`, which `@nestjs/throttler` names after the throttler;
- `Retry-After`, the standard header, copied from it by `GlobalExceptionFilter`.

A web app on another origin can only read headers that CORS exposes, and the API exposes `Retry-After` only (`exposedHeaders` in [`configure-app.ts`](../src/bootstrap/configure-app.ts)). So clients should read `Retry-After`. It is the same header the sign-in limits send, so one piece of client code handles both.

### Redis unavailable: fail open

If Redis cannot be reached, the storage logs an error and **allows** the request. Rate limiting protects the service; refusing every request during a Redis outage would turn a cache failure into a full outage. The Redis client is created with `disableOfflineQueue`, so this happens immediately rather than after requests hang.

## Redis Keys

| Key | Value | Expiry |
|---|---|---|
| `throttle:relaxed:<sha256>` | request count in the current window | window length, set on first request |
| `throttle:block:relaxed:<sha256>` | `1` while blocked (only with `blockDuration`) | `blockDuration` |

The hash covers `<Controller>-<handler>-relaxed-<ip>`, so keys cannot be read back to an IP. To inspect:

```bash
docker exec -it redis-hexagonal-auth redis-cli -a "$REDIS_PASSWORD"
SCAN 0 MATCH throttle:* COUNT 100
GET throttle:relaxed:<hash>
PTTL throttle:relaxed:<hash>
```

## Per-Route Control

Skip throttling for a route or controller:

```typescript
@SkipRateLimit()
@Get('something')
something() { ... }
```

Override the limit for one route — the key inside `@Throttle` must match the throttler name, `relaxed`:

```typescript
@Throttle({ relaxed: { limit: 3, ttl: 60_000 } })
@Post('expensive-operation')
expensiveOperation() { ... }
```

`@SkipThrottle()` with no argument skips a throttler called `default`, which does not exist here, so it skips nothing. Use the starter's `@SkipRateLimit()` (from `@/shared/presentation/decorators`), which names `relaxed` for you.

`/metrics` is exempt this way: `MetricsController` carries `@SkipRateLimit()` ([`metrics.controller.ts`](../src/shared/infrastructure/monitoring/metrics.controller.ts)), because Prometheus scrapes it from one address every few seconds. Nothing in `app.module.ts` matches URLs.

## Behind Nginx and Cloudflare

The trust chain has to line up, or every client collapses into one bucket:

1. **Cloudflare → Nginx.** `nginx/app.conf.template` trusts Cloudflare's published IP ranges and takes the client address from `CF-Connecting-IP` (`real_ip_header`), rewriting `$remote_addr`.
2. **Nginx → app.** Nginx forwards `X-Forwarded-For` with that address.
3. **App.** `trust proxy` is `1` (in `src/bootstrap/configure-app.ts`) — exactly one hop (Nginx) is trusted, so `req.ip` becomes the client address from `X-Forwarded-For`, and a client cannot spoof it by sending its own header.

If you add another proxy hop (a load balancer in front of Nginx), raise the `trust proxy` hop count to match. This matters more than for the throttler alone: the sign-in limits per IP ("10 failed sign-ins per IP in 15 minutes") use `req.ip` too. With the wrong count, either every user shares one IP and one person's typos lock everyone out, or a client can pick its own IP and is never limited. [domain-dns-tls.md](./setup/domain-dns-tls.md) covers Cloudflare's proxy setting.

## Limits for One Operation: RateLimiter

The throttler counts every request from an IP. Some limits are about one
operation and one subject instead — "five failed sign-ins per address", "one
code email a minute". For those, inject `RateLimiter`
(`src/shared/infrastructure/rate-limit/rate-limiter.ts`, provided by the global
`CacheModule`):

```typescript
const rule = { name: 'invite-email', limit: 3, windowMs: 60 * 60 * 1000 }

const state = await this.limiter.hit(rule, email)   // count one, and say if over
if (state.limited) throw new RateLimitedError(state.retryAfterSeconds)

await this.limiter.check(rule, email)   // over already? without counting
await this.limiter.reset(rule, email)   // forget the subject's hits
```

- **Atomic.** `hit` is one Lua script (`INCR`, and the window's expiry on the
  first hit), so fifty requests at once let exactly `limit` through, on any
  number of instances.
- **Fixed window**, like the throttler, starting at the subject's first hit.
- **Subjects are hashed** into the key (`rl:<name>:<sha256>`): no email address
  sits in Redis in clear.
- **Fails open** when Redis is down, logged once a minute.

Throwing a `DomainError` of kind `rate_limited` (as `RateLimitedError` in the
auth module does) answers `429` with a `Retry-After` header.

The auth module's limits are all in [`src/modules/auth/application/rate-limits.ts`](../src/modules/auth/application/rate-limits.ts).

## Sign-in Routes: Two Layers of Limits

The routes under `/api/v1/auth/` have no `@Throttle` or `@SkipRateLimit`, so
the **global throttler applies to them as to every route**: each one allows
`THROTTLE_LIMIT` requests per window per IP. On top of that, the auth module
counts what matters for security with `RateLimiter`: failed sign-ins per
address and per IP, sign-ups per IP, code emails per address, wrong codes,
wrong current passwords, wrong two-step codes. Those limits, their numbers,
what counts and how each one resets are in
[auth/rate-limits.md](./auth/rate-limits.md). They are not repeated here, so
that there is one table to keep correct.

What the two layers mean in practice:

- A request can be refused by either. Both answer `meta.code` `429001` and
  send `Retry-After`. The throttler's has `meta.type` `THROTTLE_ERROR`. An
  auth limit's has `meta.type` `RATE_LIMIT_EXCEEDED` and a `data.reason`
  (`sign_ins`, `network`, `emails`, `wrong_password`, `wrong_codes`) that
  says which kind of limit it was, so the web app can show the right message.
- **Many people behind one IP** (an office, a school) share the throttler's
  bucket for each route. With the default 100 a minute, `/auth/refresh` and
  `/auth/login` are where they meet it first, since every open tab refreshes.
  Raise `THROTTLE_LIMIT` if that happens; the auth limits still guard against
  password guessing.
- **When Redis is down, both fail open.** The throttler and the auth limits
  then allow everything. That keeps sign-in working during an outage, but it
  also means **no brute-force protection** until Redis is back: the
  `RedisDown` alert is the signal to act. (Session checks fall back to
  Postgres meanwhile; see [sessions-and-tokens.md](./auth/sessions-and-tokens.md).)
- A refused sign-in by the auth limits is counted as
  `auth_events_total{event="login_rate_limited"}`, on the API dashboard's
  "Sign-in and accounts" row ([monitoring.md](./monitoring.md#auth-metrics)).

## Monitoring & Health Checks

`GET /api/v1/health` includes a `rate_limiter` indicator. It performs the same kind of operation the throttler does — an expiring `INCR` on `__throttler_health_check__` — directly against Redis, so an unreachable or read-only Redis shows as `down` instead of silently leaving requests unlimited.

A throttled request is logged by the global exception filter and counted in `http_requests_total{status_code="429"}`.

## Troubleshooting

**Every client gets 429 at the same time.**
All requests share one tracker. Check that `trust proxy` is set in `src/bootstrap/configure-app.ts`, that Nginx forwards `X-Forwarded-For`, and — behind Cloudflare — that the `real_ip_header` block is present. Log `req.ip` from a handler to confirm.

**A client is never limited.**
Check Redis is reachable (`/health` → `rate_limiter`): the throttler fails open. Remember buckets are per endpoint, so spreading requests across endpoints multiplies the allowance.

**Limits differ between instances.**
They shouldn't: counters live only in Redis. Confirm every instance points at the same `REDIS_HOST`/`REDIS_PORT`.

## Related Documentation

- [cache.md](./cache.md) — the 2-layer cache, and what does *not* use it
- [idempotency.md](./idempotency.md) — duplicate-request protection, also on raw Redis
- [race-conditions-and-locks.md](./race-conditions-and-locks.md)
- [auth/rate-limits.md](./auth/rate-limits.md) — every sign-in limit, and how to tune them
