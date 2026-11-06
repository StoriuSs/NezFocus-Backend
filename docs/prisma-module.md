<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**  *generated with [DocToc](https://github.com/thlorenz/doctoc)*

- [Prisma Module](#prisma-module)
  - [Table of Contents](#table-of-contents)
  - [Architecture](#architecture)
  - [Prisma 7 Configuration](#prisma-7-configuration)
    - [`prisma.config.ts`](#prismaconfigts)
    - [`schema.prisma`](#schemaprisma)
    - [Multi-File Schema](#multi-file-schema)
    - [The auth tables](#the-auth-tables)
  - [PrismaService](#prismaservice)
    - [Extended Client Factory](#extended-client-factory)
    - [PrismaService Token](#prismaservice-token)
    - [Lifecycle Management](#lifecycle-management)
  - [PrismaModule](#prismamodule)
  - [Common Commands](#common-commands)
  - [Upgrading from the Keycloak starter](#upgrading-from-the-keycloak-starter)
  - [Environment Variables](#environment-variables)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

# Prisma Module

Database access layer using **Prisma 7** with the **pg adapter**, client extensions for query monitoring, and a factory-based NestJS integration.

## Table of Contents

- [Architecture](#architecture)
- [Prisma 7 Configuration](#prisma-7-configuration)
    - [prisma.config.ts](#prismaconfigts)
    - [schema.prisma](#schemaprisma)
    - [Multi-File Schema](#multi-file-schema)
    - [The auth tables](#the-auth-tables)
- [PrismaService](#prismaservice)
    - [Extended Client Factory](#extended-client-factory)
    - [PrismaService Token](#prismaservice-token)
    - [Lifecycle Management](#lifecycle-management)
- [PrismaModule](#prismamodule)
- [Common Commands](#common-commands)
- [Upgrading from the Keycloak starter](#upgrading-from-the-keycloak-starter)
- [Environment Variables](#environment-variables)

---

## Architecture

```
prisma.config.ts                    # Prisma 7 config, at the repo root (env file, datasource URL, migrations, seed)

prisma/
├── schema.prisma                   # Generator + datasource provider
├── models/
│   ├── users.prisma                # User (owned by the users module)
│   └── auth.prisma                 # Credential, Session, RefreshToken, VerificationCode,
│                                   # OAuthAccount (owned by the auth module)
├── seed.ts                         # Two demo users with no password (pnpm prisma:seed)
└── migrations/                     # Migration history

src/shared/infrastructure/persistence/database/
├── prisma.module.ts                # Global NestJS module (factory provider)
└── prisma.service.ts               # Extended client + lifecycle service

generated/prisma/                   # Auto-generated Prisma client output
```

**Data flow:**

```
prisma.config.ts  →  Prisma CLI reads datasource URL
schema.prisma     →  Prisma generates client into generated/prisma/
prisma.service.ts →  Creates extended client with pg adapter + query monitoring
prisma.module.ts  →  Exposes PrismaService globally via factory
```

---

## Prisma 7 Configuration

### `prisma.config.ts`

Prisma 7 moved configuration out of `schema.prisma` into a TypeScript config file at the project root. This is where the datasource URL and migration path are defined:

```typescript
// prisma.config.ts
import path from 'path'
import { config } from 'dotenv'
import { defineConfig, env } from 'prisma/config'

// The same env file the app uses: .env.development unless NODE_ENV says otherwise.
// Variables already set (in a container) win; there is no file there.
config({ path: path.resolve(__dirname, `.env.${process.env.NODE_ENV || 'development'}`), quiet: true })

export default defineConfig({
    schema: 'prisma/',                               // Directory containing schema files
    migrations: {
        path: 'prisma/migrations',                   // Where migration files are stored
        seed: 'ts-node --transpile-only prisma/seed.ts' // Prisma 7 reads the seed command here
    },
    datasource: {
        url: env('DATABASE_URL'),
        // An empty scratch database for `pnpm prisma:check` only
        shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL
    }
})
```

> In Prisma 6, the datasource URL lived in `schema.prisma`. In Prisma 7, it's in `prisma.config.ts`. The `schema.prisma` datasource block only declares the **provider** (e.g., `postgresql`).

### `schema.prisma`

The main schema file now only contains the generator and the datasource provider:

```prisma
generator client {
    provider = "prisma-client"      // Prisma 7 uses "prisma-client" (not "prisma-client-js")
    output   = "../generated/prisma"
}

datasource db {
    provider = "postgresql"         // No 'url' — that's in prisma.config.ts now
}
```

**Key Prisma 7 changes:**
- `provider = "prisma-client"` — New generator name (replaces `prisma-client-js`)
- `output = "../generated/prisma"` — Client is generated to `generated/prisma/` instead of `node_modules`
- No `url` in the datasource block — Moved to `prisma.config.ts`
- Imports: `import { PrismaClient } from '@/generated/prisma/client'` (not `@prisma/client`)

### Multi-File Schema

Prisma supports splitting your schema across multiple `.prisma` files in the `prisma/` directory. The config `schema: 'prisma/'` tells Prisma to scan the entire directory:

```
prisma/
├── schema.prisma          # Generator + datasource
└── models/
    ├── users.prisma       # model User { ... }
    └── auth.prisma        # the auth module's seven models
```

Add new models by creating new `.prisma` files in `prisma/models/`. Prisma will automatically pick them up. One file per module keeps ownership visible: only the module that owns a file's models reads or writes those tables (see [hexagonal-architecture.md](./hexagonal-architecture.md)).

### The auth tables

`prisma/models/auth.prisma` belongs to the auth module. The users module never reads these tables; the auth module reaches the `User` row through a port. Every table references `User` with `onDelete: Cascade`.

| Model | One row per | Notes |
|---|---|---|
| `Credential` | account that has a password | `passwordHash` is Argon2id, parameters inside the string ([passwords-and-codes.md](./auth/passwords-and-codes.md)) |
| `Session` | sign-in | its id is the access token's `sid` claim; `revokedReason` says why it ended ([sessions-and-tokens.md](./auth/sessions-and-tokens.md)) |
| `RefreshToken` | refresh token ever issued to a session | stores a SHA-256 hash, never the token; a used one presented again is how theft is noticed |
| `VerificationCode` | live emailed code per account and purpose | an HMAC of the code (keyed with `JWT_SECRET`), not the code |
| `OAuthAccount` | link to a Google account | ([google-sign-in.md](./auth/google-sign-in.md)) |

---

## PrismaService

Located at [prisma.service.ts](../src/shared/infrastructure/persistence/database/prisma.service.ts).

### Extended Client Factory

Instead of subclassing `PrismaClient`, we use a **factory function** that creates an extended client. This is the Prisma 7 way — `$extends` replaces middleware and subclassing:

```typescript
export function createExtendedPrismaClient(metrics: MetricsService, pool: Pool) {
    const adapter = new PrismaPg(pool)
    const client = new PrismaClient({ adapter })

    return client.$extends({
        query: {
            $allModels: {
                async $allOperations({ operation, args, query }) {
                    const start = Date.now()
                    try {
                        const result = await query(args)
                        metrics.recordDbQuery(operation, Date.now() - start)
                        return result
                    } catch (error) {
                        metrics.recordDbQuery(operation, Date.now() - start)
                        throw error
                    }
                }
            }
        }
    })
}

export type ExtendedPrismaClient = ReturnType<typeof createExtendedPrismaClient>
```

**What this does:**
1. **`Pool` + `PrismaPg`** — Uses the `@prisma/adapter-pg` driver adapter instead of Prisma's built-in connection management. This gives you direct control over the `pg` connection pool. The factory does not create the pool: `PrismaModule` provides it under the `PG_POOL` token (below), so shutdown can close it.
2. **`$extends` with query monitoring** — Wraps every database operation to measure execution time and report to `MetricsService` (Prometheus).

### PrismaService Token

The `PrismaService` class is an injection token — the actual instance is the extended client returned by the factory:

```typescript
export interface PrismaService extends ExtendedPrismaClient {}

@Injectable()
export class PrismaService {
    constructor() {
        // Actual instance is provided by the factory in PrismaModule
    }
}
```

The `interface PrismaService extends ExtendedPrismaClient` uses TypeScript's declaration merging to give full autocompletion. When you inject `PrismaService`, TypeScript sees it as the extended client with all Prisma methods plus your extensions.

### Lifecycle Management

Since the extended client is created by a factory (not `new PrismaService()`), lifecycle hooks are handled by a separate service:

```typescript
@Injectable()
export class PrismaLifecycleService implements OnModuleInit, OnApplicationShutdown {
    constructor(
        @Inject(PrismaService) private readonly prisma: ExtendedPrismaClient,
        @Inject(PG_POOL) private readonly pool: Pool
    ) {}

    async onModuleInit() {
        await this.prisma.$connect()
    }

    async onApplicationShutdown() {
        await this.prisma.$disconnect()
        // $disconnect() does not end a pool the adapter was given: without
        // this the process keeps live sockets and never exits on SIGTERM.
        await this.pool.end()
    }
}
```

Two choices here matter, and both are explained in [graceful-shutdown.md](./graceful-shutdown.md#2-the-database---and-which-hook-it-closes-in): the connection closes in `onApplicationShutdown` (after the HTTP server has finished the requests in flight, not before), and the pool is ended explicitly.

---

## PrismaModule

Located at [prisma.module.ts](../src/shared/infrastructure/persistence/database/prisma.module.ts).

```typescript
@Global()
@Module({
    providers: [
        {
            provide: PG_POOL,
            inject: [ConfigService],
            useFactory: (configService: ConfigService) =>
                new Pool({
                    connectionString: configService.get<string>('database.url'),
                    max: configService.get<number>('database.poolMax'),                              // DB_POOL_MAX
                    idleTimeoutMillis: configService.get<number>('database.poolIdleTimeoutMs'),      // DB_POOL_IDLE_TIMEOUT_MS
                    connectionTimeoutMillis: configService.get<number>('database.poolConnectionTimeoutMs') // DB_POOL_CONNECTION_TIMEOUT_MS
                })
        },
        {
            provide: PrismaService,
            inject: [MetricsService, PG_POOL],
            useFactory: (metrics: MetricsService, pool: Pool) => createExtendedPrismaClient(metrics, pool)
        },
        PrismaLifecycleService
    ],
    exports: [PrismaService]
})
export class PrismaModule {}
```

**Key design decisions:**

| Decision | Reason |
|---|---|
| `@Global()` | PrismaService is available everywhere without importing PrismaModule |
| `useFactory` | The extended client must be created by a function, not `new PrismaService()` |
| `PG_POOL` as its own provider | The lifecycle service needs the pool to `end()` it at shutdown; its size and timeouts come from config |
| `inject: [MetricsService, PG_POOL]` | Factory needs MetricsService for query monitoring, and the pool |
| `PrismaLifecycleService` | Handles `$connect()` / `$disconnect()` and `pool.end()` since the factory-created client has no lifecycle hooks |

---

## Common Commands

```bash
# Generate the client (after schema changes)
pnpm prisma:generate

# Create a migration (after model changes)
pnpm prisma:migrate

# Apply migrations (production)
pnpm prisma:migrate:prod

# Open Prisma Studio (a visual database browser)
pnpm prisma:studio

# Reset the database (drop + recreate + seed) — development only.
# Wipes everything, auth included: every account, password and session.
# Sign up again afterwards.
pnpm prisma:reset

# Add the two demo users again (no password: nobody can sign in as them)
pnpm prisma:seed

# Are the migrations in step with the schema? CI runs this.
pnpm prisma:check
```

`prisma.config.ts` loads `.env.<NODE_ENV>` itself, so a bare
`pnpm exec prisma studio` works too. It reads `.env.development` unless
`NODE_ENV` says otherwise — which is what `prisma:migrate:prod` sets.

Before Prisma reads that config it needs `DATABASE_URL`, so **a fresh clone
has to copy `.env.example` to `.env.development` first**. Without it every
Prisma command fails, and the error does not mention the missing file.

There is no `db push` script on purpose. It changes the database without
writing a migration, so the next person to clone the repository gets a
different schema from yours.

---

## Upgrading from the Keycloak starter

This starter began with Keycloak handling sign-in. If you are upgrading a
database that was created by that version, migration
`20260923000000_self_hosted_auth` **drops the `User.keycloakId` and
`User.identityDeletedAt` columns**. The data in them is lost, and nothing in
the new schema links a user to their Keycloak account. Users keep their row
(id, email, profile), but have no password here: they sign in again with an
emailed code, by setting a password ("forgot password"), or with Google. Back
up first ([backups.md](./backups.md)). A fresh clone has nothing to lose.

Migration `20261106000000_codes_by_email` (D-129, D-133) keeps them too. It
drops the old `emailVerified` column, and deletes only old sign-ups that never
confirmed their address **and** have a password here, which these users do
not. It adds `completedAt`, set from `createdAt` for every account that had
already chosen a username; any other account is "not completed" and will go
through "complete your account" at its next sign-in. It also drops every live emailed code (they
last ten minutes) and re-keys the `VerificationCode` table by address and
purpose.

Migration `20261106100000_complete_account` drops `User.hasSetUsername` (a
username is now chosen only in "complete your account"), adds
`User.termsAcceptedAt` (empty for accounts completed before it), and creates
the `UserSettings` table, one row per completed account. Accounts completed
before it have no row; their settings read as the defaults.

---

## Environment Variables

```env
# Required — database connection string
DATABASE_URL="postgresql://user:password@localhost:5432/dbname?schema=public"

# Connection pool (defaults shown). Keep DB_POOL_MAX x app instances well
# under Postgres' max_connections.
DB_POOL_MAX=10
DB_POOL_IDLE_TIMEOUT_MS=30000
DB_POOL_CONNECTION_TIMEOUT_MS=10000

# Only for `pnpm prisma:check`: an empty scratch database the migrations are
# replayed into. Each run wipes it.
SHADOW_DATABASE_URL=postgresql://user:password@localhost:5432/dbname_shadow
```

`DATABASE_URL` is read in two places:
1. **`prisma.config.ts`** — Used by Prisma CLI for migrations and generation (`env('DATABASE_URL')`)
2. **`PrismaModule`'s `PG_POOL` provider** — Used at runtime by the `pg` Pool (through `ConfigService`, `database.url` in [`database.config.ts`](../src/config/database.config.ts))

The full list is in [environment.md](./environment.md).
