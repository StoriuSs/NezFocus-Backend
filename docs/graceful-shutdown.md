<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**  *generated with [DocToc](https://github.com/thlorenz/doctoc)*

- [Graceful Shutdown](#graceful-shutdown)
  - [Table of Contents](#table-of-contents)
  - [What is Graceful Shutdown?](#what-is-graceful-shutdown)
    - [Real-World Analogy](#real-world-analogy)
  - [Why Do We Need It?](#why-do-we-need-it)
    - [1. Zero-Downtime Deployments](#1-zero-downtime-deployments)
    - [2. Data Integrity](#2-data-integrity)
    - [3. Connection Pool Health](#3-connection-pool-health)
  - [Key Concepts](#key-concepts)
    - [Signals](#signals)
      - [SIGTERM (Signal Terminate)](#sigterm-signal-terminate)
      - [SIGINT (Signal Interrupt)](#sigint-signal-interrupt)
      - [SIGKILL (Signal Kill)](#sigkill-signal-kill)
    - [Lifecycle Hooks](#lifecycle-hooks)
    - [In-Flight Requests](#in-flight-requests)
  - [How It Works](#how-it-works)
    - [The Shutdown Sequence](#the-shutdown-sequence)
    - [Timeout Protection](#timeout-protection)
  - [Implementation Details](#implementation-details)
    - [1. `main.ts` - turn the hooks on, and get out of the way](#1-maints---turn-the-hooks-on-and-get-out-of-the-way)
    - [2. The database - and which hook it closes in](#2-the-database---and-which-hook-it-closes-in)
    - [3. Redis - the same hook, for the same reason](#3-redis---the-same-hook-for-the-same-reason)
    - [4. Background jobs - the job in hand finishes](#4-background-jobs---the-job-in-hand-finishes)
    - [5. Shutdown Timeout Configuration](#5-shutdown-timeout-configuration)
      - [Environment Variable](#environment-variable)
      - [Configuration Files](#configuration-files)
      - [Two Levels of Timeout](#two-levels-of-timeout)
      - [Timeline Example](#timeline-example)
      - [Recommended Values](#recommended-values)
  - [Testing](#testing)
    - [Local Testing (Development)](#local-testing-development)
      - [Test 1: Ctrl+C Shutdown](#test-1-ctrlc-shutdown)
      - [Test 2: Kill Command (Windows PowerShell)](#test-2-kill-command-windows-powershell)
      - [Test 3: With Active Requests](#test-3-with-active-requests)
    - [Docker Testing](#docker-testing)
    - [Kubernetes Testing](#kubernetes-testing)
  - [Troubleshooting](#troubleshooting)
    - [Problem: App Takes Too Long to Shutdown](#problem-app-takes-too-long-to-shutdown)
    - [Problem: Connection Errors During Deployment](#problem-connection-errors-during-deployment)
    - [Problem: Database Complaining About Connections](#problem-database-complaining-about-connections)
    - [Problem: Shutdown Logs Not Appearing](#problem-shutdown-logs-not-appearing)
  - [Summary](#summary)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

# Graceful Shutdown

## Table of Contents
- [What is Graceful Shutdown?](#what-is-graceful-shutdown)
- [Why Do We Need It?](#why-do-we-need-it)
- [Key Concepts](#key-concepts)
- [How It Works](#how-it-works)
- [Implementation Details](#implementation-details)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

---

## What is Graceful Shutdown?

**Graceful shutdown** means your application exits cleanly when told to stop, finishing all its work properly before shutting down completely.

### Real-World Analogy

Imagine a restaurant at closing time:

**❌ Ungraceful Shutdown (Bad):**
- Clock hits 10 PM → Manager immediately kicks everyone out
- Customers mid-meal get their plates taken away
- Chefs drop what they're cooking
- Cash register left open
- Doors locked while people are still inside

**✅ Graceful Shutdown (Good):**
- Clock hits 10 PM → Manager stops seating new customers
- Existing customers finish their meals
- Chefs complete current orders
- Staff cleans up properly
- Cash register balanced and closed
- Everyone leaves safely, doors locked

Your application works the same way. When it receives a shutdown signal, it should:
1. Stop accepting new requests
2. Finish processing current requests
3. Close database connections properly
4. Close cache connections
5. Clean up resources
6. Exit cleanly

---

## Why Do We Need It?

### 1. Zero-Downtime Deployments

When you deploy a new version of your app:

```
Without Graceful Shutdown:
Old app → KILLED instantly
Users → 502 Bad Gateway errors
Database → Connection errors
You → Angry users

With Graceful Shutdown:
Old app → Stops accepting new requests
Load balancer → Routes new traffic to new app
Old app → Finishes current requests
Old app → Exits cleanly after 5-30s
Users → Never notice anything happened ✨
```

### 2. Data Integrity

Imagine your app is saving a user's profile photo:

```
Without Graceful Shutdown:
1. User uploads photo
2. App starts processing...
3. SIGTERM received → App dies instantly
4. Photo upload incomplete
5. Database left in inconsistent state
6. User's profile broken

With Graceful Shutdown:
1. User uploads photo
2. App starts processing...
3. SIGTERM received → App marked for shutdown
4. Photo upload completes (request in-flight)
5. Database transaction commits
6. App exits after work done
7. User's profile perfect ✅
```

### 3. Connection Pool Health

```
Without Graceful Shutdown:
Database sees: "Connection forcibly closed" ❌
Redis sees: "Client disconnected abruptly" ❌
→ Connection pool has to clean up broken connections
→ Slower for other apps using same database

With Graceful Shutdown:
Database sees: "Client disconnected gracefully" ✅
Redis sees: "Client quit cleanly" ✅
→ Connection pool stays healthy
→ Fast for everyone
```

---

## Key Concepts

### Signals

**What is a signal?**
A signal is like a text message from your operating system (OS) to your application. Common signals:

#### SIGTERM (Signal Terminate)
- **What it means:** "Please shut down gracefully"
- **Polite:** Yes - your app can clean up first
- **Sent by:** Kubernetes, Docker, `kill <pid>` command
- **What you should do:** Clean up and exit within ~30s

#### SIGINT (Signal Interrupt)
- **What it means:** "User pressed Ctrl+C"
- **Polite:** Yes - your app can clean up first
- **Sent by:** User pressing Ctrl+C in terminal
- **What you should do:** Same as SIGTERM

#### SIGKILL (Signal Kill)
- **What it means:** "DIE NOW!"
- **Polite:** NO - instant death
- **Sent by:** `kill -9 <pid>` or OS out-of-patience
- **What you can do:** Nothing - you're already dead
- **Avoid:** Never send SIGKILL first - always try SIGTERM

### Lifecycle Hooks

Think of lifecycle hooks as events in your app's life:

```
App lifecycle:
├── Birth  → onModuleInit()            (starting up)
├── Life   → (running normally)
└── Death  → onModuleDestroy()         ─┐
           → beforeApplicationShutdown  │  Nest runs these in order,
           → (HTTP server stops)        │  and the server stops in
           → onApplicationShutdown     ─┘  the middle of them
```

There are three shutdown hooks, not one, and **which you pick decides whether
shutdown is graceful**.

`onModuleDestroy` runs *before* the HTTP server stops, so anything you close
there is taken away from requests that are still running. That is the whole
trap: closing the database in `onModuleDestroy` looks correct, passes every
test that does not have a request in flight, and breaks exactly the case this
feature exists for.

**So connections close in `onApplicationShutdown`**, which runs after the
server has stopped and the last request has finished.

### In-Flight Requests

**What are "in-flight" requests?**
Requests that have started but haven't finished yet.

```
Timeline:
0s: User clicks "Upload Photo" → Request arrives
1s: App processing upload...
2s: SIGTERM received
3s: App still processing upload... (in-flight)
4s: Upload completes → Response sent to user ✅
5s: App exits cleanly

If we didn't wait for in-flight requests:
2s: SIGTERM received → App dies instantly
User sees: "ERR_CONNECTION_RESET" ❌
```

---

## How It Works

### The Shutdown Sequence

```
Step 1: Signal Received
┌─────────────────────────────────┐
│ Kubernetes: "Time to update!"   │
│ Sends SIGTERM to your app       │
└─────────────────────────────────┘
           ↓
Step 2: Nest starts the shutdown sequence
┌──────────────────────────────────────┐
│ enableShutdownHooks() handles the    │
│ signal. main.ts only logs it.        │
└──────────────────────────────────────┘
           ↓
Step 3: onModuleDestroy hooks run
┌──────────────────────────────────────┐
│ Nothing here closes a connection     │
│ that in-flight requests still need   │
└──────────────────────────────────────┘
           ↓
Step 4: HTTP server stops accepting, and waits
┌──────────────────────────────────────┐
│ New connections → refused            │
│ 3 requests still processing...       │
│ 2 requests still processing...       │
│ 0 requests - all done                │
└──────────────────────────────────────┘
           ↓
Step 5: onApplicationShutdown hooks run
┌──────────────────────────────────────┐
│ BullMQ workers (auth, file-cleanup,  │
│ maintenance)                         │
│   → finish the job in hand, close    │
│ PrismaLifecycleService               │
│   → $disconnect(), then pool.end()   │
│ CacheCleanupService                  │
│   → closes the cache stores          │
│ RedisClientCleanupService            │
│   → closes the raw Redis client      │
└──────────────────────────────────────┘
           ↓
Step 6: the event loop empties, the process exits
┌──────────────────────────────────────┐
│ No process.exit() is called.         │
│ Nothing is left holding a socket,    │
│ so Node exits on its own - which is  │
│ the real test that this worked.      │
└──────────────────────────────────────┘
```

### Timeout Protection

What if a request takes too long?

```
Kubernetes/Docker Configuration:
terminationGracePeriodSeconds: 30

Timeline:
0s:  SIGTERM sent
0s:  Graceful shutdown starts
...
29s: Still waiting for 1 slow request
30s: Kubernetes: "Time's up!"
30s: SIGKILL sent → App killed instantly
```

**Best practice:** Set timeout shorter than `terminationGracePeriodSeconds`:
- Kubernetes timeout: 30s
- App shutdown timeout: 10-15s
- Buffer: 15-20s for cleanup

---

## Implementation Details

### 1. `main.ts` - turn the hooks on, and get out of the way

```typescript
// Stop the HTTP server, let in-flight requests finish, then close
// connections (onApplicationShutdown hooks).
app.enableShutdownHooks()

await app.listen(port)

// `once`, not `on`: after shutting down, Nest re-sends the signal to the
// process, which logged this line twice.
process.once('SIGTERM', () => logger.log('SIGTERM received, shutting down gracefully', 'Bootstrap'))
process.once('SIGINT', () => logger.log('SIGINT received, shutting down gracefully', 'Bootstrap'))
```

That is all of it. `enableShutdownHooks()` makes Nest listen for the signals
and run the shutdown sequence itself - there is **no hand-written
`app.close()` and no `process.exit()`**, because calling `close()` from your
own handler while Nest is also handling the signal races with it, and
`process.exit()` truncates whatever was still in flight.

The two listeners above only log. Everything that actually closes is in a
lifecycle hook, below.

### 2. The database - and which hook it closes in

```typescript
@Injectable()
export class PrismaLifecycleService implements OnModuleInit, OnApplicationShutdown {
    async onApplicationShutdown() {
        this.logger.log('Closing database connections')
        await this.prisma.$disconnect()

        // $disconnect() does not end an externally supplied pool - without
        // this the process keeps live sockets and never exits on SIGTERM.
        try {
            await this.pool.end()
        } catch {
            // Already ended; shutdown must not hang.
        }

        this.logger.log('Database connections closed')
    }
}
```

Two details here were both bugs before they were features.

**`onApplicationShutdown`, not `onModuleDestroy`.** Nest's `close()` runs
`onModuleDestroy`, then `beforeApplicationShutdown`, then **stops the HTTP
server**, then `onApplicationShutdown`. Closing the database in
`onModuleDestroy` pulls it out from under the requests that were in flight
when the signal arrived - the exact requests graceful shutdown exists to
protect.

**`pool.end()`.** This app gives Prisma a `pg` Pool of its own, and
`$disconnect()` does not close a pool it did not create. The sockets stayed
open and referenced, `await app.close()` resolved, and the process simply
never exited: Docker waited out the grace period and sent SIGKILL, cutting
every in-flight request. A graceful shutdown that ends in SIGKILL is not one.

### 3. Redis - the same hook, for the same reason

```typescript
@Injectable()
export class CacheCleanupService implements OnApplicationShutdown {
    constructor(
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
        private configService: ConfigService
    ) {}
    
    async onApplicationShutdown() {
        this.logger.log('Closing cache connections')
        
        // From config; 5000ms by default.
        const timeout = this.configService.get<number>('app.gracefulShutdownTimeout')!
        
        // Give up if closing gets stuck.
        const cleanupPromise = this.cleanup()
        const timeoutPromise = new Promise<void>((resolve) => {
            setTimeout(() => {
                this.logger.warn(`Cache cleanup timed out after ${timeout}ms, continuing`)
                resolve()
            }, timeout)
        })

        // Whichever finishes first wins.
        await Promise.race([cleanupPromise, timeoutPromise])
        
        this.logger.log('Cache cleanup complete')
    }

    private async cleanup(): Promise<void> {
        try {
            const store = this.cacheManager.store as any
            
            // Close multi-layer cache stores
            if (store?.stores && Array.isArray(store.stores)) {
                for (const keyvStore of store.stores) {
                    try {
                        // KeyvRedis uses disconnect()
                        if (typeof keyvStore?.disconnect === 'function') {
                            await keyvStore.disconnect()
                        }
                    } catch {
                        // Ignore individual store errors
                    }
                }
            }
        } catch (error) {
            this.logger.warn(`Cache cleanup error (non-fatal): ${error.message}`)
        }
    }
}
```

**Redis `.quit()` vs `.disconnect()`:**
- **`.quit()`** - Graceful (waits for pending commands) ✅
- **`.disconnect()`** - Forceful (drops pending commands) ❌

### 4. Background jobs - the job in hand finishes

The app also runs three BullMQ workers, one per queue
([`queues.ts`](../src/shared/infrastructure/queue/queues.ts)):

| Queue | Consumer | Jobs |
|---|---|---|
| `auth` | `AuthJobsConsumer` | sign-in emails (`send-code`: a sign-up, reset or deletion code; security notices) |
| `file-cleanup` | `FileCleanupConsumer` | deleting replaced and deleted avatars |
| `maintenance` | `MaintenanceConsumer` | every periodic job: the deleted-account sweep, auth's hourly clean-up |

`@nestjs/bullmq` closes each worker in its own `onApplicationShutdown` hook,
with `worker.close()`: the worker stops taking new jobs and **waits for the
job it is running to finish**. A `send-code` email that is half sent when
SIGTERM arrives is still sent. Jobs still waiting stay in Redis, and the next
container picks them up.

If the job in hand outlasts the container's stop timeout (Docker's default is
10 seconds), the process is killed mid-job. Nothing is lost: BullMQ notices
the job's lock has expired (a "stalled" job) and runs it again on the next
worker. The cost is a short delay, and in the rare case that the email had
already left, the person gets the same code twice.

The periodic jobs are **job schedulers** stored in Redis
(`deleted-accounts-sweep`, `auth-clean-up`, registered by
[`maintenance.consumer.ts`](../src/maintenance/maintenance.consumer.ts) at
boot with `upsertJobScheduler`). A restart neither loses it nor creates a
second one, and with several instances each tick still runs once.

### 5. Shutdown Timeout Configuration

The timeout controls **cache cleanup only**, not the entire shutdown process.

#### Environment Variable

```bash
# .env
GRACEFUL_SHUTDOWN_TIMEOUT_MS=5000  # 5 seconds (default)
```

#### Configuration Files

**app.config.ts:**
```typescript
import { registerAs } from '@nestjs/config'
import { parseIntSafe } from '@/shared/utils'

export default registerAs('app', () => ({
    gracefulShutdownTimeout: parseIntSafe(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS, 5000)
}))
```

**validation.ts:**
```typescript
export const validationSchema = Joi.object({
    GRACEFUL_SHUTDOWN_TIMEOUT_MS: Joi.number().default(5000),
    // ... other validations
})
```

#### Two Levels of Timeout

**1. Cache cleanup timeout (`GRACEFUL_SHUTDOWN_TIMEOUT_MS`)**
- **Controls:** closing the cache stores, and nothing else
- **Default:** 5000ms
- **If exceeded:** logs a warning and carries on shutting down
- **Recommended:** 3000-5000ms

  A hung Redis must not be able to hold the whole shutdown open. It has
  nothing this process needs any more, and the platform timeout below is not
  a warning - it is a SIGKILL.

**2. Platform Timeout (External)**
- **Controls:** Entire shutdown process
- **Set by:** Kubernetes/Docker (`terminationGracePeriodSeconds`)
- **Default:** Usually 30 seconds
- **If exceeded:** SIGKILL sent (forceful termination)

#### Timeline Example

```
0ms:   SIGTERM received, Nest starts shutting down
       ↓
       onModuleDestroy hooks (nothing that requests still need)
       ↓
       HTTP server stops accepting, in-flight requests finish
       ↓
       onApplicationShutdown hooks:
       CacheCleanupService
       ├─ starts closing the cache stores
       ├─ starts a GRACEFUL_SHUTDOWN_TIMEOUT_MS timer
       └─ whichever finishes first wins
          ├─ Redis closes in 100ms  → continue immediately
          └─ Redis hangs           → the timer fires, continue anyway
       ↓
       PrismaLifecycleService: $disconnect(), then pool.end()
       ↓
       Nothing is holding a socket, so the process exits
```

#### Recommended Values

```bash
# Quick failover (local development)
GRACEFUL_SHUTDOWN_TIMEOUT_MS=3000

# Balanced (recommended for production)
GRACEFUL_SHUTDOWN_TIMEOUT_MS=5000

# Slow network tolerance
GRACEFUL_SHUTDOWN_TIMEOUT_MS=10000
```

**Cache cleanup typically takes:**
- Local Redis: 10-50ms ⚡
- Remote Redis: 100-500ms 🌐
- Slow network: 1-2s 🐌
- Stuck/dead connection: ∞ (times out at configured value) ⏱️

**Important:** If cache closes quickly (e.g., 100ms), shutdown continues immediately. The timeout is a **safety net** for stuck connections, not a target wait time.

---

## Testing

### Local Testing (Development)

#### Test 1: Ctrl+C Shutdown

```bash
# Terminal 1: start the app
pnpm dev

# Wait for app to start, then press Ctrl+C
# Expected output:
🛑 SIGINT received, starting graceful shutdown...
🗄️  Closing database connections...
✅ Database connections closed
📦 Closing cache connections...
✅ Cache cleanup complete
```

#### Test 2: Kill Command (Windows PowerShell)

```powershell
# Terminal 1: start the app
pnpm dev

# Terminal 2: Find process and send SIGTERM
# Get process ID
Get-Process -Name node | Where-Object {$_.MainWindowTitle -like "*nest*"}

# Send SIGTERM (graceful)
Stop-Process -Id <PID>

# Expected: Same logs as above
```

#### Test 3: With Active Requests

```bash
# Terminal 1: start the app
pnpm dev

# Terminal 2: Make continuous requests
while ($true) { Invoke-WebRequest http://localhost:8888/api/v1/health; Start-Sleep -Milliseconds 100 }

# Terminal 3: Send SIGTERM
Stop-Process -Id <PID>

# Expected:
# - All requests complete successfully (200 OK)
# - No "ERR_CONNECTION_RESET" errors
# - Clean shutdown after last request
```

### Docker Testing

The repository's own `Dockerfile` is already set up for this: the production
stage ends with `exec node dist/src/main`, so the app is PID 1 and the
container's signals reach Node rather than a shell that ignores them. To watch
it happen:

```bash
docker build --target prod -t my-app .
docker run -p 3000:3000 my-app

# In another terminal, stop gracefully
docker stop my-app
# Docker sends SIGTERM, waits 10s, then SIGKILL

# Check logs
docker logs my-app
# Should see graceful shutdown logs
```

### Kubernetes Testing

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 3
  template:
    spec:
      terminationGracePeriodSeconds: 30  # Wait 30s before SIGKILL
      containers:
      - name: app
        image: my-app:latest
        lifecycle:
          preStop:
            exec:
              # Optional: Wait 5s before SIGTERM to let load balancer update
              command: ["/bin/sh", "-c", "sleep 5"]
```

**Test rolling update:**

```bash
# Deploy v1
kubectl apply -f deployment.yaml

# Make continuous requests
while true; do curl http://my-app/api/v1/health; sleep 0.1; done

# Deploy v2
kubectl set image deployment/my-app app=my-app:v2

# Expected:
# - No 502/503 errors (or very few during load balancer update)
# - All requests complete successfully
# - Smooth transition from v1 to v2
```

---

## Troubleshooting

### Problem: App Takes Too Long to Shutdown

**Symptoms:**
```
[LOG] SIGTERM received, starting graceful shutdown...
[LOG] Closing cache connections...
... (30 seconds pass)
Killed (SIGKILL sent by K8s)
```

**Possible Causes:**
1. **Stuck in-flight requests** - A request is taking too long
2. **Database query hanging** - Long-running query won't finish
3. **Redis connection stuck** - Network issue preventing clean close

**Solution:**
Add shutdown timeout:

```typescript
const shutdown = async (signal: string) => {
    logger.log(`${signal} received, starting graceful shutdown...`)
    
    // Set timeout for shutdown
    const shutdownTimeout = setTimeout(() => {
        logger.warn('Shutdown timeout - forcing exit')
        process.exit(1)
    }, 10000) // 10 seconds
    
    try {
        await app.close()
        clearTimeout(shutdownTimeout)
        logger.log('Application shut down gracefully')
        process.exit(0)
    } catch (error) {
        logger.error(`Shutdown error: ${error.message}`)
        process.exit(1)
    }
}
```

### Problem: Connection Errors During Deployment

**Symptoms:**
- Users see `ERR_CONNECTION_RESET`
- Logs show `ECONNRESET` errors
- 502 Bad Gateway during deployment

**Possible Causes:**
1. Load balancer not updated before shutdown
2. App shutting down too fast
3. No graceful shutdown implemented

**Solution:**

Add `preStop` hook in Kubernetes:

```yaml
lifecycle:
  preStop:
    exec:
      command: ["/bin/sh", "-c", "sleep 5"]
```

This gives the load balancer 5 seconds to update before the app starts shutting down.

### Problem: Database Complaining About Connections

**Symptoms in database logs:**
```
WARNING: Connection forcibly closed
ERROR: Unexpected EOF on client connection
```

**Cause:** the app is not disconnecting properly - or is disconnecting, but
the process is being SIGKILLed before it finishes.

**Solution:** check `PrismaLifecycleService.onApplicationShutdown()` in
`src/shared/infrastructure/persistence/database/prisma.service.ts`. It must
call **both** `$disconnect()` and `pool.end()`: without the second, the
process never exits on its own and the platform eventually kills it.

### Problem: Shutdown Logs Not Appearing

**Symptoms:**
- App just exits
- No shutdown logs visible

**Possible Causes:**
1. `app.enableShutdownHooks()` not called
2. Signal handlers not registered
3. Logger flushing before logs written

**Solution:**

```typescript
// Ensure hooks enabled
app.enableShutdownHooks()

// Ensure handlers registered
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// For Pino logger, ensure flush
const logger = app.get(Logger)
await new Promise(resolve => setTimeout(resolve, 100)) // Let logger flush
```

---

## Summary

**Graceful shutdown = Your app is a good citizen**

✅ **Implements graceful shutdown:**
- Respects SIGTERM/SIGINT signals
- Finishes current work before exiting
- Closes connections properly
- Exits with code 0

❌ **Doesn't implement graceful shutdown:**
- Ignores signals or exits immediately
- Drops in-flight requests
- Leaves connections hanging
- Causes errors for users during deployments

**Our implementation:**
- ✅ `main.ts` - Signal handlers
- ✅ BullMQ workers - the job in hand finishes, waiting jobs stay in Redis
- ✅ `PrismaService` - Database cleanup
- ✅ `CacheCleanupService` - Redis cleanup
- ✅ Ready for Kubernetes/Docker
- ✅ Zero-downtime deployments possible
