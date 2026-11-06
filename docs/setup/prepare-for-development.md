# Prepare for development

This page takes you from a fresh laptop to the API running on your machine, with
an account you signed up yourself and the tests passing. Follow it top to
bottom. Each step ends with **You are done when**: check that before you move
on, because every step builds on the one before.

You need no accounts anywhere for the main path. Email, storage and monitoring
all run in Docker on your machine. The optional extras at the end (Google
sign-in, Sentry, the web app) each take 5 to 15 minutes.

- [Step 1: Install the tools](#step-1-install-the-tools)
- [Step 2: Get the code](#step-2-get-the-code)
- [Step 3: Create your environment file](#step-3-create-your-environment-file)
- [Step 4: Install the packages](#step-4-install-the-packages)
- [Step 5: Start everything](#step-5-start-everything)
- [Step 6: Find your way around](#step-6-find-your-way-around)
- [Step 7: Sign up for real](#step-7-sign-up-for-real)
- [Step 8: Run the tests](#step-8-run-the-tests)
- [Optional extras](#optional-extras)
- [When something goes wrong](#when-something-goes-wrong)

**On Windows**, run the commands on this page in **Git Bash** (installed with
Git for Windows) or in WSL. They are written for a bash shell; PowerShell
quotes differently and its `curl` is a different program.

---

## Step 1: Install the tools

| Tool | Version | Why |
|---|---|---|
| Git | any recent | To get the code |
| Node.js | **22** (the file `.nvmrc` says `22`; `package.json` asks for 22 or newer) | Runs the tests, Prisma and the helper scripts on your machine |
| pnpm | **10.34.5**, pinned in `package.json` (`packageManager`) | Installs the packages. Corepack, which ships with Node, fetches the exact version |
| Docker | Docker Desktop (Windows, macOS), or Docker Engine 25 or newer with the compose plugin (Linux) | Runs the app, Postgres, Redis, Mailpit and the monitoring |
| openssl | any | Generates secrets. Already there on macOS, Linux and in Git Bash |

1. **Git**: from [git-scm.com](https://git-scm.com/downloads). On Windows this
   also installs Git Bash.
2. **Node.js 22**. A version manager lets you switch per project; pick one:
   - macOS / Linux: [nvm](https://github.com/nvm-sh/nvm), then, inside the
     project folder later, `nvm install` (it reads `.nvmrc`).
   - Windows: [fnm](https://github.com/Schniz/fnm) (`fnm install 22`,
     `fnm use 22`) or [nvm-windows](https://github.com/coreybutler/nvm-windows)
     (`nvm install 22`, `nvm use 22`).
   - Or the installer for version 22 from [nodejs.org](https://nodejs.org).
3. **pnpm**, through Corepack:

   ```bash
   corepack enable
   ```

   If it fails with a permission error on Windows, run it once in a terminal
   opened as administrator. The first `pnpm` command in the project then
   downloads version 10.34.5 by itself.
4. **Docker Desktop** from [docker.com](https://www.docker.com/products/docker-desktop/).
   On Windows, keep the default "Use WSL 2" option. Start it, and wait until it
   says it is running. Give it at least 4 GB of memory (Settings → Resources)
   if your machine allows.

**You are done when** each of these answers:

```bash
git --version
node -v                # v22.something
corepack --version
docker compose version # Docker Compose version v2.something
docker info            # no "Cannot connect to the Docker daemon"
```

## Step 2: Get the code

```bash
git clone https://github.com/<your-org>/<your-repository>.git my-api
cd my-api
```

If you are starting a new project from the starter rather than joining one,
first make your own repository from it: [github.md](./github.md#1-your-own-repository).
And if you want to rename the project (database name, container names), do it
now, before anything is created: [../making-it-yours.md](../making-it-yours.md).

**You are done when** `ls` in the folder shows `package.json`,
`docker-compose.dev.yaml` and `.env.example`.

## Step 3: Create your environment file

All the settings live in one file that is never committed. Make yours from the
template:

```bash
cp .env.example .env.development
```

Every line in it has a comment above it saying what it does. **Nothing has to
change for the app to start**: the template's values are valid in development.
A few are still worth changing now, because they are harder to change later:

| Setting | Change it to | Why now |
|---|---|---|
| `DB_NAME`, `DB_USERNAME` | Your project's name, e.g. `myapp` | Postgres reads them only once, when it first creates its data. Changing them later means deleting the development database |
| `DB_PASSWORD` | A password: `openssl rand -hex 24` | Same reason |
| `DATABASE_URL` | The same three values: `postgresql://myapp:<DB_PASSWORD>@localhost:5432/myapp?schema=public` | The app in Docker builds its own address and ignores this line, but the commands you run on your machine read it: `pnpm prisma:migrate`, `pnpm user:promote`, `pnpm dev`. The template's line does not match the template's `DB_*` values, so those commands fail until you fix it |
| `REDIS_PASSWORD` | `openssl rand -hex 24` | Optional in development, required in production. Practise with one |
| `JWT_SECRET` | `openssl rand -hex 32` | The template's text works in development (it is long enough) but production refuses it. Get used to generating it |
| `ALERT_WEBHOOK_URL` | Empty: `ALERT_WEBHOOK_URL=` | The template holds a made-up Discord address. While it is set, the local Alertmanager tries to post every alert there and fails. Empty, it shows alerts in Grafana and sends nothing ([../alerts.md](../alerts.md#development)) |
| `APP_NAME`, `EMAIL_FROM_NAME` | Your app's name | Shown in the emails |

Leave the rest as it is for now. In particular:

- `PORT=8888` and `BASE_URL=http://localhost:8888`: the API's address on your
  machine. The web app's template already points at port 8888.
- `FRONTEND_URL=http://localhost:3001` and `CORS_ORIGINS=http://localhost:3001`:
  where the web app runs in development. Links in emails point at
  `FRONTEND_URL`; `CORS_ORIGINS` is the list of web pages allowed to call the
  API from a browser.
- `EMAIL_*`: in Docker every email goes to Mailpit, whatever these say.
- `GRAFANA_PORT=3002`: Grafana is on 3002, because 3001 is the web app's.

Two traps when you edit the file:

- **No `$` in values**, unless the whole value is in single quotes. Docker
  Compose reads `$NAME` as a variable, so `aB3$kL9` silently becomes `aB3`.
  `openssl rand -hex` never produces a `$`.
- **No spaces around `=`**: `DB_NAME=myapp`, not `DB_NAME = myapp`.

**You are done when** `.env.development` exists and `DATABASE_URL` uses the
same name, user and password as `DB_NAME`, `DB_USERNAME` and `DB_PASSWORD`.
(You check the whole file in the next step.)

## Step 4: Install the packages

```bash
pnpm install
pnpm prisma:generate
pnpm env:check
```

- `pnpm install` downloads every package (a few minutes the first time) and
  sets up the git hooks ([../git-hooks.md](../git-hooks.md)).
- `pnpm prisma:generate` writes the database client into `generated/`. The
  tests and the commands you run on your machine need it; it is git-ignored, so
  every fresh clone makes its own (CI does the same).
- `pnpm env:check` checks `.env.development` against the rules the app applies
  when it starts, and never prints a value.

**You are done when** `pnpm env:check` prints
`✓ .env.development (NODE_ENV=development): OK`. If it lists problems, each
line names the setting and what is wrong with it.

## Step 5: Start everything

```bash
pnpm docker:dev
```

This builds the app's image and starts it with Postgres, Redis, Mailpit and the
monitoring tools, all in the Docker Compose project `nezfocus-web-dev`. The
first run downloads images and takes several minutes; later runs take seconds.

When the containers are up, the app installs nothing more, applies the database
migrations (the files in `prisma/migrations/` that create the tables), and
starts with hot reload: save a file and it restarts by itself. Follow it:

```bash
pnpm docker:logs        # Ctrl+C stops following, not the app
```

**You are done when** this answers with status 200 and `"status":"ok"` in the
body:

```bash
curl -i http://localhost:8888/api/v1/health/ready
```

`ready` means the app answers and so do Postgres and Redis. If you get
"connection refused", the app is still starting: look at `pnpm docker:logs`.

Day-to-day: `pnpm docker:down` stops everything and keeps the data;
`pnpm docker:reset` stops everything and **deletes** the development database.

## Step 6: Find your way around

Everything listens on `localhost` only, never on your network.

| What | Address | Sign in with |
|---|---|---|
| The API | `http://localhost:8888/api/v1/...` | An access token (next step) |
| API documentation (Swagger: every route, and a "Try it out" button) | http://localhost:8888/api-docs | Nothing in development |
| Mailpit: every email the app sends | http://localhost:8025 | Nothing |
| Bull Board: the background job queues (emails are sent from here) | http://localhost:8888/admin/queues | `BULL_BOARD_USER` / `BULL_BOARD_PASSWORD` (`admin` / `admin` in the template) |
| Grafana: dashboards and logs | http://localhost:3002 | `admin` / `GRAFANA_ADMIN_PASSWORD` (`admin` in the template) |
| Prometheus: raw metrics and alert rules | http://localhost:9090 | Nothing |
| Alertmanager: firing alerts | http://localhost:9093 | Nothing |
| Postgres | `localhost:5432` (`DB_PORT`) | `DB_USERNAME` / `DB_PASSWORD`, from any database tool |
| Redis | `localhost:6379` (`REDIS_PORT`) | `REDIS_PASSWORD` |

In Grafana, the **NestJS API Metrics** dashboard has a **Sign-in and accounts**
row: sign-ups, sign-ins and refusals as they happen. **NestJS Logs** shows the
app's log lines. More in [../monitoring.md](../monitoring.md).

If a port is already taken on your machine, change it in `.env.development`
(`PORT`, `DB_PORT`, `GRAFANA_PORT`, ...) and run `pnpm docker:dev` again. Those
values only choose the port on your machine; inside Docker nothing changes.

**You are done when** Swagger, Mailpit and Grafana open in your browser.

## Step 7: Sign up for real

Signing up is a code by email: you give your address, the app emails you a
six-digit code, and entering the code creates the account and signs you in.
Signing in later works the same way. Mailpit catches the email, so nothing is
delivered for real.

```bash
API=http://localhost:8888/api/v1

# 1. Ask for a code. The answer is 202 ("check your email for the code") with
#    no data, whether or not the address has an account.
curl -i -X POST $API/auth/email-code -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","language":"en"}'
```

2. Open http://localhost:8025. The newest email, "Your code to create a ...
   account", holds a six-digit code. It is valid for 10 minutes.

```bash
# 3. Send the code back. This creates the account and signs you in: the
#    answer holds an access token, and the refresh cookie lands in cookies.txt.
curl -i -c cookies.txt -X POST $API/auth/email-code/verify -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","code":"123456"}'
```

The answer looks like this (shortened):

```json
{
  "meta": { "message": "You are signed in.", "...": "..." },
  "data": {
    "access_token": "eyJhbGciOi...",
    "token_type": "Bearer",
    "expires_in": 900,
    "account": { "created": true, "completed": false }
  }
}
```

`completed: false` means the account has no username or password yet. The
"complete your account" step that sets them is planned; until then the
account works as it is.

The **access token** is a short-lived pass (15 minutes) that you send with
every request. The **refresh token** is a long-lived secret in a cookie that
only the API reads; it gets you a new access token when the old one expires.
[../auth/concepts.md](../auth/concepts.md) explains both in plain words.

```bash
# 4. Use the access token.
TOKEN=<paste data.access_token here>
curl $API/users/me -H "Authorization: Bearer $TOKEN"

# 5. Get a new access token with the refresh cookie, as the web app does.
curl -b cookies.txt -c cookies.txt -X POST $API/auth/refresh

# 6. To sign in with a password too, choose one with "forgot password":
#    ask for a code (wait a minute after the last one), then send it with the
#    new password. Read the code in Mailpit, "Choose a password for ...".
curl -i -X POST $API/auth/forgot-password -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com"}'
curl -i -c cookies.txt -X POST $API/auth/reset-password -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","code":"654321","password":"Harbour-Lantern-42"}'

# 7. Next time, sign in with a new code (steps 1 to 3) or with the password.
curl -i -c cookies.txt -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"Harbour-Lantern-42"}'
```

The password must have at least 8 characters, with a lower-case letter, an
upper-case letter, a digit and a character that is neither. A 422 answer
lists each rule it broke
([../auth/passwords-and-codes.md](../auth/passwords-and-codes.md)).

To make that account an administrator:

```bash
pnpm user:promote you@example.com
```

(It reads `DATABASE_URL` from `.env.development`, which is why step 3 made it
match. Or run it inside the app container, which has the right address already:
`docker exec nestapp-nezfocus-web-dev pnpm user:promote you@example.com`.)

Delete `cookies.txt` when you are done: it holds a live sign-in.

**You are done when** `/users/me` answers 200 with your email address.

Every route, body and error: [../auth/api-reference.md](../auth/api-reference.md).
Every flow drawn out: [../auth/flows.md](../auth/flows.md).

## Step 8: Run the tests

Three kinds, each with its own command:

| Command | What it tests | Needs |
|---|---|---|
| `pnpm test` | Unit tests: single pieces of logic, with everything around them faked | Nothing running |
| `pnpm test:e2e` | The HTTP API, start to finish, with the database and Redis faked | Nothing running |
| `pnpm test:integration` | The code against the real thing: Postgres, Redis, S3 storage (RustFS) and SMTP (Mailpit) | The test services (below) |

```bash
pnpm test
pnpm test:e2e

pnpm test:services:up     # Postgres, Redis, RustFS and Mailpit, from docker-compose.dev.yaml
pnpm test:integration
```

`pnpm test:services:up` reuses the Postgres, Redis and Mailpit of step 5 if
they are running, and adds RustFS, an S3-compatible storage server. The
integration tests create their own database, `<DB_NAME>_test`, so they never
touch your development data. `pnpm test:services:down` removes RustFS again.

To run some suites only: `pnpm test:integration -- auth` (by file name).
More in [../testing.md](../testing.md).

**You are done when** all three commands end with every test passing. This is
also exactly what CI runs on every push ([../ci.md](../ci.md)).

You now have a working development setup. The rest of this page is optional.

---

## Optional extras

Each of these is off until you set its keys, and each can be added at any time.
After changing `.env.development`, run `pnpm docker:dev` again: Docker Compose
recreates the app container with the new values.

### The web app

The React starter is a separate repository, `React-Starter-No-Keycloak`:
sign-up, sign-in, Google, the profile page. It needs Node 22
too, runs on port 3001 and calls this API.

```bash
git clone https://github.com/<your-org>/<your-web-repository>.git my-web
cd my-web
cp .env.example .env.development      # VITE_API_URL=http://localhost:8888/api/v1 already
pnpm install
pnpm dev                              # http://localhost:3001
```

`VITE_API_URL` must be the API's address including `/api/v1`. On the API side
nothing changes: `CORS_ORIGINS` and `FRONTEND_URL` already say
`http://localhost:3001`.

**You are done when** you can sign up at http://localhost:3001 and the code
arrives in Mailpit.

### Google sign-in

Adds "Continue with Google". You need a Google Cloud project and a **development**
OAuth client whose redirect URI is exactly:

```
http://localhost:8888/api/v1/auth/google/callback
```

Steps: [google-sign-in.md](./google-sign-in.md). Then, in `.env.development`:

```bash
GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
```

Both or neither: the app refuses to start with only one. While the Google
project is in "Testing", only the Google accounts you list as test users can
sign in.

**You are done when** `curl http://localhost:8888/api/v1/auth/options` answers
`"providers":["google"]`, and the Google button in the web app takes you to
Google and back, signed in. How it works: [../auth/google-sign-in.md](../auth/google-sign-in.md).

### Sentry

Sentry collects unexpected errors (a 500, a crash) and groups them. Create a
free account and a project for the API, and put its DSN in `.env.development`:

```bash
SENTRY_DSN=https://<key>@o<org-id>.ingest.us.sentry.io/<project-id>
```

Steps: [sentry.md](./sentry.md). Then:

```bash
pnpm sentry:check       # sends one test error, and says whether Sentry took it
```

**You are done when** `pnpm sentry:check` says the event was accepted and it
shows in the project's **Issues**, under the `development` environment.

### Profile pictures in S3 storage

By default uploads go to the `uploads/` folder. To try the S3 code path without
an AWS account, use RustFS from `pnpm test:services:up`: the settings are in
`.env.example` under "Local RustFS". For a real bucket: [storage-s3-r2.md](./storage-s3-r2.md).

### Alerts in Discord, Grafana Cloud

To see what a production alert looks like, point `ALERT_WEBHOOK_URL` at a test
channel ([discord-alerts.md](./discord-alerts.md)). To send metrics and logs to
Grafana Cloud instead of running Grafana locally: [grafana-cloud.md](./grafana-cloud.md).

---

## When something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| `pnpm` says "Unsupported environment" | Your Node is not version 22 or newer | `node -v`, then `nvm use` / `fnm use 22` |
| `env file .env.development not found` | Step 3 was skipped | `cp .env.example .env.development` |
| "port is already allocated" | Something else uses that port (another project, a local Postgres) | Change `PORT`, `DB_PORT`, ... in `.env.development`, then `pnpm docker:dev` |
| `P1000: Authentication failed` in the app's log, Postgres "healthy" | Postgres was first created with other `DB_*` values (an earlier attempt) | `pnpm docker:reset` (deletes the dev database), then `pnpm docker:dev` |
| `pnpm user:promote` or `pnpm prisma:migrate` cannot connect | `DATABASE_URL` does not match `DB_*` | Step 3 |
| No email in Mailpit | The job failed | http://localhost:8888/admin/queues, queue `auth`, look for a failed `send-code` job |
| Every request answers 401 | No `Authorization: Bearer` header, or the token expired (15 minutes) | `meta.type` says which: `AUTH_TOKEN_MISSING`, `AUTH_TOKEN_EXPIRED`. Sign in again or call `/auth/refresh` |
| 429 on email-code | The code-email limits: one code email per address a minute and five an hour (shared with "forgot password"), ten an hour from one IP address | Wait (the `Retry-After` header says how long), or use another email address ([../auth/rate-limits.md](../auth/rate-limits.md)) |
| Hot reload does not restart the app on save | File events don't reach Docker on some setups | The compose file already polls; check `pnpm docker:logs` for a compile error |

More: [../../GETTING_STARTED.md](../../GETTING_STARTED.md#troubleshooting) and
[../auth/operations.md](../auth/operations.md).
