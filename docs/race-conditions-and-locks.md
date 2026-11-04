<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**  *generated with [DocToc](https://github.com/thlorenz/doctoc)*

- [Race Conditions & Locking Strategies](#race-conditions--locking-strategies)
  - [Table of Contents](#table-of-contents)
  - [Current Status in This Starter](#current-status-in-this-starter)
    - [The textbook case here: two tabs refreshing at once](#the-textbook-case-here-two-tabs-refreshing-at-once)
  - [What Is a Race Condition?](#what-is-a-race-condition)
    - [Real-World Example: Bank Withdrawal](#real-world-example-bank-withdrawal)
    - [Where Race Conditions Appear in Web APIs](#where-race-conditions-appear-in-web-apis)
  - [Locking Strategies Overview](#locking-strategies-overview)
  - [1. Pessimistic Locking (Database-Level)](#1-pessimistic-locking-database-level)
    - [Concept](#concept)
    - [How It Works](#how-it-works)
    - [Prisma Implementation (PostgreSQL)](#prisma-implementation-postgresql)
    - [Lock Modes](#lock-modes)
    - [When to Use](#when-to-use)
    - [When NOT to Use](#when-not-to-use)
  - [2. Optimistic Locking (Database-Level)](#2-optimistic-locking-database-level)
    - [Concept](#concept-1)
    - [How It Works](#how-it-works-1)
    - [Prisma Implementation](#prisma-implementation)
    - [When to Use](#when-to-use-1)
    - [When NOT to Use](#when-not-to-use-1)
  - [3. Distributed Locks (Redis-Level)](#3-distributed-locks-redis-level)
    - [Concept](#concept-2)
    - [How It Works (Already Implemented)](#how-it-works-already-implemented)
    - [When to Use](#when-to-use-2)
    - [When NOT to Use](#when-not-to-use-2)
  - [Choosing the Right Strategy](#choosing-the-right-strategy)
  - [Comparison Table](#comparison-table)
  - [Summary](#summary)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

# Race Conditions & Locking Strategies

## Table of Contents

- [Current Status in This Starter](#current-status-in-this-starter)
- [What Is a Race Condition?](#what-is-a-race-condition)
- [Locking Strategies Overview](#locking-strategies-overview)
- [1. Pessimistic Locking (Database-Level)](#1-pessimistic-locking-database-level)
- [2. Optimistic Locking (Database-Level)](#2-optimistic-locking-database-level)
- [3. Distributed Locks (Redis-Level)](#3-distributed-locks-redis-level)
- [Choosing the Right Strategy](#choosing-the-right-strategy)
- [Comparison Table](#comparison-table)
- [Summary](#summary)

## Current Status in This Starter

This page is a reference for when you add your own features, but the starter
already uses most of these techniques. Wherever two requests can arrive at
once and only one may win, the check and the write are one step. Find the
pattern closest to your case and copy it:

| Technique | Where the starter uses it | What it prevents |
|---|---|---|
| **Pessimistic lock** (`SELECT ... FOR UPDATE` in a transaction) | Refresh-token rotation, `rotate()` in [`prisma-session.repository.ts`](../src/modules/auth/infrastructure/persistence/prisma-session.repository.ts) | Two refreshes with the same token both rotating it (see below) |
| Pessimistic lock in one statement (`UPDATE ... FROM (SELECT ... FOR UPDATE) ... RETURNING`) | The avatar swap, `replaceAvatar()` in [`prisma-user.repository.ts`](../src/modules/users/infrastructure/persistence/prisma-user.repository.ts) | Two uploads both "replacing" the same old file, so one new file is never cleaned up |
| **Compare-and-set** (`updateMany` whose `where` holds the condition; `count` says who won) | Emailed codes (`consumedAt: null`), recovery codes (`usedAt: null`), two-step setup and confirm (`confirmedAt: null`), the TOTP replay check (`lastUsedStep < step`), setting a username once (`hasSetUsername: false`), soft delete (`deletedAt: null`) | A code used twice; a two-step code replayed; a confirmed two-step secret replaced; a username set twice; an account deleted twice (and its clean-up run twice) |
| Atomic counter in SQL (`SET attempts = attempts + 1 ... RETURNING`) | Wrong guesses at an emailed code, [`prisma-verification-code.repository.ts`](../src/modules/auth/infrastructure/persistence/prisma-verification-code.repository.ts) | Ten guesses sent at once all being checked against "0 tries so far" |
| **Unique index decides** (`createMany` with `skipDuplicates`) | Linking a Google account, [`prisma-oauth-account.repository.ts`](../src/modules/auth/infrastructure/persistence/prisma-oauth-account.repository.ts) | One Google account linked to two users |
| **Redis `GETDEL`** (read and delete as one command) | Google sign-in state ([`redis-oauth-state.adapter.ts`](../src/modules/auth/infrastructure/adapters/redis-oauth-state.adapter.ts)), two-step sign-in challenges ([`redis-two-factor-challenge.adapter.ts`](../src/modules/auth/infrastructure/adapters/redis-two-factor-challenge.adapter.ts)) | A Google return, or a two-step challenge, completing a sign-in twice |
| **Atomic Redis counter** (`INCR` and the window's expiry in one Lua script) | The auth rate limits, [`rate-limiter.ts`](../src/shared/infrastructure/rate-limit/rate-limiter.ts) | Parallel wrong passwords slipping under a limit |
| **Distributed lock** (`SET ... NX PX`) | The idempotency processing lock ([idempotency.md](./idempotency.md)) | A double-clicked request running twice |

What is **not** used anywhere: optimistic locking with a version column
(section 2). Nothing in the starter needs it yet.

Each of these races has a test that fires the requests at once with
`Promise.all` and checks that exactly one wins: concurrent refreshes, ten
code guesses at once, five right answers at once, two Google links, a TOTP
code raced by two sign-ins, a recovery code raced. They are in
[`test/integration/auth.integration-spec.ts`](../test/integration/auth.integration-spec.ts)
(run with `pnpm test:services:up && pnpm test:integration -- auth`).

### The textbook case here: two tabs refreshing at once

A refresh token (the long-lived secret in the `refresh_token` cookie) is
single-use: each refresh swaps it for a new one. When a user has two tabs
open, both notice the access token expired and both call
`POST /api/v1/auth/refresh` with the same cookie, at the same moment. Without
care, one of three things goes wrong: both rotate (two live tokens), or the
second is refused and that tab signs out, or the second looks like a stolen
token being replayed.

What the starter does, in one transaction with the token's row locked
(`FOR UPDATE`):

```
  Tab A                                    Tab B
  ─────                                    ─────
  SELECT token FOR UPDATE  → unused        SELECT token FOR UPDATE
  create replacement, mark token used        → ⏳ waits for A's lock
  remember the replacement in Redis (10 s)
  COMMIT                                     → sees the token used 5 ms ago,
                                               and its replacement unused
                                             → "grace": answers with A's
                                               replacement, from Redis
```

- **Within the grace window** (10 seconds, `refreshGraceMs` in
  [`auth.module.ts`](../src/modules/auth/auth.module.ts)), and while the
  replacement is still unused, a second use is the same browser twice: it
  gets the same new token.
- **After the window, or once the replacement has been used**, a second use
  is a copy being replayed. That is **reuse detection**: the session is ended
  (`revokedReason: 'reuse-detected'`), the request gets 401, and the event is
  reported ([error-tracking.md](./error-tracking.md#what-is-reported)).

[sessions-and-tokens.md](./auth/sessions-and-tokens.md) explains rotation,
the grace window and reuse detection from the user's side.

---

## What Is a Race Condition?

A race condition occurs when two or more concurrent operations (requests, threads, workers) access and modify the same shared resource at the same time, and the final result depends on the unpredictable timing of which operation finishes first.

### Real-World Example: Bank Withdrawal

A bank account has $100. Two requests to withdraw $100 arrive simultaneously:

```
Timeline:
  0ms  → Request A reads balance: $100       ✅ Looks good
  1ms  → Request B reads balance: $100       ✅ Looks good (hasn't seen A's update yet)
  2ms  → Request A writes balance: $0        ✅ Deducts $100
  3ms  → Request B writes balance: $0        💥 Also deducts $100!
                                              Bank lost $100.
```

Both requests independently decided the withdrawal was valid because they checked the balance *before* the other had a chance to update it. This is the classic "check-then-act" race condition.

### Where Race Conditions Appear in Web APIs

| Scenario | What Goes Wrong |
|----------|----------------|
| Double form submission | User created twice, duplicate email sent |
| Concurrent inventory purchase | Two users buy the last item |
| Parallel balance updates | Money appears or disappears |
| Simultaneous config changes | One admin's changes silently overwritten |
| Concurrent file uploads | Files overwrite each other |

---

## Locking Strategies Overview

There are three main approaches to preventing race conditions, each suited to different scenarios:

| Strategy | Where the Lock Lives | Speed | Complexity | Best For |
|----------|---------------------|-------|------------|----------|
| **Pessimistic Locking** | Database (row-level) | Slower | Low | Financial data, inventory |
| **Optimistic Locking** | Database (version column) | Faster | Medium | User profiles, configs |
| **Distributed Lock** | Redis / External cache | Fastest | High | Cross-service, idempotency |

---

## 1. Pessimistic Locking (Database-Level)

### Concept

"Lock first, ask questions later." Before reading or modifying a row, you tell the database: **"Nobody else is allowed to touch this row until I'm done."** Other requests that try to access the same row are physically paused by the database until the lock is released.

### How It Works

```
  Request A                              Request B
  ─────────                              ─────────
  BEGIN TRANSACTION
  SELECT * FROM accounts
    WHERE id = 1 FOR UPDATE              BEGIN TRANSACTION
    → Balance: $100                      SELECT * FROM accounts
                                           WHERE id = 1 FOR UPDATE
  UPDATE accounts                          → ⏳ BLOCKED (waiting for A)
    SET balance = 0
    WHERE id = 1

  COMMIT
    → Lock released                        → Unblocked! Reads balance: $0
                                           → Withdrawal denied ✅
                                         COMMIT
```

### Prisma Implementation (PostgreSQL)

Prisma doesn't have a native `lock: { mode: 'pessimistic_write' }` flag on `.findFirst()`, so it is standard practice to drop into a Raw Query inside an interactive transaction to acquire the rock-solid database lock.

```typescript
// In your Command Handler or Service
async withdraw(accountId: string, amount: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
        // FOR UPDATE physically locks the row in PostgreSQL until transaction commits
        const accounts = await tx.$queryRaw<Account[]>\`
            SELECT id, balance FROM "Account"
            WHERE id = \${accountId}
            FOR UPDATE
        \`

        const account = accounts[0]
        if (!account) throw new NotFoundException('Account not found')
        if (account.balance < amount) throw new BadRequestException('Insufficient funds')

        // Now safe to update because no one else could read or modify during our lock
        await tx.account.update({
            where: { id: accountId },
            data: { balance: { decrement: amount } }
        })
    })
    // Transaction commits here → lock is automatically released by PostgreSQL
}
```

### Lock Modes

| Mode | SQL | Use Case |
|------|-----|----------|
| `pessimistic_read` | `SELECT ... FOR SHARE` | "I'm reading this, don't let anyone write to it" |
| `pessimistic_write` | `SELECT ... FOR UPDATE` | "I'm about to write this, don't let anyone read or write to it" |
| `pessimistic_write` + `NOWAIT` | `SELECT ... FOR UPDATE NOWAIT` | Same as above, but fail immediately instead of waiting |

### When to Use

✅ Financial transactions (balance updates, payments)
✅ Inventory management (stock counts)
✅ Any scenario where stale reads lead to data corruption

### When NOT to Use

❌ High-traffic read-heavy endpoints (locks cause queuing and slow down reads)
❌ Long-running operations (holding a lock for seconds blocks everyone else)
❌ Cross-database or cross-service operations (database locks only work within one database)

---

## 2. Optimistic Locking (Database-Level)

### Concept

"Don't lock anything. Just check if someone else changed it before you save." Instead of physically blocking other requests, you track a `version` number on each row. When you try to save, you verify the version hasn't changed since you read it.

### How It Works

```
  Request A                              Request B
  ─────────                              ─────────
  SELECT * FROM users WHERE id = 1       SELECT * FROM users WHERE id = 1
    → { name: "Alice", version: 1 }       → { name: "Alice", version: 1 }

  UPDATE users                           UPDATE users
    SET name = "Bob", version = 2          SET name = "Charlie", version = 2
    WHERE id = 1 AND version = 1           WHERE id = 1 AND version = 1
    → 1 row affected ✅                    → 0 rows affected 💥
                                           → Throw OptimisticLockVersionMismatchError
```

Request B's update silently fails because the `WHERE version = 1` clause no longer matches (Request A already changed it to version 2).

### Prisma Implementation

```prisma
// schema.prisma — add a version field
model User {
  id      String @id @default(uuid())
  name    String
  email   String
  version Int    @default(0) // You must manually increment this
}
```

```typescript
// In your Command Handler or Service
async updateProfile(userId: string, dto: UpdateProfileDto): Promise<User> {
    // 1. Read current version
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException('User not found')

    try {
        // 2. Update with Optimistic Lock constraint
        return await this.prisma.user.update({
            where: {
                id: userId,
                // CRUCIAL: Must match the version we read!
                version: user.version
            },
            data: {
                name: dto.name,
                email: dto.email,
                // CRUCIAL: Always increment the version on update
                version: { increment: 1 }
            }
        })
    } catch (error) {
        // Prisma throws P2025 (Record to update not found) if the version didn't match
        if (error.code === 'P2025') {
            throw new ConflictException(
                'This record was modified by another request. Please reload and try again.'
            )
        }
        throw error
    }
}
```

### When to Use

✅ User profile updates (low conflict probability)
✅ Configuration or settings changes
✅ Content editing (blog posts, comments)
✅ Any scenario where conflicts are rare but must be detected

### When NOT to Use

❌ High-contention resources (e.g., a single counter that hundreds of users all increment simultaneously — most updates would fail and need retrying)
❌ Operations that cannot be easily retried by the user

---

## 3. Distributed Locks (Redis-Level)

### Concept

"Use a fast, central traffic cop (Redis) to coordinate access before anything reaches the database." This is the approach used in our **Idempotency Processing Lock**. A request writes a temporary marker to Redis before executing, and concurrent requests that see this marker know to back off.

### How It Works (Already Implemented)

See [idempotency.md](./idempotency.md) for the full implementation. The short version:

```
  Request A                                   Request B
  ─────────                                   ─────────
  SET idempotency:<hash> PROCESSING NX PX     SET idempotency:<hash> PROCESSING NX PX
    → OK (lock acquired)                        → nil (key already exists)
  Execute handler...                          Return 409 Conflict ✅
  SET idempotency:<hash> COMPLETED + body
```

The acquire is a **single** `SET … NX PX` command. A separate `GET` followed by `SET` would leave a gap in which both requests read "no lock" and both proceed — the exact duplicate the lock exists to prevent.

### Using Redis Locks Elsewhere

The same primitive is available to any code through the shared `REDIS_CLIENT` (node-redis):

```typescript
import { Inject, Injectable } from '@nestjs/common'
import { RedisClientType } from 'redis'
import { REDIS_CLIENT } from '@/shared/infrastructure/cache'

@Injectable()
export class WithdrawalLock {
    constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {}

    async acquire(key: string, ttlMs: number): Promise<boolean> {
        // NX = only set if the key does NOT exist (atomic)
        // PX = expire after ttlMs, so a crashed holder cannot keep it forever
        const result = await this.redis.set(`lock:${key}`, 'locked', { NX: true, PX: ttlMs })
        return result === 'OK'
    }

    async release(key: string): Promise<void> {
        await this.redis.del(`lock:${key}`)
    }
}

// Usage
const locked = await withdrawalLock.acquire('user:123:withdraw', 10_000)
if (!locked) {
    throw new ConflictException('Operation already in progress')
}
try {
    await performWithdrawal()
} finally {
    await withdrawalLock.release('user:123:withdraw')
}
```

### When to Use

✅ Idempotency (already implemented)
✅ Cross-service coordination (microservices that share a Redis instance)
✅ Rate limiting and throttling
✅ Preventing duplicate background jobs

### When NOT to Use

❌ Protecting database integrity (use database-level locks for that — Redis can go down independently)
❌ Long-running locks (Redis TTL expiration could release the lock too early mid-operation)

---

## Choosing the Right Strategy

Use this decision tree to pick the right approach:

```
Is the race condition between HTTP requests
hitting the same endpoint simultaneously?
  │
  ├─ YES → Is it a duplicate of the SAME user action?
  │         ├─ YES → Use Idempotency Lock (already implemented) ✅
  │         └─ NO  → Is it across multiple services?
  │                   ├─ YES → Use Distributed Redis Lock
  │                   └─ NO  → See database-level options below
  │
  └─ NO → Is it a database row-level conflict?
           │
           ├─ High contention (many writes to same row)?
           │   └─ Use Pessimistic Locking (FOR UPDATE)
           │
           └─ Low contention (rare conflicts)?
               └─ Use Optimistic Locking (@VersionColumn)
```

---

## Comparison Table

| Aspect | Pessimistic | Optimistic | Distributed (Redis) |
|--------|------------|------------|---------------------|
| **Blocks others** | Yes (database queue) | No (fails on conflict) | Yes (409 Conflict) |
| **Performance impact** | Higher (row locked) | Lower (no lock held) | Lowest (in-memory) |
| **Conflict detection** | Prevented entirely | Detected at save time | Detected at entry |
| **Retry needed** | No (waits for turn) | Yes (client retries) | Yes (client retries) |
| **Scope** | Single database | Single database | Cross-service |
| **Data safety** | Strongest | Good (if retried) | Weakest (Redis can fail) |
| **Used in the starter?** | ✅ Refresh rotation, avatar swap | ❌ Not yet (compare-and-set `updateMany` is used instead) | ✅ Idempotency lock; atomic counters and `GETDEL` for auth |

---

## Summary

1. **Race conditions** occur when concurrent requests read and modify the same data without coordination.
2. **Pessimistic locking** physically blocks other requests at the database level — strongest but slowest.
3. **Optimistic locking** detects conflicts at save time via a version column — fast but requires client retries.
4. **Distributed locks** (Redis) coordinate access before touching the database — fastest but least durable.
5. **This starter already uses** row locks (refresh rotation, avatar swap), compare-and-set updates (codes, two-step, username, soft delete), atomic Redis operations (rate limits, `GETDEL` for one-time state) and the idempotency lock. See [the table above](#current-status-in-this-starter) for the file to copy. Add locking feature by feature as your application grows.
