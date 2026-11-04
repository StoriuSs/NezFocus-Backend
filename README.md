<div align="center">

# NestJS Backend Starter

A production-ready NestJS backend template with its own authentication,
Prisma ORM, distributed caching, rate limiting and a full operational half,
designed to be scalable, observable and easy to extend.

[![Node.js](https://img.shields.io/badge/Node.js-≥22.0.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![Prometheus](https://img.shields.io/badge/Prometheus-E6522C?logo=prometheus&logoColor=white)](https://prometheus.io/)
[![Grafana](https://img.shields.io/badge/Grafana-F46800?logo=grafana&logoColor=white)](https://grafana.com/)
[![Swagger](https://img.shields.io/badge/Swagger-85EA2D?logo=swagger&logoColor=black)](https://swagger.io/)

</div>

---

## Start here

Pick the path that matches what you want right now:

| You want to | Read |
| --- | --- |
| Understand what is in this repository and how it fits together | **[The tour](OVERVIEW.md)**: one page, about fifteen minutes |
| Get it running on your machine with an account you can sign in to | **[GETTING_STARTED.md](GETTING_STARTED.md)**: about ten minutes |
| The full guided setup for development: optional services, the web app | [docs/setup/prepare-for-development.md](docs/setup/prepare-for-development.md) |
| Put it on a server for real users | [docs/setup/prepare-for-production.md](docs/setup/prepare-for-production.md), then [docs/deployment-guide.md](docs/deployment-guide.md) |
| Understand or change sign-in, sessions, Google, two-step sign-in | [docs/auth/README.md](docs/auth/README.md) |
| Get the keys for an outside service (email, Google, Cloudflare, S3, Sentry, ...) | [docs/setup/README.md](docs/setup/README.md) |

---

## Table of Contents

- [Start here](#start-here)
- [Quickstart](#quickstart)
- [Why This Template?](#why-this-template)
- [Features](#features)
- [Authentication](#authentication)
- [Running Locally](#running-locally)
- [Project Structure](#project-structure)
- [Architecture Overview](#architecture-overview)
- [Documentation](#documentation)
- [Production Checklist](#production-checklist)
- [Contributing](#contributing)

---

## Quickstart

### Prerequisites

- Node.js ≥ 22 (`.nvmrc` names the exact version)
- pnpm (`corepack enable`, which takes the version from `package.json`)
- Docker Desktop or Docker Engine 25+, which runs Postgres, Redis and
  everything else

```bash
pnpm install
cp .env.example .env.development   # runs as it is; see GETTING_STARTED.md for what to change

# The whole stack: the app, Postgres, Redis, Mailpit,
# and the monitoring services
pnpm docker:dev
```

The app container applies the migrations and starts with hot reload.

To run the app on your machine instead of in Docker, it still needs its
backing services. Start them with Docker and leave the app out:

```bash
pnpm test:services:up   # Postgres, Redis, RustFS and Mailpit
pnpm prisma:generate    # the database client, into generated/
pnpm prisma:migrate     # uses DATABASE_URL, which must match DB_USERNAME/DB_PASSWORD/DB_NAME
pnpm dev
```

[GETTING_STARTED.md](./GETTING_STARTED.md) walks through the same steps with
more explanation, and signs you up for a first account.

Then open:

- API Docs (Swagger UI): `http://localhost:8888/api-docs`
- Health Checks: `http://localhost:8888/api/v1/health`
- Mailpit (every email the app sends, sign-up codes included): `http://localhost:8025`
- Grafana (Monitoring): `http://localhost:3002` (admin / `GRAFANA_ADMIN_PASSWORD`)
- Prometheus: `http://localhost:9090`

These are the `.env.example` defaults: `PORT`, `GRAFANA_PORT`,
`PROMETHEUS_PORT`. Port 3001 is left for the web app's development server
(the [React starter](https://github.com/StoriuSs/React-Starter-No-Keycloak)).

---

## Why This Template?

`nest new` gives you a web framework. Everything between that and a service
you would trust on a Friday afternoon (authentication, rate limiting,
migrations, health checks, backups, alerting, deploys that roll themselves
back) is the part that takes months, and it is the part that is already here.

- **Strong defaults**: security, logging, configuration validated at boot
- **Sign-in you own**: email and password, Google, two-step sign-in, written
  into the app rather than run as a separate identity server
- **An architecture that survives growth**: hexagonal layers and CQRS, with
  two worked modules to copy (`users`, and the larger `auth`)
- **Observability**: Prometheus metrics, Loki logs, Grafana dashboards,
  alerts that have been tested by breaking things
- **Ready to ship**: CI, a published image, one-command deploys with
  automatic rollback, and backups that have been restored
- **Documented**: around seventy pages in `docs/`, with a test that fails if a
  link between them breaks

[The tour](OVERVIEW.md) covers all of it properly, including the
decisions behind it and an honest list of what this starter is *not* for.

---

## Features

| Feature | Description |
|---|---|
| **Hexagonal Architecture** | Ports and adapters: business rules never import Prisma, Redis or HTTP |
| **CQRS** | One small handler per command and query, via `@nestjs/cqrs` |
| **Authentication** | Email and password, emailed codes, refresh-cookie sessions, Google, two-step sign-in, Turnstile. [See below](#authentication) |
| **Two-Level Caching** | In-memory LRU + Redis distributed cache |
| **Rate Limiting** | A global per-IP, per-route limit in Redis, plus per-address, per-IP and per-account limits on the sign-in routes |
| **Database** | PostgreSQL with Prisma ORM + soft delete |
| **File Uploads** | Local + S3 storage with Sharp image processing |
| **Health Checks** | Terminus-based liveness, readiness and full checks (DB, Redis, throttler) |
| **Metrics & Logs** | Prometheus + Grafana + Loki, self-hosted or Grafana Cloud |
| **Structured Logging** | Pino with JSON output, request ids, secrets redacted |
| **API Documentation** | OpenAPI 3.0 with Swagger UI, committed and checked in CI |
| **Security** | Helmet, CORS, validation pipes, strict production settings |
| **Graceful Shutdown** | In-flight requests finish, connections close in order |
| **Idempotency** | Request deduplication for POST/PATCH |
| **Email** | Transactional emails over plain SMTP, Handlebars templates, sent from a queue |

---

## Authentication

The `auth` module (`src/modules/auth/`) is a complete, self-hosted sign-in
system. No identity server runs beside the app.

- **Email and password.** Passwords hashed with Argon2id, checked against a
  policy and a list of common passwords. Sign-up is confirmed with a 6-digit
  emailed code; forgot-password works the same way.
- **Sessions.** A short access token (15 minutes, sent as
  `Authorization: Bearer`) and a refresh token in an `httpOnly` cookie that
  only the API can read. Each refresh replaces the cookie; a stolen one used
  twice ends the session. Signing out, or deleting the account, takes effect
  on the very next request.
- **Sign in with Google** (OpenID Connect with PKCE), linking to an existing
  account by verified email. Off until you set two keys.
- **Two-step sign-in** with an authenticator app (TOTP) and ten one-time
  recovery codes, with the secrets encrypted at rest.
- **Cloudflare Turnstile** on sign-up, forgot-password, and sign-in after
  repeated failures. Off until you set two keys.
- **Rate limits** per address, per IP and per account on every sign-in route,
  with `Retry-After` and a reason the web app can show.
- **Account deletion with proof** (password or emailed code, plus the two-step
  code when it is on), and a notice email for every security change.
- **Command-line tools** for operators: `pnpm user:promote` (roles),
  `pnpm auth:rotate-key` (change the encryption key), `pnpm auth:two-factor:off`
  (a user who lost their phone).

Start at **[docs/auth/README.md](docs/auth/README.md)**: it explains the
concepts, every flow, the exact rules, and how to run it in production. The
paired [React starter](https://github.com/StoriuSs/React-Starter-No-Keycloak)
has every screen.

---

## Running Locally

### Database Setup

```bash
# Start Postgres, Redis, RustFS and Mailpit on their own
pnpm test:services:up

# Generate Prisma client
pnpm prisma:generate

# Apply migrations
pnpm prisma:migrate

# Seed database (optional: example users nobody can sign in as)
pnpm prisma:seed
```

### Running the Application

```bash
# Everything in Docker, with hot reload
pnpm docker:dev

# Or the app on this machine, against the services above
pnpm dev

# Production build
pnpm build
pnpm start:prod
```

### Running Tests

```bash
# Unit tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage report
pnpm test:cov

# E2E tests
pnpm test:e2e

# Integration tests, against real Postgres, Redis, RustFS and Mailpit
pnpm test:services:up
pnpm test:integration
```

---

## Project Structure

```
src/
├── bootstrap/                       # Command-line scripts: env check, OpenAPI export,
│                                    # user:promote, auth:rotate-key, auth:two-factor:off, ...
├── config/                          # App-wide configuration + the Joi schema (validation.ts)
│   ├── auth.config.ts
│   ├── database.config.ts
│   └── ...                          # cache, cors, email, throttle, upload, ...
├── modules/                         # Feature modules (Hexagonal Architecture)
│   ├── auth/                        # Sign-up, sign-in, sessions, Google, two-step, Turnstile
│   │   ├── domain/                  # Errors, password policy, recovery codes
│   │   ├── application/             # Commands, ports, services, rate limits
│   │   ├── infrastructure/          # Argon2, JWT, OIDC, TOTP, AES, Turnstile, Prisma, Redis, BullMQ
│   │   ├── presentation/            # Controller, DTOs, access-token guard, email consumer
│   │   └── auth.module.ts           # Port → Adapter wiring
│   └── users/                       # Profiles, usernames, avatars, account deletion
│       ├── domain/                  # Entities, exceptions, repository ports
│       ├── application/             # Commands, queries, events, service ports
│       ├── infrastructure/          # Prisma repository, storage/queue adapters
│       ├── presentation/            # HTTP controllers, DTOs, consumers
│       └── users.module.ts          # Port → Adapter wiring
├── shared/                          # Cross-cutting shared code
│   ├── infrastructure/              # Decorators and RolesGuard, cache, email, queue,
│   │                                # rate limiter, storage, Prisma, monitoring
│   ├── presentation/                # Interceptors, pipes, filters, decorators
│   ├── domain/                      # DomainError, the base of every module's errors
│   ├── constants/                   # Response codes, messages
│   ├── types/                       # Shared type definitions
│   └── utils/                       # Pagination, validation helpers
├── health/                          # Health check endpoints
├── app.module.ts                    # Root application module
└── main.ts                          # Application entry point
```

---

## Architecture Overview

This project uses **Hexagonal Architecture (Ports & Adapters)** with **CQRS**. Business logic is isolated from infrastructure through port interfaces, with adapters plugged in via dependency injection.

See [Hexagonal Architecture Guide](docs/hexagonal-architecture.md) and [CQRS Guide](docs/cqrs-guide.md) for full details.

### Why This Architecture?

- **Swappable infrastructure**: change databases, caches, or storage by replacing one adapter
- **Testability**: mock port interfaces without spinning up real services
- **Clear boundaries**: domain logic has zero imports from NestJS, Prisma, or any framework
- **CQRS**: separate read/write paths for scalable, maintainable use cases

### Where to Look

| If you want to... | Look in... |
|---|---|
| Change database connection | `src/config/database.config.ts` |
| Modify cache behavior | `src/config/cache.config.ts` |
| Adjust the global rate limit | `src/config/throttle.config.ts` (`THROTTLE_*`) |
| Adjust the sign-in limits | `src/modules/auth/application/rate-limits.ts` |
| Configure authentication | `src/config/auth.config.ts` and `src/modules/auth/` ([docs/auth/](docs/auth/README.md)) |
| Protect a route or require a role | `@Public()`, `@Roles()` in `src/shared/presentation/decorators/` |
| Add file upload options | `src/shared/infrastructure/storage/` |
| Add health checks | `src/health/health.controller.ts` |
| Add a new feature module | Create in `src/modules/` with hexagonal layers ([docs/adding-a-module.md](docs/adding-a-module.md)) |
| Understand the architecture | `docs/hexagonal-architecture.md` |

---

## Documentation

Comprehensive documentation is available in the `docs/` folder:

| Document | Description |
|----------|-------------|
| **[The tour](OVERVIEW.md)** | **Start here: the whole starter in one page** |
| [Getting started](GETTING_STARTED.md) | A fresh clone to a running API and a first account |
| [Setup guides](docs/setup/README.md) | Every outside service, step by step: email, Google, Turnstile, S3, Sentry, alerts, GitHub, DNS |
| [Prepare for development](docs/setup/prepare-for-development.md) | The full guided setup on your machine |
| [Prepare for production](docs/setup/prepare-for-production.md) | The full guided setup for a first deploy |
| [Authentication](docs/auth/README.md) | Sign-up, sign-in, sessions, Google, two-step sign-in, limits: how it works and why |
| [Hexagonal Architecture](docs/hexagonal-architecture.md) | Ports & Adapters architecture guide |
| [CQRS Guide](docs/cqrs-guide.md) | Command/Query separation patterns |
| [Environment](docs/environment.md) | Every setting: required, default, what it does |
| [Cache](docs/cache.md) | Two-layer caching architecture |
| [Rate Limiting](docs/rate-limit.md) | Distributed throttling |
| [Response envelope](docs/BACKEND_RESPONSE_HANDLING.md) | The shape of every answer, and every code |
| [Monitoring](docs/monitoring.md) | Prometheus metrics & Grafana dashboards |
| [Alerts](docs/alerts.md) | Alert rules, Discord notifications, how alerting works |
| [External monitoring](docs/external-monitoring.md) | Uptime check and heartbeat: the difference, services, setup |
| [Error tracking](docs/error-tracking.md) | Sentry (optional): what is reported, privacy, setup |
| [Logging](docs/logging.md) | Loki log aggregation & querying |
| [Graceful Shutdown](docs/graceful-shutdown.md) | Zero-downtime deployments |
| [Type Safety](docs/type-safety.md) | Type-safe selects and DTOs |
| [Making it yours](docs/making-it-yours.md) | What to rename when you start a project from this |
| [Adding a module](docs/adding-a-module.md) | Building a feature, layer by layer |
| [Testing](docs/testing.md) | Unit, integration, E2E testing |
| [Going to production](docs/deployment-guide.md) | Start here when you want it on the internet: the route through the rest |
| [Load testing](docs/load-testing.md) | k6 scripts: how much traffic it takes, and what breaks first |
| [CI](docs/ci.md) | GitHub Actions: what runs, the published image, fixing a failure |
| [Deploy](docs/deploy.md) | Releases, rollback, the Deploy button, build or registry images |
| [Preparing a server](docs/server.md) | Security updates, fail2ban, swap, SSH, the firewall |
| [Backups](docs/backups.md) | Nightly dumps, off-server copies, restoring |
| [Scaling](docs/scaling.md) | Moving services off the box, and running more than one instance |
| [Extensions](docs/extensions.md) | Audit log, feature flags, tracing, outbox: what they are and when you need them |
| [Renovate](docs/renovate.md) | Dependency update pull requests: the weekly routine, major versions, the rules |
| [Upload Module](docs/upload-module.md) | File storage & image processing |
| [Idempotency](docs/idempotency.md) | Request deduplication |
| [Account deletion](docs/account-deletion.md) | Soft delete, data retention, and what happens to the username |
| [BullMQ Guide](docs/BULLMQ-GUIDE.md) | Background job processing |
| [Lessons](docs/LESSONS.md) | What broke on the first production deploy, and what changed |

---

## Production Checklist

The checklist lives in one place, so it cannot drift:

- **[docs/setup/prepare-for-production.md](docs/setup/prepare-for-production.md)**:
  the ordered walkthrough, from buying a domain to the checks after the first
  deploy, including every outside service and every secret to generate.
- **[docs/deployment-guide.md](docs/deployment-guide.md#the-checklist)**: the
  checklist to tick on the day: the environment file, authentication, the
  server, and the four things to verify before you call it done.
- **[docs/auth/operations.md](docs/auth/operations.md)**: running sign-in in
  production, and what to do when it breaks.

Before any of it: `pnpm env:check .env.production` applies every rule the app
applies at boot.

---

## Contributing

PRs and issues are welcome.

Guidelines:

- Keep infrastructure modules isolated and configurable
- Add health indicators when introducing new dependencies
- Include tests for new behavior
- Ensure linting and tests pass before submitting

---

## License

MIT
