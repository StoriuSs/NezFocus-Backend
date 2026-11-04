# Making it yours

You have cloned the starter and it runs. Before you write a line of your own
code, there is a pass of renaming to do — and it is worth doing **now**,
because half of these names end up in Docker volumes and Grafana labels,
where changing them later means losing data or re-doing setup.

Most of it is one `sed`. The list is long only because it is complete.

- [Do it in this order](#do-it-in-this-order)
- [1. The project name](#1-the-project-name)
- [2. Container names](#2-container-names)
- [3. The environment file](#3-the-environment-file)
- [4. The repository itself](#4-the-repository-itself)
- [5. Things you can leave alone](#5-things-you-can-leave-alone)
- [Check it worked](#check-it-worked)
- [Later, when you deploy](#later-when-you-deploy)

## Do it in this order

Before `pnpm docker:dev` has ever run, ideally. If you have already started
the stack, do the rename and then `pnpm docker:reset` — it deletes the
development data, which at this point is nothing.

Pick one name and use it everywhere. Lowercase, hyphenated, no spaces:
`acme-api`, `bookings`, `shipyard`. Below it is written as **`myapp`**.

## 1. The project name

This is the one that matters most, because Docker derives **volume names**
from it. Get it right before there is data in them.

```bash
# in docker-compose.dev.yaml  and  docker-compose.prod.yaml
name: hexagonal-auth-dev     →  name: myapp-dev
name: hexagonal-auth-prod    →  name: myapp-prod
```

That single key decides:

- the volumes (`myapp-dev_db`, `myapp-dev_grafana-data`, …)
- the network
- **the `project` label on every metric, log line and alert**, because compose
  passes `COMPOSE_PROJECT_NAME` through to Alloy. Two projects with the same
  name send data to the same place and you cannot tell them apart.
- the folder Grafana Cloud dashboards are uploaded into

Also update `package.json` (it starts as `testapp-backend-hexagonal-auth`):

```json
{
  "name": "myapp-api",
  "description": "What your service actually does"
}
```

The OpenAPI document takes its title from that `name`, so run
`pnpm openapi:export` afterwards and commit the result.

## 2. Container names

There are **27** `container_name:` lines across the compose files: 8 in
`docker-compose.dev.yaml`, 7 in `docker-compose.prod.yaml` and 12 in
`monitoring/compose/`. They look cosmetic — until you run two projects on one
machine, at which point Docker refuses to start the second one because the
name is taken.

Three other files use those names, and break if they are left behind:

| File | What uses the old name |
|---|---|
| `package.json` | the `docker:logs` script runs `docker logs nestapp-hexagonal-auth-dev` |
| `.github/workflows/ci.yml` | the integration job runs `docker exec postgres-hexagonal-auth ...` to create the shadow database |
| `deploy.sh`, `.env.example` | the default image name, `hexagonal-auth-prod-app` (it must match the default in `docker-compose.prod.yaml`) |

So rename in all of them at once:

```bash
# from the repository root
grep -rl "hexagonal-auth" docker-compose.dev.yaml docker-compose.prod.yaml monitoring/compose/ \
    package.json .github/workflows/ci.yml deploy.sh .env.example \
  | xargs sed -i 's/hexagonal-auth/myapp/g'
```

On macOS, `sed -i ''` instead of `sed -i`.

That also catches the `name:` keys from step 1, so you can do both at once.
In `package.json` it turns the `name` into `testapp-backend-myapp`; set the
name you want afterwards, as in step 1. Do this before the first production
deploy: release images built under the old name are not found under the new
one, so a rollback to one of them would fail.

The `.env.development` you already made from `.env.example` is not touched by
the `sed`. Only the commented `DEPLOY_IMAGE` line mentions the name, so
nothing breaks, but you can edit it by hand.

Check the result before committing:

```bash
git diff --stat
docker compose -f docker-compose.dev.yaml config --services   # still parses?
```

## 3. The environment file

In your `.env.development` — and later in `.env.production` on the server:

| Setting | Change it to |
| --- | --- |
| `APP_NAME` | Your product's name, as people should see it. It appears in the API docs at `/api-docs`, in every email, and as the label in authenticator apps when someone turns on two-step sign-in. Pick it before real users enable two-step sign-in: entries already added to an authenticator app keep the old label |
| `BASE_URL` | The API's public address (`http://localhost:8888` in development, `https://api.example.com` in production). It is also the **issuer and audience of every access token**, so changing it signs everyone out at their next request, and Google's redirect URI is built from it |
| `JWT_SECRET` | `openssl rand -hex 32`. Signs access tokens and keys the stored hashes of emailed codes. Never the placeholder from `.env.example` |
| `AUTH_ENCRYPTION_KEY` | `openssl rand -hex 32`. Encrypts two-step sign-in secrets. `.env.example`'s all-zero key is for development only, and production refuses it. Keep a copy somewhere safe: losing it locks two-step users out of the second step ([two-step-sign-in.md](./auth/two-step-sign-in.md)) |
| `DB_NAME` | `myapp` |
| `DB_USERNAME` | `myapp` |
| `DB_PASSWORD` | `openssl rand -hex 24` |
| `DATABASE_URL` | The same three, in URL form |
| `REDIS_PASSWORD` | Generate one. Optional locally, required in production |
| `EMAIL_FROM_NAME`, `EMAIL_FROM_ADDRESS` | Yours |
| `CORS_ORIGINS` | Your frontend's origin, and nothing else |
| `FRONTEND_URL` | Your frontend's address. Links in auth emails point there, and Google sign-in returns the browser there |
| `SUPPORT_EMAIL` | Optional. An address people can write to, named in the emails where only a person can help |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional: both set turns on "Continue with Google". Register the redirect URI `<BASE_URL>/api/v1/auth/google/callback` (in development `http://localhost:8888/api/v1/auth/google/callback`). Steps: [setup/google-sign-in.md](./setup/google-sign-in.md) |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Optional: both set turns on Cloudflare's CAPTCHA on sign-up, "forgot password", and sign-in after failed attempts. Steps: [setup/cloudflare-turnstile.md](./setup/cloudflare-turnstile.md) |

**`DB_NAME` and `DB_USERNAME` are read only once**, when Postgres first
creates its data directory. Changing them later needs `pnpm docker:reset` or
a `CREATE ROLE` by hand — which is the whole reason this page says to do the
rename first.

Everything else in `.env.example` has a sensible default. The full reference
is [environment.md](./environment.md). For each outside service (email,
Google, Turnstile, storage, Sentry...), [setup/README.md](./setup/README.md)
lists what it is for, whether you need it, and the page with the steps to get
its keys.

## 4. The repository itself

- **`README.md`** — the title, the description, and the badges, which still
  point at this starter's versions.
- **The paired-repository links** in `README.md` and `OVERVIEW.md`, if you are
  not using the React starter.
- **`git remote set-url origin …`**, and consider `rm -rf .git && git init` if
  you would rather not carry the starter's history.
- **`LICENSE`** — MIT here. Yours to change.
- **`docs/`** — the pages describe this starter, not your product. They are a
  good base; edit them as your project diverges rather than letting them
  become wrong. `pnpm test` fails if a link between them breaks, which keeps
  the editing honest.

## 5. Things you can leave alone

Worth knowing, so you do not go hunting:

- **The CI image name.** `ci.yml` derives it from `GITHUB_REPOSITORY`, so it
  follows your repository automatically.
- **`DEPLOY_IMAGE`'s default** (`hexagonal-auth-prod-app`, or `myapp-prod-app`
  after the `sed` above) is only used in `build` mode on the server, where
  nothing else sees it. Set it if you use `registry` mode.
- **`SITE_NAME` in `nginx/bootstrap-nginx.sh`** (`nest-api`) only matters if
  you run more than two projects on one host — pass `--site-name` then.
- **Comments mentioning `hexagonal-auth`** in `pino.config.ts`,
  `container-logs.alloy` and `monitoring-cloud-sync.ts`. They are examples in
  prose, not configuration.

## Check it worked

```bash
pnpm env:check                    # the file is complete and valid
pnpm docker:reset && pnpm docker:dev
docker ps --format '{{.Names}}'   # your names, not *-hexagonal-auth*
pnpm docker:logs                  # the app's log: still works after the rename
curl localhost:8888/api/v1/health/ready
pnpm test                         # about 450 unit tests, none of which need the stack
```

(8888 is `PORT` in `.env.development`; the web app's dev server is 3001.)

Protected routes answer 401 until you sign in: make an account as in
[GETTING_STARTED.md](../GETTING_STARTED.md#5-make-yourself-an-account).
The whole first-time setup, step by step, is in
[setup/prepare-for-development.md](./setup/prepare-for-development.md).

## Later, when you deploy

A second, shorter pass, and the checklist for it is in
[deployment-guide.md](./deployment-guide.md#the-checklist): new secrets for
production (`JWT_SECRET`, `AUTH_ENCRYPTION_KEY`, the database and Redis
passwords), a real `CORS_ORIGINS`, `BASE_URL` on your API's domain, the
production Google redirect URI, an `ALERT_WEBHOOK_URL`, and the decision
about where monitoring lives. The ordered walkthrough is
[setup/prepare-for-production.md](./setup/prepare-for-production.md).

## Related

- [environment.md](./environment.md) — every setting
- [adding-a-module.md](./adding-a-module.md) — now build something
- [deployment-guide.md](./deployment-guide.md) — when it is time to go live
