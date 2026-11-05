<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**  *generated with [DocToc](https://github.com/thlorenz/doctoc)*

- [Testing](#testing)
  - [Table of Contents](#table-of-contents)
  - [What we test](#what-we-test)
  - [What is Testing?](#what-is-testing)
    - [Why Test?](#why-test)
  - [Types of Tests](#types-of-tests)
    - [1. Unit Tests (Most Common)](#1-unit-tests-most-common)
    - [2. Integration Tests](#2-integration-tests)
    - [3. E2E Tests (End-to-End)](#3-e2e-tests-end-to-end)
    - [Testing Pyramid](#testing-pyramid)
  - [Key Concepts](#key-concepts)
    - [Mocking](#mocking)
    - [AAA Pattern](#aaa-pattern)
    - [describe() and it()](#describe-and-it)
    - [beforeEach / afterEach](#beforeeach--aftereach)
  - [Quick Start](#quick-start)
  - [The Suites in This Starter](#the-suites-in-this-starter)
    - [Unit tests](#unit-tests)
    - [E2E tests](#e2e-tests)
    - [Integration tests](#integration-tests)
  - [Test Structure](#test-structure)
  - [Testing in Hexagonal Architecture](#testing-in-hexagonal-architecture)
    - [What to Test Per Layer](#what-to-test-per-layer)
    - [What NOT to Test](#what-not-to-test)
    - [The Port Mocking Pattern](#the-port-mocking-pattern)
    - [Testing Event Publishing](#testing-event-publishing)
    - [Test File Locations](#test-file-locations)
  - [Writing Tests](#writing-tests)
    - [Unit Test Example](#unit-test-example)
    - [Command Handler Test Example (with port mocking)](#command-handler-test-example-with-port-mocking)
    - [E2E Test Example](#e2e-test-example)
  - [Common Jest Matchers](#common-jest-matchers)
  - [Code Coverage](#code-coverage)
  - [Best Practices](#best-practices)
  - [Troubleshooting](#troubleshooting)
    - ["Reflect.getMetadata is not a function"](#reflectgetmetadata-is-not-a-function)
    - [Tests timing out](#tests-timing-out)
    - [Module not found errors](#module-not-found-errors)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

# Testing

This page is for anyone about to run the tests or write one: what the three
kinds of test are, which suites the starter has and what each one proves, the
commands, and the patterns to copy.

> The OpenAPI contract test and `pnpm openapi:check` are described in [openapi.md](./openapi.md).

## Table of Contents
- [What we test](#what-we-test)
- [What is Testing?](#what-is-testing)
- [Types of Tests](#types-of-tests)
- [Key Concepts](#key-concepts)
- [Quick Start](#quick-start)
- [The Suites in This Starter](#the-suites-in-this-starter)
- [Testing in Hexagonal Architecture](#testing-in-hexagonal-architecture)
- [Writing Tests](#writing-tests)
- [Best Practices](#best-practices)

---

## What we test

Only what is worth a failing build. A test stays when all three hold:

1. **The bug it catches is serious**: it would let someone into an account,
   leak a secret or bypass a limit; lose or corrupt data; or let a broken
   release deploy (a configuration the app must refuse, files that must stay
   in step).
2. **Nothing else catches it**: not another test, not the type checker.
3. **It is the one test for that behaviour**: one or two example inputs, not a
   table of them. Several checks of one behaviour go in one test.

Everything else is left out: examples, wording, trivial code (getters,
defaults, mappers, arithmetic), re-tests of libraries (Joi, class-validator,
camelcase-keys), "the handler passes the repository's error on", logging and
metrics details. A project built on this starter should keep the same bar: a
test that cannot name the serious bug it catches costs more to keep than it
saves.

## What is Testing?

**Tests are automated checks that verify your code works correctly.**

### Why Test?

Imagine building a house. Would you wait until it's fully built to see if the doors open?

```
Without Tests:
1. Write code
2. Deploy to production
3. User: "Login is broken!"
4. You: "Oh no, my change broke something"
5. Frantically fix at 2am

With Tests:
1. Write code
2. Run tests → ❌ Test failed: Login broken
3. Fix before deploy
4. Deploy confidently
5. Sleep well
```

---

## Types of Tests

### 1. Unit Tests (Most Common)
**What:** Test ONE function/method in isolation
**Speed:** Very fast (milliseconds)
**When to use:** Testing utility functions, business logic, calculations

```typescript
// Example: Testing a utility function
describe('parseIntSafe', () => {
    it('should parse valid number string', () => {
        expect(parseIntSafe('42', 0)).toBe(42)
    })
    
    it('should return default for undefined', () => {
        expect(parseIntSafe(undefined, 10)).toBe(10)
    })
})
```

**Analogy:** Testing if a single brick is solid

### 2. Integration Tests
**What:** Test multiple components working together
**Speed:** Medium (seconds)
**When to use:** Testing a service with its database, service + cache, etc.

```typescript
// Example: Testing a service with its dependencies
describe('UsersService', () => {
    it('should create a user in database', async () => {
        const user = await usersService.create({
            email: 'test@example.com',
            name: 'Test'
        })
        expect(user.id).toBeDefined()
    })
})
```

**Analogy:** Testing if the wall holds together (bricks + mortar)

### 3. E2E Tests (End-to-End)
**What:** Test the full system as a user would
**Speed:** Slow (seconds to minutes)
**When to use:** Testing complete user workflows, API endpoints

```typescript
// Example: Testing an API endpoint
describe('/api/v1/health (GET)', () => {
    it('should return 200 OK', () => {
        return request(app.getHttpServer())
            .get('/api/v1/health')
            .expect(200)
    })
})
```

**Analogy:** Testing if the entire house works (doors, plumbing, electricity)

### Testing Pyramid

```
        /\
       /  \      E2E Tests (Few)
      /----\       ↑ Slow, Expensive
     /      \
    /--------\   Integration Tests (Some)
   /          \    ↑ Medium Speed
  /------------\
 /              \ Unit Tests (Many)
/________________\  ↑ Fast, Cheap

Recommended Ratio:
- 70% Unit Tests
- 20% Integration Tests  
- 10% E2E Tests
```

---

## Key Concepts

### Mocking

**What:** Replacing real dependencies with fake ones

**Why:** 
- Don't want to hit real database in tests
- Don't want to send real emails
- Don't want to make real API calls
- Tests run faster and more reliably

```typescript
// Real code calls Prisma
const user = await prisma.user.findUnique({ where: { id } })

// In tests, we "mock" Prisma to return fake data
const mockPrisma = {
    user: {
        findUnique: jest.fn().mockResolvedValue({ id: 1, name: 'Test' })
    }
}
```

### AAA Pattern

Every test should follow **A**rrange → **A**ct → **A**ssert:

```typescript
it('should return user by ID', async () => {
    // ARRANGE - Set up test data and mocks
    const userId = 1
    const expectedUser = { id: 1, name: 'John' }
    mockPrisma.user.findUnique.mockResolvedValue(expectedUser)
    
    // ACT - Call the function being tested
    const result = await usersService.findById(userId)
    
    // ASSERT - Verify the result
    expect(result).toEqual(expectedUser)
})
```

### describe() and it()

```typescript
describe('UsersService', () => {           // Group: What we're testing
    describe('findById', () => {           // Sub-group: Which method
        it('should return user when found', () => {      // Test case
            // test code
        })
        
        it('should return null when not found', () => {  // Another case
            // test code
        })
    })
})
```

### beforeEach / afterEach

```typescript
describe('UsersService', () => {
    let service: UsersService

    beforeEach(() => {
        // Runs BEFORE each test - set up fresh state
        service = new UsersService()
    })

    afterEach(() => {
        // Runs AFTER each test - clean up
        jest.clearAllMocks()
    })

    it('test 1', () => { /* service is fresh here */ })
    it('test 2', () => { /* service is fresh here too */ })
})
```

---

## Quick Start

The project uses **pnpm** (`packageManager` in `package.json`), not npm.

```bash
# Run all unit tests (src/**/*.spec.ts; need nothing running)
pnpm test

# Run tests in watch mode (re-runs on file changes)
pnpm test:watch

# Run tests with coverage report
pnpm test:cov

# Run E2E tests (need nothing running)
pnpm test:e2e

# Run integration tests (need Postgres, Redis, RustFS and Mailpit)
pnpm test:services:up
pnpm test:integration
pnpm test:integration -- auth      # only the suites whose file name matches

# Stop the test-only containers (RustFS) afterwards; db, redis and mailpit are
# the dev stack's own and keep running
pnpm test:services:down

# Debug tests
pnpm test:debug
```

`pnpm test:services:up` starts five containers from `docker-compose.dev.yaml`,
with the `testing` profile: `db` (Postgres), `redis`, `rustfs` (an
S3-compatible store), `rustfs-buckets` (a one-off that creates the bucket) and
`mailpit` (an SMTP server that catches mail and shows it at
`http://localhost:8025`). It reads `.env.development`, so make that file first
([setup/prepare-for-development.md](./setup/prepare-for-development.md)).

### E2E vs integration

The `test/` directory holds two kinds of suites, each in its own folder:

| Folder | Needs | Command |
|---|---|---|
| `test/e2e/` | Nothing but Node | `test:e2e` |
| `test/integration/` | Real backing services | `test:integration` |

**The folder is what selects.** Create a new suite in the folder that matches what it needs and it runs under the right command automatically — there is no exclusion list to keep in sync. The `.e2e-spec.ts` / `.integration-spec.ts` suffixes are kept so a filename reads clearly on its own, but any `*-spec.ts` inside a folder runs with that folder's command.

Integration suites use **stand-ins, not your real providers**: RustFS speaks the S3 API, Mailpit speaks SMTP, a fake OpenID Connect provider (`test/integration/fake-oidc-issuer.ts`) plays Google. So the storage, email and sign-in code runs for real without cost, secrets, or sending actual mail. That holds regardless of what production uses (AWS, R2, Brevo, Postmark, ...).

If a service is not running, `test:integration` stops immediately and names the missing one, rather than letting each suite time out.

`test:integration` runs Jest twice (`test/run-integration.cjs`): the S3 suite with Node's `--experimental-vm-modules`, which the AWS SDK needs, and every other suite without it, because with it Jest cannot load ESM-only packages such as `jose` on Node 22. Arguments reach both runs, so `pnpm test:integration -- auth` still picks suites by name.

The auth suites are the ones to read first: `auth.integration-spec.ts` (row locks, concurrent refreshes and code guesses, the session cache) and `auth-http.integration-spec.ts` (the whole app over HTTP, sign-up to sign-out, codes read from Mailpit). Every suite is listed [below](#integration-tests).

### In CI

The GitHub Actions workflow runs every suite on every push, the integration suite against the same services `pnpm test:services:up` starts ([ci.md](./ci.md)). Nothing is skipped — a skipped integration suite would let CI pass without testing anything. Every connection target is overridable through `TEST_*` variables (`TEST_REDIS_HOST`, `TEST_REDIS_PORT`, `TEST_S3_ENDPOINT`, `TEST_SMTP_HOST`, `TEST_SMTP_PORT`, `TEST_MAILPIT_API`, ...), for a CI whose services have other hostnames.

---

## The Suites in This Starter

### Unit tests

`pnpm test` runs every `*.spec.ts` under `src/`, about 70 tests, in a few
seconds. They need nothing running: ports are replaced by fakes. Jest compiles
without type-checking (`isolatedModules` in `test/esm-transform.js`):
`pnpm exec tsc --noEmit`, lint and CI check the types.

| Area | Suites (next to the code they test) |
|---|---|
| Auth commands | one file per area, sharing the in-memory fakes of [auth-test-world.shared-spec.ts](../src/modules/auth/application/commands/auth-test-world.shared-spec.ts): `sign-up-and-confirm`, `sessions` (sign-in limits, refresh, sign out everywhere), `passwords`, `google`, `delete-account` |
| Auth building blocks | `limits.spec.ts` (guesses counted before they are checked), `password-policy.spec.ts`, `jose-token-service.adapter.spec.ts` (a token for another audience, issuer, or past its lifetime is refused) |
| Users | `upload-avatar` (no orphaned file), `sweep-deleted-accounts` |
| Shared | the roles guard, 5xx answers that leak nothing, URL redaction in logs, the queue failure reporter (no job data), image-processing limits, S3 errors kept out of answers, stored file extensions, IPv6 /64, the verification code generator, unique error codes |
| Configuration | env validation (production refusals) and `env:check` (files in step), pino and Sentry redaction, image versions, compose healthchecks, monitoring files |

### E2E tests

`pnpm test:e2e` runs `test/e2e/`. Each suite builds a small Nest app around
one controller or feature, with the real pipes, filters and interceptors and
fake buses or ports, and calls it over HTTP with `supertest`. Nothing needs
to be running.

| Suite | What it checks |
|---|---|
| `openapi-contract` | users responses match the committed `openapi.json`, which the web app's types are generated from ([openapi.md](./openapi.md)) |
| `exception-filter` | a server error answers without its detail |
| `idempotency-replay` | `@Idempotent`: another user's key never replays my answer; the same key with another body is refused ([idempotency.md](./idempotency.md)) |
| `health` | dependency errors stay out of `/health` in production |
| `operational-endpoints` | the API docs behind basic auth in production |

**How an e2e test fakes a signed-in user.** There is no token in these
suites: a small middleware puts the user on the request, as the access-token
guard would (as `openapi-contract.e2e-spec.ts` does):

```typescript
app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { id: 'user-1' }
    next()
})
```

Real tokens and the real guard are tested in the integration suites below.

### Integration tests

`pnpm test:integration` runs `test/integration/` against real services (start
them with `pnpm test:services:up`). One worker at a time, since the suites
share the services.

| Suite | Needs | What it checks |
|---|---|---|
| `auth` | Postgres, Redis | what only real services can prove: one refresh rotation wins under concurrency (the row lock), reuse after the replacement was used ends the session, codes guessed at once all count, a revoked session or deleted account is refused at once even when cached |
| `auth-http` | Postgres, Redis, Mailpit | the whole app over HTTP: sign-up, confirming with the sign-up password, sign-in, refresh from the web app only, sign-out; an IPv6 client counted by its /64 |
| `oauth-http` | Postgres, Redis, Mailpit | Google sign-in against the fake OpenID Connect provider (`fake-oidc-issuer.ts`): a valid ID token signs in; one for another sign-in, another app, or signed with an unknown key is refused |
| `account-lifecycle` | Postgres, Redis | concurrent avatar swaps and deletions; the sweep removes only never-confirmed sign-ups (upgraded users without a password stay) |
| `rate-limiter` | Redis | exactly `limit` hits pass when many arrive at once |
| `s3-storage` | RustFS | a private bucket refuses an unsigned URL and serves a signed one |

Shared setup (Mailpit polling, booting the app) is in
[test/integration/helpers.ts](../test/integration/helpers.ts).

The manual checks that no suite can make (real Google, real SMTP) and how the
auth tests are built are in [in-the-code.md](./auth/in-the-code.md).

## Test Structure

```
├── src/
│   └── **/*.spec.ts                 # Unit tests (next to source files)
├── test/
│   ├── setup.ts                     # Shared test environment setup
│   ├── jest-e2e.config.js           # Config for test/e2e/
│   ├── jest-integration.config.js   # Config for test/integration/
│   ├── e2e/
│   │   └── *.e2e-spec.ts            # Self-contained, need nothing running
│   └── integration/
│       ├── global-setup.ts          # Fails fast if a service is unreachable
│       ├── fake-oidc-issuer.ts      # A stand-in for Google's OpenID Connect
│       ├── targets.ts               # Service addresses, overridable with TEST_*
│       └── *.integration-spec.ts    # Need Postgres / Redis / RustFS / Mailpit
├── scripts/
│   └── idempotency-race.ts          # Manual tools — not run by any test command
├── jest.config.js                   # Unit test configuration
└── coverage/                        # Coverage reports (generated)
```

---

## Testing in Hexagonal Architecture

Hexagonal architecture makes testing easy because **business logic has zero infrastructure dependencies**. Command handlers, event handlers, and query handlers only depend on port interfaces — which are trivially mockable.

### What to Test Per Layer

| Layer | What to Test | How | Priority |
|---|---|---|---|
| **Domain** | Entity constructors, getters, business rules | Pure unit tests (no mocks) | 🟡 Medium |
| **Application** | Command/Query/Event handlers | Mock ports + EventBus | 🔴 **High** |
| **Infrastructure** | Mappers, complex adapters | Unit test mappers; integration test repos | 🔴 **High** (mappers) |
| **Presentation** | Exception filters, controllers | Mock CommandBus/QueryBus | 🟡 Medium |

### What NOT to Test

- **Port interfaces** — Just TypeScript types, nothing to execute
- **Command/Query/Event data classes** — Pure data carriers, no logic
- **Simple domain exceptions** — Trivial `extends Error` classes
- **Thin adapters** — Adapters that just delegate to a shared service (e.g., `UploadStorage`, which passes calls on to `UploadService`)

### The Port Mocking Pattern

This is the core pattern for every handler test. Instead of mocking Prisma or Redis directly, you mock the **port interface**:

```typescript
// 1. Create mock objects matching the port interface
const mockUserRepo = {
    findById: jest.fn(),
    setUsernameIfUnset: jest.fn(),
}

// 2. Provide them using the port injection token
const module = await Test.createTestingModule({
    providers: [
        SetUsernameHandler,
        { provide: USER_REPOSITORY, useValue: mockUserRepo },   // ← Port mock
        { provide: EventBus, useValue: { publish: jest.fn() } },     // ← CQRS mock
    ],
}).compile()

// 3. Control behavior per test
mockUserRepo.findById.mockResolvedValue(someUserEntity)
mockUserRepo.setUsernameIfUnset.mockResolvedValue(updatedUserEntity)
```

**Why this works:** The handler only knows about `UserRepositoryPort` — it never imports Prisma, Redis, or any framework. Swapping the real adapter for a mock is seamless.

### Testing Event Publishing

Command handlers often publish domain events. Verify them by mocking `EventBus`:

```typescript
const mockEventBus = { publish: jest.fn() }

// After executing the command...
expect(mockEventBus.publish).toHaveBeenCalledWith(
    new UserProfileUpdatedEvent(userId)
)
```

For event handlers that **receive** events, test them directly. For example
the auth module's `RefreshCachedUserHandler`
([`events/handlers/`](../src/modules/auth/application/events/handlers/)),
which drops the cached user when the users module says the profile changed:

```typescript
const mockCache = { invalidateUser: jest.fn() }
const handler = new RefreshCachedUserHandler(mockCache as unknown as SessionCachePort)

await handler.handle(new UserProfileUpdatedEvent('user-123'))

expect(mockCache.invalidateUser).toHaveBeenCalledWith('user-123')
```

### Test File Locations

Tests live **next to the source file** they test:

```
modules/
├── auth/domain/
│   ├── password-policy.ts
│   └── password-policy.spec.ts          ← Domain test
├── auth/infrastructure/
│   ├── aes-secret-box.adapter.ts
│   └── aes-secret-box.adapter.spec.ts           ← Adapter test
└── users/application/commands/upload-avatar/
    ├── upload-avatar.handler.ts
    └── upload-avatar.handler.spec.ts    ← Handler test
```

Domain errors have no per-module filter: one shared `DomainExceptionFilter`
([`domain-exception.filter.ts`](../src/shared/presentation/filters/domain-exception.filter.ts))
maps every module's errors to HTTP.

---

## Writing Tests

### Unit Test Example

```typescript
// src/shared/utils/example.util.spec.ts
import { myFunction } from './example.util'

describe('example.util', () => {
    describe('myFunction', () => {
        it('should return expected value', () => {
            const result = myFunction('input')
            expect(result).toBe('expected')
        })
    })
})
```

### Command Handler Test Example (with port mocking)

The pattern, for a handler whose bug would matter (here: two concurrent
claims of a username must not both win):

```typescript
import { Test, TestingModule } from '@nestjs/testing'
import { EventBus } from '@nestjs/cqrs'
import { SetUsernameHandler } from './set-username.handler'
import { SetUsernameCommand } from './set-username.command'
import { USER_REPOSITORY, UserEntity } from '@/modules/users/domain'
import { UserProfileUpdatedEvent } from '../../events/user-profile-updated.event'

describe('SetUsernameHandler', () => {
    let handler: SetUsernameHandler
    let mockUserRepo: { findById: jest.Mock; setUsernameIfUnset: jest.Mock }
    let mockEventBus: { publish: jest.Mock }

    beforeEach(async () => {
        mockUserRepo = { findById: jest.fn(), setUsernameIfUnset: jest.fn() }
        mockEventBus = { publish: jest.fn() }

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SetUsernameHandler,
                { provide: USER_REPOSITORY, useValue: mockUserRepo },
                { provide: EventBus, useValue: mockEventBus }
            ]
        }).compile()

        handler = module.get(SetUsernameHandler)
    })

    it('sets the username and publishes an event', async () => {
        const existing = new UserEntity({ id: 'user-123', hasSetUsername: false })
        const updated = new UserEntity({ id: 'user-123', username: 'johndoe', hasSetUsername: true })
        mockUserRepo.findById.mockResolvedValue(existing)
        mockUserRepo.setUsernameIfUnset.mockResolvedValue(updated)

        const result = await handler.execute(new SetUsernameCommand('user-123', 'johndoe'))

        // One conditional write, not read-then-write: two concurrent claims cannot both win.
        expect(mockUserRepo.setUsernameIfUnset).toHaveBeenCalledWith('user-123', 'johndoe')
        expect(mockEventBus.publish).toHaveBeenCalledWith(new UserProfileUpdatedEvent('user-123'))
        expect(result).toEqual(updated)
    })
})
```

### E2E Test Example

An e2e suite must need nothing running, so it does **not** import the whole
`AppModule` (that would connect to Postgres and Redis). It builds a module
around one controller, with fake buses and ports, as
`openapi-contract.e2e-spec.ts` does:

```typescript
// test/e2e/example.e2e-spec.ts
import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import request from 'supertest'
import { UsersController } from '@/modules/users/presentation/http/users.controller'
import { STORAGE } from '@/modules/users/application/ports/storage.port'
import { SnakeToCamelPipe, createValidationPipe } from '@/shared/presentation/pipes'

describe('Users (e2e)', () => {
    let app: INestApplication
    const commandBus = { execute: jest.fn() }
    const queryBus = { execute: jest.fn().mockResolvedValue(true) }

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            controllers: [UsersController],
            providers: [
                { provide: CommandBus, useValue: commandBus },
                { provide: QueryBus, useValue: queryBus },
                { provide: ConfigService, useValue: { get: () => 'http://localhost:8888' } },
                { provide: STORAGE, useValue: { getReadUrl: async (key: string) => key } }
            ]
        }).compile()

        app = moduleRef.createNestApplication()
        // What the access-token guard would attach: a signed-in user.
        app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
            req.user = { id: 'user-1', email: 'ada@example.com' }
            next()
        })
        // The same global pipes main.ts uses: snake_case in, validation.
        app.useGlobalPipes(new SnakeToCamelPipe(), createValidationPipe())
        await app.init()
    })

    afterAll(async () => {
        await app.close()
    })

    it('checks the normalised form of a valid username', async () => {
        // No global prefix in this small app: the real API serves it under /api/v1.
        await request(app.getHttpServer()).get('/users/username-available/Alice_1').expect(200)

        const [query] = queryBus.execute.mock.calls[0]
        expect(query.username).toBe('alice_1')
    })
})
```

To test with real tokens and the real guard, write an integration suite
instead: `auth-http.integration-spec.ts` builds the whole `AppModule` against
the test services.

---

## Common Jest Matchers

```typescript
// Equality
expect(value).toBe(5)                    // Strict equality (===)
expect(value).toEqual({ a: 1 })          // Deep equality for objects
expect(value).not.toBe(5)                // Negation

// Truthiness
expect(value).toBeTruthy()
expect(value).toBeFalsy()
expect(value).toBeNull()
expect(value).toBeUndefined()
expect(value).toBeDefined()

// Numbers
expect(value).toBeGreaterThan(3)
expect(value).toBeLessThan(5)
expect(value).toBeCloseTo(0.3, 1)        // Floating point

// Strings
expect(value).toMatch(/pattern/)
expect(value).toContain('substring')

// Arrays
expect(array).toContain('item')
expect(array).toHaveLength(3)

// Objects
expect(obj).toHaveProperty('key')
expect(obj).toHaveProperty('key', 'value')

// Exceptions
expect(() => fn()).toThrow()
expect(() => fn()).toThrow('error message')

// Async
await expect(promise).resolves.toBe(5)
await expect(promise).rejects.toThrow()
```

---

## Code Coverage

Run with coverage:

```bash
pnpm test:cov
```

Coverage report is generated in `./coverage/` directory. Open `coverage/lcov-report/index.html` in a browser to see detailed report.

**Target Coverage:** 60-80% is usually sufficient for most projects.

---

## Best Practices

1. **Test behavior, not implementation** - Focus on what the function does, not how
2. **One assertion per test** - Makes failures easier to debug
3. **Use descriptive test names** - `it('should return null when user not found')`
4. **AAA Pattern** - Arrange, Act, Assert
5. **Mock external dependencies** - Database, HTTP calls, etc.
6. **Keep tests fast** - Unit tests should run in milliseconds
7. **Don't test framework code** - Trust that NestJS, Prisma work correctly

---

## Troubleshooting

### "Reflect.getMetadata is not a function"
Ensure `reflect-metadata` is imported in `test/setup.ts`

### Tests timing out
Increase `testTimeout` in `jest.config.js` or use `jest.setTimeout()` in tests

### Module not found errors
Check `moduleNameMapper` in `jest.config.js` matches your `tsconfig.json` paths

---

## What this page does not cover

These tests check that the code is correct. They say nothing about how much
traffic it can take, which is a different question with different tools — see
[load-testing.md](./load-testing.md).
