# syntax=docker/dockerfile:1.10
# ============================================================================
# Multi-Stage Dockerfile for NestJS Hexagonal Architecture
# ============================================================================
# Stages:
#   1. base        — Shared Node.js base with common system deps
#   2. deps        — Install ALL npm dependencies (dev + prod)
#   3. build       — Compile TypeScript and generate Prisma client
#   4. dev         — Development image (hot-reload, debugging, full deps)
#   5. runtime     — The production image's contents (minimal, distroless-like)
#   6. prod        — runtime with Alpine's latest fixes: the image that ships
#
# Usage:
#   Dev:   docker build --target dev  -t nestapp:dev .
#   Prod:  docker build --target prod -t nestapp:prod .
# ============================================================================

# ----- STAGE 1: BASE -----
# Shared base with system-level dependencies needed by native modules (sharp, prisma)
FROM node:22.23.2-alpine AS base

# Alpine's security fixes first: the node image is built from the packages of
# its day, so a fix published since (musl, zlib…) is missing until the next
# node release, and CI's Trivy scan fails on it. Every stage starts from here.
# CI takes this layer from its build cache while the node image stays the
# same, so the final `prod` stage upgrades again, never from the cache.
# Required by sharp (image processing) and Prisma
RUN apk upgrade --no-cache && apk add --no-cache \
    libc6-compat \
    openssl

# The Prisma CLI (migrate deploy at container start and in deploy.sh, generate)
# otherwise calls Prisma's servers on every run for telemetry and an update
# check, and prints a ten-line "Update available" box into the app's logs.
ENV CHECKPOINT_DISABLE=1

# Enable pnpm via corepack. The actual pnpm version is pinned in package.json
# via the `packageManager` field — corepack reads it from the working dir's
# package.json at first pnpm invocation. Keeping host and container on the
# SAME pnpm version is non-negotiable: install-script gating (and the
# pnpm-workspace.yaml schema for it) changed between v10 and v11. Mismatched
# versions cause silent ERR_PNPM_IGNORED_BUILDS failures that look like
# Prisma / sharp issues until you dig in.
RUN corepack enable

# pnpm keeps downloaded packages in a store. The deps stage mounts it as a
# BuildKit cache, so after a lockfile change only the changed packages are
# downloaded again. Set for every pnpm command, not per install: pnpm refuses
# to reuse node_modules installed from a different store, and the dev
# container may install again.
ENV npm_config_store_dir=/pnpm/store

WORKDIR /app

# ----- STAGE 2: DEPENDENCIES -----
# Install every package, dependencies and devDependencies (TypeScript, the
# Nest CLI, Jest…), for the build and dev stages. The prod stage doesn't use
# this stage: it installs only `dependencies` itself.
FROM base AS deps

# Copy package files first for layer caching.
# pnpm-workspace.yaml carries `onlyBuiltDependencies` — the allowlist of
# packages permitted to run install scripts. .npmrc carries pnpm CLI defaults.
# All four files must be present BEFORE `pnpm install` for the allowlist to
# take effect.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY scripts/dev-start.sh ./scripts/

# Install ALL dependencies (need devDependencies for building).
# --ignore-scripts: install scripts need files this stage doesn't have yet
# (Prisma's need the schema and prisma.config.ts). The build stage only
# compiles, and the dev image needs none of them: sharp and msgpackr-extract
# ship prebuilt binaries, and the Prisma CLI fetches its engines on first use.
# The prod stage runs them during its own install.
# `dev-start.sh --record` notes what this installed, so the dev container
# installs again only when package.json, the lockfile or pnpm's settings
# changed.
RUN --mount=type=cache,id=nest-starter-pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --ignore-scripts \
    && sh scripts/dev-start.sh --record

# ----- STAGE 3: BUILD -----
# Compile TypeScript → JavaScript, generate Prisma client
FROM deps AS build

# Copy source code and config files needed for build
COPY src ./src
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY tsconfig.json tsconfig.build.json nest-cli.json ./

# Generate Prisma client
RUN DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy pnpm exec prisma generate

# Build the NestJS application
RUN pnpm run build

# ----- STAGE 4: DEVELOPMENT -----
# Full development environment with hot-reload, debugging, and all tools
FROM deps AS dev

# Copy everything needed for development
COPY . .

# Generate Prisma client for development
RUN DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy pnpm exec prisma generate

