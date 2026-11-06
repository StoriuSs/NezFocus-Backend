<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**  *generated with [DocToc](https://github.com/thlorenz/doctoc)*

- [Cache Module Documentation](#cache-module-documentation)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
    - [Why 2-Layer Cache?](#why-2-layer-cache)
  - [Architecture: 2-Layer Cache](#architecture-2-layer-cache)
    - [Cache Lookup Flow](#cache-lookup-flow)
  - [Technology Stack](#technology-stack)
    - [Layer 1 (L1): In-Memory](#layer-1-l1-in-memory)
    - [Layer 2 (L2): Distributed](#layer-2-l2-distributed)
  - [Configuration](#configuration)
    - [Environment Variables](#environment-variables)
    - [CacheModule Setup](#cachemodule-setup)
  - [How It Works](#how-it-works)
    - [L1: In-Memory LRU Cache](#l1-in-memory-lru-cache)
    - [L2: Redis Cache](#l2-redis-cache)
  - [Cache Keys & Values](#cache-keys--values)
    - [Naming Convention](#naming-convention)
    - [1. Idempotency Keys](#1-idempotency-keys)
    - [2. Rate Limiter (Throttler) Keys](#2-rate-limiter-throttler-keys)
    - [3. Health Check Test](#3-health-check-test)
    - [4. Auth Keys](#4-auth-keys)
    - [5. Sign-in Rate Limit Keys](#5-sign-in-rate-limit-keys)
    - [6. BullMQ Keys](#6-bullmq-keys)
  - [Key Naming Conventions](#key-naming-conventions)
    - [Current Patterns](#current-patterns)
    - [Best Practices](#best-practices)
  - [TTL (Time To Live) Summary](#ttl-time-to-live-summary)
  - [Basic Operations](#basic-operations)
    - [Inject Cache](#inject-cache)
    - [Set, Get, Delete](#set-get-delete)
  - [Performance Benefits](#performance-benefits)
    - [Latency Comparison](#latency-comparison)
    - [Real-World Impact](#real-world-impact)
  - [Distributed Rate Limiting](#distributed-rate-limiting)
    - [Implementation](#implementation)
    - [Why Distributed Rate Limiting?](#why-distributed-rate-limiting)
  - [Error Handling](#error-handling)
  - [Monitoring](#monitoring)
    - [Prometheus Metrics](#prometheus-metrics)
    - [Health Checks](#health-checks)
    - [Redis CLI Commands](#redis-cli-commands)
    - [Memory Usage](#memory-usage)
  - [Common Pitfalls](#common-pitfalls)
    - [❌ Forgetting TTL](#-forgetting-ttl)
    - [✅ Always set TTL](#-always-set-ttl)
    - [❌ Using wrong delete method](#-using-wrong-delete-method)
    - [✅ Use .del() for NestJS Cache](#-use-del-for-nestjs-cache)
    - [❌ Not invalidating on updates](#-not-invalidating-on-updates)
    - [✅ Clear cache on update](#-clear-cache-on-update)
    - [❌ Assuming L1 is shared](#-assuming-l1-is-shared)
    - [✅ Use `REDIS_CLIENT` for data that must change everywhere at once](#-use-redis_client-for-data-that-must-change-everywhere-at-once)
  - [Tuning Guide](#tuning-guide)
    - [LRU Size Configuration](#lru-size-configuration)
    - [Adjusting TTL](#adjusting-ttl)
  - [Related Documentation](#related-documentation)
  - [External Resources](#external-resources)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

# Cache Module Documentation

## Table of Contents

- [Overview](#overview)
- [Architecture: 2-Layer Cache](#architecture-2-layer-cache)
- [Technology Stack](#technology-stack)
- [Configuration](#configuration)
- [How It Works](#how-it-works)
- [Cache Keys & Values](#cache-keys--values)
- [Key Naming Conventions](#key-naming-conventions)
- [TTL Summary](#ttl-time-to-live-summary)
- [Basic Operations](#basic-operations)
- [Performance Benefits](#performance-benefits)
- [Distributed Rate Limiting](#distributed-rate-limiting)
- [Error Handling](#error-handling)
- [Monitoring](#monitoring)
- [Common Pitfalls](#common-pitfalls)
- [Related Documentation](#related-documentation)

---

## Overview

The Cache module provides a **2-layer caching system** combining in-memory and Redis storage for optimal performance. This is a **global module** available throughout the application for caching data where a short per-instance staleness is acceptable — computed results, reference data, expensive reads.

> **What does *not* use it — and why.** The L1 layer is private to each app instance. A delete or overwrite on one instance clears that instance's L1 and Redis, but every other instance that holds the key in its own L1 keeps returning the old value until the L1 entry expires. So anything that must be correct everywhere at once is written with the shared `REDIS_CLIENT` (node-redis) instead:
>
> - **The session check** (`auth:session:*`, `auth:user:*`) — a signed-out session or a deleted account must stop working on every instance at the next request.
> - **The auth module's short-lived state** — refresh-token replacements, Google sign-ins in progress.
> - **Idempotency locks** — need an atomic `SET NX`; two instances must never both hold the lock.
> - **Rate-limit counters** (the global throttler and the sign-in limits) — need an atomic `INCR`; per-instance copies would multiply the limit.
> - **Health checks** — an L1 hit would answer before Redis is ever consulted.
>
> Today no feature in the starter uses the two-layer cache itself: it is there for yours.
>
> Rule of thumb: if serving a stale value for the L1 TTL would be a bug (access control, locks, counters, anything invalidated to enforce a change), use `REDIS_CLIENT`.

### Why 2-Layer Cache?

- ⚡ **4-10x faster** response times (sub-millisecond L1 hits)
- 🔽 **70-90% fewer** Redis network calls
- 🌍 **Distributed** across instances via Redis (L2)
- 💪 **Resilient** to Redis downtime (L1 continues working)

---

## Architecture: 2-Layer Cache

```
┌─────────────────────────────────────┐
│         Application Request          │
└──────────────┬──────────────────────┘
               │
               ▼
    ┌──────────────────────┐
    │   CACHE_MANAGER      │
    │   (NestJS)           │
    └──────────┬───────────┘
               │
      ┌────────┴────────┐
      │                  │
      ▼                  ▼
┌──────────────┐  ┌──────────────┐
│ L1: Memory   │  │ L2: Redis    │
│ CacheableMemory│ │ KeyvRedis    │
├──────────────┤  ├──────────────┤
│ • <1ms hits  │  │ • 2-5ms hits │
│ • LRU (500)  │  │ • Distributed│
│ • Per-instance│ │ • Persistent │
└──────────────┘  └──────────────┘
```

### Cache Lookup Flow

1. **Check L1 (in-memory)** → Found? Return immediately (<1ms) ✅
2. **Check L2 (Redis)** → Found? Return + promote to L1 (2-5ms) ✅
3. **Database query** → Store in both layers → Return (50-200ms)

---

## Technology Stack

### Layer 1 (L1): In-Memory
- **cacheable**: LRU cache implementation
- **CacheableMemory**: Fast in-memory storage
- **Scope**: Per-instance (each server has its own L1)

### Layer 2 (L2): Distributed
- **@nestjs/cache-manager**: NestJS cache abstraction
- **Keyv**: Key-value storage interface
- **@keyv/redis**: Redis adapter
- **Redis 7**: Distributed in-memory store

---

## Configuration

### Environment Variables

```env
# L1 + L2 Configuration
CACHE_TTL=3600         # Default TTL in seconds (both layers)
CACHE_LRU_SIZE=500     # Max items in L1 (in-memory) cache

# Redis Connection (L2)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
```

The session check's cache has no setting: its entries last at most 5 minutes
(`ENTRY_TTL_MS` in `src/modules/auth/infrastructure/adapters/redis-session-cache.adapter.ts`),
and are invalidated at once when they change.

### CacheModule Setup

**File:** `src/shared/infrastructure/cache/cache.module.ts`

```typescript
@Module({
    imports: [
        NestCacheModule.registerAsync({
            useFactory: (configService: ConfigService) => ({
                stores: [
                    // L1: In-memory LRU cache
                    new Keyv({
                        store: new CacheableMemory({
                            ttl: configService.get('cache.ttl') * 1000,
                            lruSize: configService.get('cache.lruSize')
                        })
                    }),
                    // L2: Redis cache
                    new KeyvRedis(redisUrl)
                ]
            })
        })
    ]
})
```

---

## How It Works

### L1: In-Memory LRU Cache

**LRU (Least Recently Used) Eviction:**
- Stores **most recent 500 items** (configurable)
- When full, evicts oldest unused item
- **Sub-millisecond** access time
- **Per-instance** (not shared)

**Example:**
```
L1 Cache (500 items, full): [item1, item2, ..., item500]

New request for item501:
→ Evicts item1 (least recently used)
→ L1: [item2, ..., item500, item501]

Request for item1:
→ Miss L1 → Hit L2 (Redis) → Promote to L1
→ L1: [item3, ..., item501, item1]  // item2 evicted
```

### L2: Redis Cache

- **Distributed** across all instances
- **Persistent** survives app restarts
- **Shared** cache for multi-instance deployments
- **Slower** than L1 (network latency: 2-5ms)

---

## Cache Keys & Values

### Naming Convention

```
{category}:{subcategory}:{identifier}:{variant}
```

### 1. Idempotency Keys

**Purpose**: Store API responses to prevent duplicate request execution

**Key Pattern**: `idempotency:{sha256(userId \0 method \0 routePath \0 idempotencyKey)}` — scoped to the caller and route, so one user cannot replay another's response by reusing a key

**Value Structure** (JSON string):
```typescript
{
    status: 'PROCESSING' | 'COMPLETED'
    statusCode: number  // HTTP status (200, 201, etc.)
    body: any           // Response payload (null while PROCESSING)
    timestamp: number   // Unix timestamp when written
}
```

**TTL**: From the `@Idempotent(ttl)` decorator (default `24h`)

**Storage**: Raw `REDIS_CLIENT` — the lock is taken with an atomic `SET … NX PX`. Not the 2-layer cache.

**Used In**: `IdempotencyService` for `@Idempotent` decorated endpoints. See [idempotency.md](./idempotency.md).

---

### 2. Rate Limiter (Throttler) Keys

**Purpose**: Track request counts for distributed rate limiting

**Key Patterns**:
- `throttle:{throttlerName}:{hash}` - Request counter
- `throttle:block:{throttlerName}:{hash}` - Block marker (only when a throttler sets `blockDuration`)

**Where:**
- `{throttlerName}` = `relaxed` (the single throttler registered in `app.module.ts`)
- `{hash}` = SHA-256 of `<Controller>-<handler>-<throttlerName>-<client IP>`, built by `@nestjs/throttler` — one bucket per endpoint per IP

**Value**: request count in the current window (block key: `1`)

**TTL**: The window length (`THROTTLE_TTL`), set when the counter is created and never refreshed — a fixed window

**Storage**: Raw `REDIS_CLIENT`, incremented atomically by a Lua script (`INCR` + `PEXPIRE` on first hit). Not the 2-layer cache.

**Tracking**: Client IP only. The throttler guard runs before authentication, so the user is not known yet. See [rate-limit.md](./rate-limit.md).

**Used In**: `KeyvThrottlerStorage`

---

### 3. Health Check Test

**Purpose**: Verify Redis connectivity

- **Redis indicator** — sends `PING` on `REDIS_CLIENT`; writes no key
- **Rate limiter indicator** — `INCR` + 1-second `PEXPIRE` on `__throttler_health_check__`, the same kind of write the throttler performs

**Used In**: `/health` (`HealthController`, `ThrottlerHealthIndicator`)

---

### 4. Auth Keys

**Purpose**: the session check behind every authenticated request, and the
auth module's short-lived state. Names in `src/modules/auth/infrastructure/adapters/cache-keys.ts`.

| Key | Holds | TTL |
|-----|-------|-----|
| `auth:session:<session id>` | The session's user id and expiry | At most 5 min (less if the session ends sooner) |
| `auth:user:<user id>` | The user the guard attaches to the request (roles, deleted or not) | At most 5 min |
| `auth:session:*:v`, `auth:user:*:v` | Version counters, bumped on every invalidation | 24 h |
| `auth:replaced:<token hash>` | The new refresh token that replaced an old one, for the grace window (two tabs refreshing at once) | 10 s |
| `auth:oauth:<state>` | A Google sign-in in progress: PKCE verifier, nonce, return path | 10 min, read once |

**Storage**: Raw `REDIS_CLIENT`. The session and user entries are **versioned**
(`src/shared/infrastructure/cache/versioned-cache.ts`): invalidation bumps the
counter, and a reader that missed the cache writes its result back only if the
counter has not moved. Otherwise a request that read the database just before
a sign-out could write the live session back for five minutes.

**Redis down**: the session check reads Postgres instead (logged once a
minute). Google sign-in needs its keys and fails until Redis is back. See
[auth/sessions-and-tokens.md](./auth/sessions-and-tokens.md).

---

### 5. Sign-in Rate Limit Keys

**Key Pattern**: `rl:<rule name>:<sha256 of the lower-cased subject>`, e.g.
`rl:login-fail-email:9f86d0…`. The subject is an address, an IP or a user id,
hashed so no email address sits in Redis in clear.

**Value**: hits in the current window. **TTL**: the rule's window (1 minute to
1 hour), fixed from the first hit.

**Storage**: Raw `REDIS_CLIENT`, through `RateLimiter`
(`src/shared/infrastructure/rate-limit/rate-limiter.ts`): one Lua script does
`INCR` and starts the window. Fails open when Redis is down. The rules:
[auth/rate-limits.md](./auth/rate-limits.md).

---

### 6. BullMQ Keys

`bull:<queue>:*` (`auth`, `file-cleanup`, `maintenance`): jobs, their state,
and the job schedulers. Managed by BullMQ; inspect them on `/admin/queues`
rather than in Redis. Waiting and failed `send-code` jobs hold the code they
send ([BULLMQ-GUIDE.md](./BULLMQ-GUIDE.md)). Production Redis runs with
`noeviction`, so these are never silently dropped.

---

## Key Naming Conventions

### Current Patterns

| Pattern | Example | Purpose |
|---------|---------|---------|
| `idempotency:{sha256}` | `idempotency:9f86d0…` | Idempotency lock / cached response (raw Redis) |
| `throttle:{name}:{sha256}` | `throttle:relaxed:3a7bd3…` | Rate limit counter (raw Redis) |
| `throttle:block:{name}:{sha256}` | `throttle:block:relaxed:3a7bd3…` | Rate limit block (raw Redis) |
| `rl:{rule}:{sha256}` | `rl:code-email-hour:5d41…` | Sign-in rate limit counter (raw Redis) |
| `auth:session:{id}`, `auth:user:{id}` (+ `:v`) | `auth:user:3f9c…` | Session check cache, versioned (raw Redis) |
| `auth:replaced:{hash}`, `auth:oauth:{state}` | `auth:oauth:b1c2…` | Auth module state (raw Redis) |
| `bull:{queue}:…` | `bull:auth:42` | BullMQ (managed by BullMQ) |

### Best Practices

✅ **Good**:
- Use colons (`:`) as separators
- Start with category/namespace
- Be descriptive but concise
- Use lowercase
- Consistent order (general → specific)

❌ **Avoid**:
- Mixed separators: `user-123:data`
- Too generic: `data:abc123`
- Inconsistent casing: `User:123` vs `user:456`

---

## TTL (Time To Live) Summary

| Use Case | TTL | Layer(s) | Rationale |
|----------|-----|----------|-----------|
| **Idempotency** | `@Idempotent` TTL (default 24h) | Redis only | Long retry window |
| **Session check** (`auth:session:*`, `auth:user:*`) | At most 5 minutes, fixed in code | Redis only | Reduce DB load; invalidated on every instance at once, and the TTL bounds the damage if an invalidation is ever lost |
| **Rate Limiter** | `THROTTLE_TTL` | Redis only | Match throttler window |
| **Sign-in limits** (`rl:*`) | The rule's window | Redis only | See [auth/rate-limits.md](./auth/rate-limits.md) |
| **Health Check** | 1 second | Redis only | Quick validation |

**Note**: Both L1 and L2 use the same TTL by default

---

## Basic Operations

### Inject Cache

```typescript
import { Injectable, Inject } from '@nestjs/common'
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager'

@Injectable()
export class MyService {
    constructor(@Inject(CACHE_MANAGER) private cache: Cache) {}
}
```

### Set, Get, Delete

```typescript
// Set with TTL (ms)
await this.cache.set('user:123', userData, 3600000)  // 1 hour

// Get (checks L1 → L2 → returns undefined)
const data = await this.cache.get('user:123')

// Get with type
const data = await this.cache.get<UserData>('user:123')

// Delete (from both L1 and L2)
await this.cache.del('user:123')

// Note: Use .del() not .delete() for NestJS Cache
```

---

## Performance Benefits

### Latency Comparison

| Cache Type | Latency | Hit Rate | Efficiency |
|------------|---------|----------|------------|
| **L1 (Memory)** | 0.1-0.5ms | ~90% | ⚡⚡⚡⚡⚡ |
| **L2 (Redis)** | 2-5ms | ~8% | ⚡⚡⚡ |
| **Database** | 50-200ms | ~2% | ⚡ |

### Real-World Impact

**Scenario**: 1000 req/sec, 90% cache hit rate

| Metric | Before (Redis Only) | After (2-Layer) | Improvement |
|--------|-------------------|-----------------|-------------|
| Avg latency | 2.5ms | 0.6ms | 🚀 **76% faster** |
| Redis calls/sec | 900 | 90 | 📉 **90% reduction** |
| Memory usage | Low | +50MB | Acceptable trade-off |

---

## Distributed Rate Limiting

### Implementation

Rate limiting does **not** use the 2-layer cache. Counters must be shared by every instance and incremented atomically, so `KeyvThrottlerStorage` writes to Redis directly.

**1. The Adapter (`KeyvThrottlerStorage`)**:
Implements NestJS's `ThrottlerStorage` interface on top of the shared `REDIS_CLIENT`.

```typescript
// src/shared/infrastructure/throttler/keyv-throttler.storage.ts
@Injectable()
export class KeyvThrottlerStorage implements ThrottlerStorage {
    constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {}

    async increment(key, ttl, limit, blockDuration, throttlerName) {
        // 1. If a block key exists, report blocked
        // 2. Lua: INCR the counter; PEXPIRE only when it was just created
        // 3. Over the limit with blockDuration > 0 → write the block key
        // 4. Redis unreachable → log and allow (fail open)
    }
}
```

**2. Implicit Usage**:
You don't need to call `increment` or `reset` manually. The `ThrottlerGuard` (registered globally) handles this automatically for every request.

**Configuration in `app.module.ts`**:
```typescript
ThrottlerModule.forRootAsync({
    inject: [ConfigService, REDIS_CLIENT],
    useFactory: (configService, redis) => ({
        throttlers: [{
            name: 'relaxed',
            ttl: configService.get('throttle.ttl') * 1000,
            limit: configService.get('throttle.limit')
        }],
        storage: new KeyvThrottlerStorage(redis),  // ← Registered here

        // Runs before authentication, so the client IP is the only identity
        // available. req.ip is the real client because main.ts trusts one proxy hop.
        getTracker: (req) => Promise.resolve(req.ip || req.socket?.remoteAddress || 'unknown')
    })
})
```

### Why Distributed Rate Limiting?

**Problem without shared storage:**
- 3 servers × 10 req/min limit = **30 req/min total** (not 10!)

**Solution:** counters live in Redis only, incremented atomically. Every instance reads and writes the same counter, so the limit is **10 req/min** in total however many servers run. (An L1 layer here would bring the per-server problem back.)

---

## Error Handling

Always handle cache gracefully - failures shouldn't break your app:

```typescript
// ✅ Good: Graceful degradation
try {
    const cached = await this.cache.get(key)
    if (cached) return cached
} catch (error) {
    this.logger.error(`Cache error: ${error.message}`)
    // Continue to database fallback
}
return await this.fetchFromDatabase(id)

//  ❌ Bad: Unhandled failure
const data = await this.cache.get(key)  // Throws if Redis down
return data || await this.fetchFromDatabase(id)
```

**Benefits of 2-layer cache**:
- If Redis (L2) fails, L1 continues serving cached data
- Graceful degradation: L1 → Database (skip L2)

---

## Monitoring

### Prometheus Metrics

Cache metrics are available in the Grafana dashboard and require manual instrumentation.

**Available Metrics:**

| Metric | Type | Description |
|--------|------|-------------|
| `cache_hits_total` | Counter | Cache hits, by `cache` (`auth_session` and `auth_user`, from the session check, are recorded already) |
| `cache_misses_total` | Counter | Cache misses, by `cache` |

**Adding Cache Metrics to Your Service:**

```typescript
import { MetricsService } from '@/shared/infrastructure/monitoring/metrics.service'
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager'

@Injectable()
export class YourService {
    constructor(
        @Inject(CACHE_MANAGER) private cache: Cache,
        private metricsService: MetricsService
    ) {}

    async getData(key: string) {
        const cached = await this.cache.get(key)

        if (cached) {
            this.metricsService.recordCacheHit('your_cache')  // ← Track hit
            return cached
        }

        this.metricsService.recordCacheMiss('your_cache')  // ← Track miss

        const data = await this.fetchFromDb()
        await this.cache.set(key, data, 300000)
        return data
    }
}
```

**Grafana Dashboard Panels** (NestJS API Metrics → "Database (as the app sees it)" row):
- **Cache hit rate** — Percentage of hits (green > 80%)
- **Cache reads / s** — Cache reads per second
- **Cache hits and misses** — Stacked bar chart

### Health Checks

**Endpoint**: `GET /api/v1/health`

Verifies both layers:
```json
{
  "status": "ok",
  "details": {
    "redis": { "status": "up" },       // PING on the Redis client
    "rate_limiter": { "status": "up" }  // expiring INCR, like the throttler
  }
}
```

### Redis CLI Commands

```bash
# Connect (production: redis-hexagonal-auth-prod). The container has REDISCLI_AUTH set,
# so redis-cli needs no password argument.
docker exec -it redis-nezfocus-web redis-cli

# List all keys
KEYS *

# Idempotency and throttle keys are hashes — find them by pattern
SCAN 0 MATCH idempotency:* COUNT 100
SCAN 0 MATCH throttle:* COUNT 100
SCAN 0 MATCH rl:* COUNT 100
SCAN 0 MATCH auth:* COUNT 100

# Check TTL (seconds remaining)
TTL idempotency:<hash>

# Delete key
DEL throttle:relaxed:<hash>
```

### Memory Usage

**L1 (In-Memory)**:
```bash
# Monitor Node.js heap
process.memoryUsage().heapUsed

# Estimate: ~100 bytes per item
# 500 items ≈ 50KB overhead
```

**L2 (Redis)**:
```bash
# Redis memory info
redis-cli INFO memory
```

---

## Common Pitfalls

### ❌ Forgetting TTL

```typescript
await this.cache.set('data', value)  // Never expires in L2!
```

### ✅ Always set TTL

```typescript
await this.cache.set('data', value, 3600000)  // 1 hour
```

---

### ❌ Using wrong delete method

```typescript
await this.cache.delete(key)  // ❌ Wrong! (Keyv method)
```

### ✅ Use .del() for NestJS Cache

```typescript
await this.cache.del(key)  // ✅ Correct (NestJS Cache method)
```

---

### ❌ Not invalidating on updates

```typescript
async updateUser(id: string, data: any) {
    return this.userRepo.update(id, data)
    // ❌ Cache still has old data in both L1 and L2!
}
```

### ✅ Clear cache on update

```typescript
async updateProduct(id: string, data: any) {
    const updated = await this.productRepo.update(id, data)
    await this.cache.del(`product:${id}`)  // ✅ clears this instance's L1 and Redis
    return updated
}
```

Other instances may still serve their own L1 copy until it expires. If that is not acceptable for the data, don't put it in the 2-layer cache — see [Overview](#overview).

---

### ❌ Assuming L1 is shared

Reads are fine across instances; **invalidation is not**:

```typescript
// Server 2 caches a value itself (its L1 + Redis)
await this.cache.set('user:42:permissions', ['admin'])

// Server 1 revokes it (Server 1's L1 + Redis)
await this.cache.del('user:42:permissions')

// Server 2, on the next request
await this.cache.get('user:42:permissions')
// ❌ ['admin'] — served from Server 2's own L1 until that entry expires
```

(Verified against this module with two instances on one Redis. A value that only exists in Redis is read correctly from any instance — the problem is a copy an instance already holds in its own L1.)

### ✅ Use `REDIS_CLIENT` for data that must change everywhere at once

Access-control data, locks, counters, and anything you invalidate to *enforce* a change belong in Redis only:

```typescript
constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {}

await this.redis.set('user:42:permissions', JSON.stringify(['admin']), { PX: 60_000 })
await this.redis.del('user:42:permissions') // gone for every instance
```

The worked example in this starter is the session check:
`src/modules/auth/infrastructure/adapters/redis-session-cache.adapter.ts`, on top of
`src/shared/infrastructure/cache/versioned-cache.ts`, which keeps a slow reader
from writing a stale entry back after an invalidation.

---

## Tuning Guide

### LRU Size Configuration

| App Type | Recommended `CACHE_LRU_SIZE` | Reasoning |
|----------|------------------------------|-----------|
| Small (< 100 users) | 100-200 | Minimal memory |
| Medium (100-1000 users) | **500** (default) | Balanced |
| Large (> 1000 users) | 2000-5000 | Max L1 hits |

**Memory impact**: ~100 bytes per item
- 500 items ≈ 50KB
- 5000 items ≈ 500KB

### Adjusting TTL

```env
CACHE_TTL=3600   # Default: 1 hour
```

**Recommendations by use case**:
- Per-user derived data: 1 hour (3600)
- Static data: 24 hours (86400)
- Real-time data: 5 minutes (300)

---

## Related Documentation

- [Monitoring Guide](./monitoring.md) — Prometheus metrics and Grafana dashboards
- [Idempotency Pattern](./idempotency.md)
- [Authentication](./auth/README.md) and [sessions and tokens](./auth/sessions-and-tokens.md)
- [Rate Limiting](./rate-limit.md)
- [Health Checks](./core-infrastructure.md#health-checks)

## External Resources

- [NestJS Cache Manager](https://docs.nestjs.com/techniques/caching)
- [Cacheable Documentation](https://github.com/jaredwray/cacheable)
- [Keyv Documentation](https://github.com/jaredwray/keyv)
- [Redis Best Practices](https://redis.io/docs/manual/patterns/)
