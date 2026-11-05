# Lessons Learned — First Production Deploy

This doc captures every footgun discovered while taking this starter from "works in dev compose" to "running on a real VPS behind Nginx." Each section names a specific bug, the symptom we saw, the root cause, and what was changed in the starter so it never happens again.

If you're hitting a problem during a first deploy, search this doc for the symptom first — there's a good chance it's already here.

## Table of contents

- [1. pnpm version drift between host and container](#1-pnpm-version-drift-between-host-and-container)
- [2. pnpm install-script gating (`ERR_PNPM_IGNORED_BUILDS`)](#2-pnpm-install-script-gating-err_pnpm_ignored_builds)
- [3. Prisma engines not materializing in the prod image](#3-prisma-engines-not-materializing-in-the-prod-image)
- [4. Compiled entry point at `dist/src/main.js`, not `dist/main.js`](#4-compiled-entry-point-at-distsrcmainjs-not-distmainjs)
- [5. App healthcheck path missing `/api/v1` prefix](#5-app-healthcheck-path-missing-apiv1-prefix)
- [6. App healthcheck `start_period` too short for a slow dependency](#6-app-healthcheck-start_period-too-short-for-a-slow-dependency)
- [7. Container ports binding to `0.0.0.0` instead of `127.0.0.1`](#7-container-ports-binding-to-0000-instead-of-127001)
- [8. `node-exporter:latest` and other floating tags](#8-node-exporterlatest-and-other-floating-tags)
- [9. Stale containers blocking port redeploys](#9-stale-containers-blocking-port-redeploys)
- [10. `.env.production` doesn't propagate via `git pull`](#10-envproduction-doesnt-propagate-via-git-pull)
- [11. Accessing Grafana / Prometheus / Loki in production](#11-accessing-grafana--prometheus--loki-in-production)
- [Quick-reference checklist for your next first deploy](#quick-reference-checklist-for-your-next-first-deploy)
- [Sign-in on a first deploy](#sign-in-on-a-first-deploy)

---

## 1. pnpm version drift between host and container

**Symptom:** Build inside Docker fails with `ERR_PNPM_IGNORED_BUILDS` even though `pnpm install` on the host works fine. Or vice versa: lockfile written on host can't be installed in container.

**Root cause:** The Dockerfile had `corepack prepare pnpm@latest --activate` — floating to whatever pnpm publishes that day. The host machine had a specific pnpm version. When pnpm major versions changed install-script semantics (v10 → v11), the two environments started disagreeing about whether a given install was valid.

**Fix in this starter:**

- `package.json` has `"packageManager": "pnpm@10.34.5"` pinning the version (Renovate moves it forward)
- `Dockerfile` just runs `corepack enable` (no `prepare pnpm@latest`) — corepack reads `packageManager` from `package.json` and uses that version

**Takeaway:** Never `@latest` in a Dockerfile. Pin every version explicitly, including the package manager.

---

## 2. pnpm install-script gating (`ERR_PNPM_IGNORED_BUILDS`)

**Symptom:** `pnpm install` succeeds but exits non-zero with `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: @nestjs/core, @prisma/engines, msgpackr-extract, prisma, sharp, ...`. Subsequent operations fail because Prisma engines / sharp native bindings never downloaded.

**Root cause:** pnpm v9 introduced a security-first default: every package with install scripts is ignored unless explicitly allowed. pnpm v10 moved the allowlist from `package.json`'s `"pnpm"` field to a top-level `pnpm-workspace.yaml`. A Dockerfile that installed without that file in the build context had no allowlist at all.

**Fix in this starter:**

- `pnpm-workspace.yaml` has the `onlyBuiltDependencies` list at the top level (correct v10+ format). That list **is** the approval: pnpm honours it during `install`
- The Dockerfile copies `pnpm-workspace.yaml` and `.npmrc` next to `package.json` in both the deps and the prod stage, before installing
- It does **not** run `pnpm approve-builds`: that is only the interactive tool that writes the list, it takes no `--all` flag, and it cannot run in a build (the Dockerfile's comment above the prod install says so)
- The deps stage uses `--ignore-scripts` because that stage only compiles TS; native bindings aren't needed there

**Takeaway:** For install scripts to run, two things must line up: (1) the package is in `onlyBuiltDependencies`, and (2) `pnpm-workspace.yaml` is present at install time.

---

## 3. Prisma engines not materializing in the prod image

**Symptom:** App starts, but `prisma migrate deploy` fails at runtime with `sh: prisma: not found` or `Cannot find module .../engines` or `Can't write to /app/node_modules/.pnpm/@prisma+engines...`.

**Root cause:** Three contributing bugs:

1. `prisma` (the CLI) was in `devDependencies`, so `pnpm install --prod` excluded it
2. Even when it was included, `--ignore-scripts` (or v11's gating) blocked Prisma's postinstall that downloads engines
3. The Alpine-compatible engine binary wasn't being produced because `schema.prisma` had no `binaryTargets`

**Fix in this starter:**

- `prisma` moved from `devDependencies` → `dependencies` in `package.json`
- `prisma` allowlisted in `pnpm-workspace.yaml`
- `schema.prisma` declares `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` so `prisma generate` in the build stage materializes the Alpine engine alongside the client code
- The build stage's `prisma generate` output (at `/app/generated/`) is copied into the prod stage

**Takeaway:** For Prisma + Alpine + Docker, you need ALL of: prisma in deps, scripts allowed, binaryTargets set, generated/ copied to prod stage.

---

## 4. Compiled entry point at `dist/src/main.js`, not `dist/main.js`

**Symptom:** `node:internal/modules/cjs/loader:1433 ... Error: Cannot find module '/app/dist/main'`. The container crashes immediately, falls into a restart loop.

**Root cause:** This project has `prisma.config.ts` at the repo root in addition to `src/`. The TypeScript compiler computes the project's root as the common ancestor of all included files. With files at both `./` and `./src/`, the root is `./`, so the compiler preserves the `src/` segment in the output path. Result: `src/main.ts` compiles to `dist/src/main.js`, not `dist/main.js`.

**Fix in this starter:**

- Dockerfile CMD points to `node dist/src/main`
- `package.json` `start:prod` script also points to `dist/src/main`

**Takeaway:** Don't assume `dist/main.js` — always check the actual `dist/` layout after `nest build`. If you have any `.ts` file at the repo root (prisma config, vite config, etc.), expect tsc to preserve the `src/` directory in output.

---

## 5. App healthcheck path missing `/api/v1` prefix

**Symptom:** The app starts, logs `🚀 Application is running!`, accepts requests at `/api/v1/...` — but Docker reports it as unhealthy. Manually running `wget http://localhost:3000/health/live` inside the container returns 404.

**Root cause:** NestJS applies the global prefix to ALL routes, including the health endpoint: `API_PREFIX` (default `api`) plus the URI version (`v1`), so every route is under `/api/v1`. The compose healthcheck was probing `/health/live`, which returns 404.

**Fix in this starter:** the healthcheck path is `http://127.0.0.1:3000/api/v1/health/ready` — with the prefix, and `ready` rather than `live`, so a release that can't reach the database or Redis is reported unhealthy instead of being promoted. If you change `API_PREFIX` in your env, update the path here too.

**Takeaway:** Container healthchecks should hit the actual served path, not the path you wish were served. Verify by `docker exec` into the running container and curling the endpoint yourself.

---

## 6. App healthcheck `start_period` too short for a slow dependency

**Symptom:** Deploy script reports `app is unhealthy` at ~130 seconds, even though the app's own logs show it still starting normally.

**Root cause:** Docker's healthcheck has `start_period` (grace period) + `retries × interval` (failure budget). With `start_period: 40s, retries: 3, interval: 30s`, Docker stops being lenient at 40 + 90 = 130s. Anything slower than that during boot — a long migration on a large table, a cold database, a dependency that takes minutes to come up — spends that window failing probes, and Docker marks the container unhealthy.

**Fix in this starter:** a grace period on the app's healthcheck, then two later changes on top of it:

- `start_period: 60s` with `start_interval: 5s` (Docker Engine 25+): during the first minute, failed probes don't count, and Docker probes every 5 seconds, so a deploy sees the release healthy within seconds of it being ready rather than after the first 30-second interval.
- `deploy.sh` migrates **before** starting the new release (`RUN_MIGRATIONS=false` for the container), so a long migration no longer happens inside the healthcheck window at all. It waits up to `DEPLOY_HEALTH_TIMEOUT` (600 s) for health.

An earlier version used `start_period: 180s`; with migrations moved out of the container start, 60 s covers boot on a small VPS.

**Takeaway:** Set `start_period` to comfortably exceed your slowest startup, and keep slow one-off work (migrations) out of the container's start. The default 0s is wrong for any service with a real dependency tree.

---

## 7. Container ports binding to `0.0.0.0` instead of `127.0.0.1`

**Symptom:** No visible symptom during deploy — but the app and other internal services are publicly reachable on the VPS's public IP, bypassing Nginx entirely. Major security hole.

**Root cause:** Default Docker port publishing (`"3000:3000"`) binds to `0.0.0.0:3000` on the host — meaning the world. You want only Nginx on the host to reach those ports.

**Fix in this starter:** Every internal-facing service has `"127.0.0.1:${PORT}:..."` in its ports block. Only Nginx (running natively on the host) can reach them. Same applies to Grafana, Prometheus, Loki, etc.

**Takeaway:** Default Docker port mappings are world-accessible. Always prefix with `127.0.0.1:` for anything that should only be reachable through a reverse proxy.

---

## 8. `node-exporter:latest` and other floating tags

**Symptom:** Build that worked yesterday breaks today with no code changes. Or different VPSes get different versions of a service.

**Root cause:** `image: prom/node-exporter:latest` — `:latest` resolves to whatever's freshest on the registry at pull time. Same for `nginx:alpine`, `redis:alpine`, etc.

**Fix in this starter:** Every image tag is pinned to a specific version (`prom/node-exporter:v1.12.1`, `postgres:16.2-alpine`, `redis:7.2.4-alpine`, etc.). Same for the node base image: `node:22.23.2-alpine`, the exact Node release. Renovate opens a pull request when a newer one appears, so pinning does not mean falling behind ([renovate.md](./renovate.md)).

**Takeaway:** Treat `:latest` as a smell. The five seconds you save by writing it now will cost you an hour of debugging the first time it breaks.

---

## 9. Stale containers blocking port redeploys

**Symptom:** `docker compose up` fails with `Bind for 127.0.0.1:XXXX failed: port is already allocated` even though all your compose files look right.

**Root cause:** A separate compose project (e.g., the frontend's compose) is still running with the old port mapping that conflicts with what you're trying to bring up now. Docker doesn't auto-stop containers in other projects.

**Fix in this starter:** Not a code fix — an operational discipline. When changing host-side port mappings, explicitly `docker compose down` the OTHER service first:

```bash
cd /opt/other-service
docker compose -f docker-compose.prod.yaml down

cd /opt/this-service
./deploy.sh
```

**Takeaway:** Each `docker-compose.yaml` is a separate "project" to Docker. Containers from one project can hold host ports that block another project.

---

## 10. `.env.production` doesn't propagate via `git pull`

**Symptom:** You edit `.env.production` on your dev machine, commit nothing (because it's gitignored), push other code, pull on VPS, and find that nothing changed. Or you edit only one side and forget the other.

**Root cause:** `.env.production` is gitignored on purpose (it has secrets). `git pull` can't sync it. Each environment has its own copy.

**Fix in this starter:** Not a code fix — but the `.env.example` is committed and documents every variable. The deploy flow:

1. Edit `.env.example` (committed) for any new variables
2. SSH into VPS, edit `/opt/<service>/.env.production` directly to add real values
3. Document the change in a deploy notes file or commit message body

**Takeaway:** Secrets stay out of git. Config changes that affect prod env vars need to happen on the VPS, not in `git pull`.

---

## 11. Accessing Grafana / Prometheus / Loki in production

**Symptom:** You deploy to a VPS, remember monitoring is part of the stack, and try to load `http://your-vps-ip:3002` for Grafana. Connection refused. You try the public domain. Connection refused. You start considering opening a port in UFW.

**This is not a bug — it's the deliberate design.** The compose file binds every monitoring service to `127.0.0.1`:

```yaml
prometheus:
  ports: ["127.0.0.1:${PROMETHEUS_PORT:-9090}:9090"]
grafana:
  ports: ["127.0.0.1:${GRAFANA_PORT:-3002}:3000"]
loki:
  ports: ["127.0.0.1:${LOKI_PORT:-3100}:3100"]
```

This means those ports are reachable from the VPS itself (so Grafana can query Prometheus, Alloy can push to Loki, etc.) but **not from the public internet**. There's no Nginx vhost, no certbot cert, no firewall rule needed — and no attack surface either.

**Root cause / why it's like this:** Grafana, Prometheus, and Loki are admin tools, not user-facing services. Exposing them publicly adds attack surface (auth-bypass CVEs are routine — Grafana shipped CVE-2021-43798 and CVE-2024-9264 as recent examples; both let unauthenticated users read arbitrary files). They also tend to have weak default credentials. Keeping them off the public internet is the default for a reason.

**How to access Grafana from your laptop — SSH tunnel:**

```bash
# Single service (Grafana, host port 3002)
ssh -L 3002:127.0.0.1:3002 user@your-vps

# All three at once — different local ports if you want, same remote ports
ssh -L 3002:127.0.0.1:3002 \
    -L 9090:127.0.0.1:9090 \
    -L 3100:127.0.0.1:3100 \
    user@your-vps
```

Leave that SSH session open, then visit `http://localhost:3002` in your browser. When you `exit` the SSH session, the tunnel closes. No public exposure, no extra auth to manage — you reuse your SSH key.

**Why SSH tunnel and not "just expose it behind Nginx with basic auth":**

| Approach | Setup cost | Attack surface | Auth story |
|---|---|---|---|
| SSH tunnel | Zero (already have SSH) | Same as SSH (already exposed) | SSH key |
| Nginx + basic auth | DNS record, cert, htpasswd, vhost block | Adds a public HTTPS endpoint | htpasswd + Grafana login (two locks) |
| Nginx + no auth | DNS record, cert, vhost block | Adds a public HTTPS endpoint | Just Grafana login (one lock) |

The tunnel wins on every axis for a solo-dev / small-team setup. The only reason to switch to Nginx is if a teammate needs browser access without shell access — and even then, set up an SSH bastion first.

**Aliasing the tunnel command:**

Add to `~/.ssh/config` on your laptop:

```
Host vps-monitoring
  HostName your-vps-ip-or-domain
  User ubuntu
  LocalForward 3002 127.0.0.1:3002
  LocalForward 9090 127.0.0.1:9090
  LocalForward 3100 127.0.0.1:3100
```

Then `ssh vps-monitoring` opens all three tunnels in one command.

**Takeaway:** Monitoring services bound to `127.0.0.1` are intentional. Reach them via SSH tunnel, not Nginx. Don't be tempted to "just open the port for convenience" — the convenience is the SSH tunnel, the cost of exposing is too high for an admin-only tool.

**Subpath gotcha — `GF_SERVER_ROOT_URL` without `SERVE_FROM_SUB_PATH`:** An earlier version of this starter shipped with:

```yaml
- GF_SERVER_ROOT_URL=%(protocol)s://%(domain)s:%(http_port)s/grafana/
```

…without the companion `GF_SERVER_SERVE_FROM_SUB_PATH=true`. That config was written for a future Nginx setup proxying Grafana under `/grafana/`. With only `ROOT_URL` set, Grafana issues a 302 redirecting `/` → `/grafana/login`, but it still serves all its routes at `/`, not `/grafana/`. Through an SSH tunnel the browser follows the 302 to `localhost:3002/grafana/login`, gets nothing, and shows a misleading "can't connect" error (it actually connected; the path just doesn't exist).

The starter now ships without `ROOT_URL` so Grafana serves at `/` and the tunnel "just works." If you later proxy through Nginx, re-add **both** lines together — they're a pair, never one without the other.

---

## Quick-reference checklist for your next first deploy

When deploying a new project based on this starter, verify in order:

- [ ] `node:22.23.2-alpine` and other base images pinned, no `:latest`
- [ ] `pnpm` version pinned via `packageManager` in `package.json`
- [ ] `pnpm-workspace.yaml` has `onlyBuiltDependencies` with the packages that need scripts
- [ ] Dockerfile copies `pnpm-workspace.yaml` and `.npmrc` into both deps + prod stages, before installing
- [ ] `prisma` is in `dependencies`, not `devDependencies`
- [ ] `schema.prisma` declares `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]`
- [ ] Dockerfile CMD uses `dist/src/main` (not `dist/main`)
- [ ] App healthcheck path includes the global API prefix, and probes readiness (`/api/v1/health/ready`)
- [ ] App healthcheck has a `start_period` (60s) and `start_interval`, and migrations run before the switch, not in the healthcheck window
- [ ] All internal services bind to `127.0.0.1:PORT`, never `0.0.0.0:PORT`
- [ ] `.env.production` exists on the VPS with all secrets filled in (it won't come from `git pull`), and `PORT=3000` in it
- [ ] Two DNS A-records (`api.` and `app.`) point to the VPS BEFORE running certbot. Sign-in is part of the API, so there is no third name
- [ ] The sign-in settings below are right

Each item maps back to a numbered section above. If any of these aren't done, that section has the full story.

## Sign-in on a first deploy

Authentication is part of the app here, and it has its own ways to work on a
laptop and fail on a server. Each of these is explained, with the fix, in
[auth/operations.md](./auth/operations.md):

- **Signed out after 15 minutes.** The refresh cookie is not reaching the API:
  the web app and the API are on different sites without
  `AUTH_COOKIE_SAMESITE=none`, or the site is not on HTTPS.
- **`403 AUTH_FORBIDDEN` on refresh or sign-out.** The page's origin is not in
  `CORS_ORIGINS` (exact match, no trailing slash).
- **No sign-up email.** `EMAIL_*` points at nothing that delivers, or the
  sender's domain is not authenticated and the code lands in spam. Look for a
  failed `send-code` job on `/admin/queues`.
- **Google says `redirect_uri_mismatch`.** The registered redirect URI is not
  exactly `<BASE_URL>/api/v1/auth/google/callback`.