# Expose app port + debug port
EXPOSE 3000 9229

# Start with hot-reload
CMD ["pnpm", "run", "dev"]

# ----- STAGE 5: RUNTIME -----
# Minimal image with only what's needed to run the compiled app
FROM base AS runtime

ENV NODE_ENV=production

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

# Copy package files (including pnpm-workspace.yaml so the install-scripts
# allowlist takes effect)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

# Install production dependencies ONLY.
#
# pnpm v9+ ignores install scripts by default for security. The small set of
# packages that genuinely need them (Prisma engines, sharp, native bindings) is
# allowlisted via `onlyBuiltDependencies` in pnpm-workspace.yaml, which is
# committed and copied above — that allowlist IS the approval, and pnpm honours
# it during `install`. (`pnpm approve-builds` is only the interactive TUI that
# writes that list; it takes no --all flag and cannot run in a build.)
#
# No store cache here, unlike the deps stage: pnpm stores identical files once
# and hard-links them into node_modules, which only works with the store on
# the same filesystem. From a cache mount it copies them, and the image grew
# by 30 MB.
#
# Removed in the same step, so they never become part of a layer: the store,
# Prisma's download cache (the engines it needs are in node_modules), and the
# pnpm that corepack downloaded. Nothing uses them once the image is built,
# and the app runs as `nestjs`, which can't read /root anyway. About 60 MB.
#
# The package managers go too: npm, corepack and their commands. Nothing in
# the running image calls them (the app, its migrations and deploy.sh's
# one-off commands run `node` and node_modules/.bin directly), and the npm
# bundled with the Node image is where the image scan's advisories were: its
# own copies of tar, sigstore and others, fixed only when Node ships a new npm.
RUN pnpm install --prod --frozen-lockfile && \
    rm -rf /pnpm /root/.cache \
        /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
        /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
        /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg

# Copy compiled output from build stage
COPY --from=build /app/dist ./dist

# Copy generated Prisma client from build stage
COPY --from=build /app/generated ./generated

# Copy Prisma schema + migrations (needed for prisma migrate deploy)
COPY prisma ./prisma
COPY prisma.config.ts ./


# Create uploads directory with correct ownership
RUN mkdir -p uploads && chown nestjs:nodejs uploads

# Switch to non-root user
USER nestjs

EXPOSE 3000

# In the image, not only in compose, so `docker run` and other orchestrators
# get a health status too. /health/live checks the process only: a database
# outage must not get the container restarted.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/${API_PREFIX:-api}/v1/health/live" > /dev/null || exit 1

# Run migrations then start the app.
#
# IMPORTANT — entry-point path:
# The compiled entry point is at `dist/src/main.js`, not `dist/main.js`. This
# happens because tsc preserves the `src/` directory when it sees `.ts` files
# at the project root (prisma.config.ts). To "fix" this, you'd need to either
# move prisma.config.ts out of the root OR set `rootDir: src` in
# tsconfig.build.json and figure out how to compile prisma.config.ts separately.
# Both are footguns. Easier: just point at dist/src/main here.
#
# Runs the Prisma CLI from node_modules directly rather than via `pnpm exec`.
# corepack provisions pnpm into root's home during the build, but the runtime
# stage drops to USER nestjs — so `pnpm exec` at container start misses that
# cache and tries to fetch pnpm from the registry on every boot. On a host
# with restricted egress the container then never starts at all.
# Migrations run at start unless RUN_MIGRATIONS=false — deploy.sh runs them
# once itself, before switching versions. exec makes node PID 1, so it gets
# SIGTERM directly and shuts down gracefully.
CMD ["sh", "-c", "if [ \"${RUN_MIGRATIONS:-true}\" = true ]; then ./node_modules/.bin/prisma migrate deploy || exit 1; fi; exec node dist/src/main"]

# ----- STAGE 6: PRODUCTION -----
# The runtime with the Alpine fixes published since it was cached. `base`
# upgrades too, but CI reuses that layer from its build cache as long as the
# node image is the same, so a fix Alpine shipped later never arrives and
# Trivy fails on it (the frontend's libxslt, 11/2026). This stage is built
# afresh every time (`no-cache-filters: prod` in ci.yml) and only upgrades:
# seconds, not the install and the build again. It keeps the runtime's
# user, command and health check. Root only for the upgrade.
FROM runtime AS prod
USER root
RUN apk upgrade --no-cache
USER nestjs
