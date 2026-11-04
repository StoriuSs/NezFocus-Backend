# CI: what happens after you push

This guide assumes you have never used CI. It explains what happens on
GitHub after `git push`, where to see it, what each check means, what to do
when one fails, and how the result reaches your server. Words in *italics*
are in the [glossary](#glossary) at the end.

- [What CI is](#what-ci-is)
- [What runs, and when](#what-runs-and-when)
- [Seeing the result](#seeing-the-result)
- [The checks, one by one](#the-checks-one-by-one)
- [The production image](#the-production-image)
- [Running it by hand](#running-it-by-hand)
- [When a check fails](#when-a-check-fails)
- [The free minutes](#the-free-minutes)
- [Turning it off](#turning-it-off)
- [What CI doesn't do](#what-ci-doesnt-do)
- [Where it is configured](#where-it-is-configured)
- [Glossary](#glossary)

## What CI is

**CI (continuous integration)** means a computer re-checks the project every
time you push, without you asking. GitHub's service for this is called
**GitHub Actions**. On each push it:

1. borrows a fresh Linux machine (a *runner*) that has never seen your
   project;
2. downloads your code and installs everything from scratch, the way a new
   developer would after cloning;
3. runs the tests and checks;
4. marks the commit with ✓ (all passed) or ✗ (something failed).

Why bother, when the tests pass on your machine? Your machine has things a
fresh one doesn't: files you forgot to commit, a database already set up, an
old version of a package. CI catches "works on my machine". It also runs the
slow checks you wouldn't run by hand before every push, and it builds the
exact package your server will run.

Nothing needs setting up: the instructions are in the repository
(`.github/workflows/ci.yml`), and GitHub reads them on every push.

## What runs, and when

| You… | CI runs | Takes |
|---|---|---|
| push to `main` | every check, then builds, tests and **publishes** the production image | about 8 minutes |
| push to any other branch | the checks only | about 2½ minutes |
| push to a branch that changes the Dockerfile, a dependency or a migration | the checks and the image: built, started and scanned, not published | about 8 minutes |
| push to a branch where only documentation differs from `main` (`docs/`, `.md` files) | nothing (a few seconds to notice) | seconds |
| click **Run workflow** (below) | everything, on the branch you pick; publishes only from `main` | about 8 minutes |
| open a pull request from a fork | the checks | about 2½ minutes |

A pull request from a branch of this repository runs nothing extra: that
branch's pushes are already checked.

A branch is compared with `main`, not with its own previous push: a
documentation commit pushed after code whose run was cancelled still runs the
checks, over everything the branch changes.

If you push twice quickly to the same branch, the first run is cancelled, as
only the newest commit matters. On `main` nothing is cancelled: each commit
is its own run, and gets its own image.

```
git push
   │
   ▼
What changed ──── only docs differ from main ──▶ stop
   │
   ▼
┌────────────────────────── in parallel ───────────────────────────┐
│ Lint, types,      Integration tests   Monitoring      Dependency │
│ unit & e2e tests  and migrations      configuration   advisories │
└──────────────────────────────────────────────────────────────────┘
   │ (all but the advisories must pass; main, Run workflow, or a branch
   │  that changes the Dockerfile, a dependency or a migration)
   ▼
Production image: build → start it → scan it → publish (main only)
```

## Seeing the result

**On a commit:** on GitHub, open the repository. Next to the latest commit
(above the file list) is a yellow dot (running), a green ✓ or a red ✗. Click
it for the list of jobs.

**All runs:** the **Actions** tab at the top of the repository. Each row is
one run: the commit message, the branch, how long it took.

**Inside a run:**

1. Click the run. The page shows each *job* as a box, with a ✓, ✗, or a
   grey ⊘ (skipped: not needed this time).
2. Click a job to see its *steps*.
3. Click a step to open its log: exactly what the command printed. A failed
   step opens by itself.
4. Grey boxes under "Annotations" are notes the workflow left, such as
   "Checks skipped: only documentation changed".

GitHub also emails you when a run you started fails (your GitHub account →
Settings → Notifications, "Actions").

## The checks, one by one

Every check is a command you can run yourself, from the project folder.

**Lint, types, unit and e2e tests** (about 2 minutes)

| Check | Catches | Yourself |
|---|---|---|
| Lint (ESLint) | Code mistakes a program can spot: unused variables, a forgotten `await` | `pnpm lint` |
| Format (Prettier) | Code not laid out the house way | `pnpm format:check` (`pnpm format` fixes it) |
| Types (TypeScript) | A value used as the wrong type, in the app and the tests | `pnpm exec tsc --noEmit` |
| Unit tests | A piece of logic that no longer does what its test says | `pnpm test` |
| e2e tests | The HTTP API answering wrong: status codes, response shapes | `pnpm test:e2e` |
| OpenAPI | `openapi.json` (the API's description, which the frontend's types come from) out of date | `pnpm openapi:check` |
| Env check | `.env.example` missing a setting the app needs | `pnpm env:check` |

Before these run, CI copies `.env.example` to `.env.development`, the first
thing a new developer does. So `.env.example` has to stay complete.

**Integration tests and migrations** (about 1 minute)

| Check | Catches | Yourself |
|---|---|---|
| Integration tests | Code that works alone but not with the real Postgres, Redis, S3 storage or email server. The sign-in suites run against a small fake Google (an OpenID Connect issuer, `test/integration/fake-oidc-issuer.ts`) and a stand-in for Cloudflare's Turnstile check, so they need no outside account | `pnpm test:services:up`, then `pnpm test:integration` |
| Migrations | The database schema (`prisma/`) changed without a migration, so production's database would not match the code | `pnpm prisma:check` ([below](#the-migrations)) |

**Monitoring configuration** (about 30 seconds): the configuration of
Prometheus, Alloy (the collector), Loki and Alertmanager is valid,
and every alert rule passes its tests. Yourself: `pnpm monitoring:check`
(needs Docker).

**Dependency advisories** (about 10 seconds): none of the packages the app
ships has a known security hole rated high or critical. The list of known
holes (*advisories*) is public and grows every day, so this check can fail
on a day you changed nothing. Yourself: `pnpm audit --prod --audit-level high`.

## The production image

An **image** is your app packed with everything it needs to run: Node, the
packages, the compiled code. The server runs the image. (`docker build`
makes one; this is the same thing, done by CI.)

After the checks pass, CI:

1. **builds** the image, on the newest version of its base (Node on Alpine
   Linux), so security fixes to the base arrive with every build;
2. **starts** it the way the server would, with a throwaway database and
   Redis, and waits until the app says it is ready (`/health/ready`). This
   catches an app that builds but crashes on start: a missing setting, a
   broken migration;
3. **scans** it with **Trivy**, a security scanner that checks every system
   package and npm package inside the image against public lists of known
   security holes. It fails only for high or critical holes that already
   have a fix: those you can do something about;
4. **publishes** it to **GHCR** (GitHub Container Registry), GitHub's storage
   for images.

Steps 1 to 3 also run on a branch that changes what goes into the image —
the Dockerfile, `package.json`, the lockfile, `pnpm-workspace.yaml`, the
Node version or a migration — so a base image or dependency update (most of
Renovate's) is built, started and scanned before you merge it. Step 4,
publishing, happens only from `main`.

**Where the images are:** your GitHub profile → **Packages** tab (also linked
from the repository page, right column, "Packages"). Open the package to see
every published version. Each one's *tag* is the first 12 characters of its
commit, e.g. `ghcr.io/your-org/your-repo:a617abedcd2b` (the repository's owner and name, in lower case). The
package is private, like the repository.

**How it reaches the server:** with `DEPLOY_IMAGE_SOURCE=registry` in the
server's `.env.production`, `./deploy.sh` downloads the image of the commit
it deploys instead of building it on the server ([deploy.md](./deploy.md),
"`registry`"). What runs is exactly what CI tested. If CI hasn't published
that commit (still running, or it failed), the deploy stops before changing
anything.

**Trying an image on your own machine:**

```powershell
gh auth refresh -s read:packages            # once: lets the GitHub CLI read packages
gh auth token | docker login ghcr.io -u <your GitHub username> --password-stdin
docker pull ghcr.io/<owner>/<repository>:<12-character commit>
```

Old images are never deleted automatically. To delete some: the package page
→ Package settings, or a version's ⋯ menu.

## Running it by hand

A push to a branch doesn't build the image, to save minutes. To check the
image on a branch anyway, for example after changing the `Dockerfile` or the
dependencies:

1. **Actions** tab → **CI** in the left column.
2. **Run workflow** (right side) → choose the branch → **Run workflow**.

It runs everything. From `main` it also publishes; from another branch it
only checks.

The button appears only once `.github/workflows/ci.yml` is on `main`: GitHub
reads manual workflows from the default branch.

## When a check fails

1. Open the failed run (the red ✗ on the commit, or the Actions tab).
2. Click the job with the ✗, then the step with the ✗. The end of its log
   says what went wrong.
3. Run the same command locally (the tables above), fix, commit, push. The
   new push starts a new run.

If a run failed because of GitHub itself (a download that timed out, a
runner that died), the run page has **Re-run jobs** → **Re-run failed jobs**.
On `main`, do that: the image job waits for the other checks, so the commit
has no image until they pass.

The most common one is Docker Hub not answering in time ("context deadline
exceeded" or "Client.Timeout exceeded" while downloading an image). The
images the checks start (Postgres, Redis, RustFS, Mailpit, the monitoring
tools, the scanner) are downloaded first by `scripts/pull-images.sh`, which
tries each one four times over about a minute and a half. The image build
downloads its own base images (`node`, `alpine`) itself, without retrying,
so a build step can still fail this way; re-run it.

### Per check

**Lint or format:** `pnpm lint:fix` and `pnpm format` fix most of it. The
pre-commit hook normally catches these before they reach CI.

**Types or tests:** the log shows the file, the line and the expectation that
failed, exactly as locally.

**OpenAPI:** the committed `openapi.json` is behind the code. Run
`pnpm openapi:export` and commit the file ([openapi.md](./openapi.md)).

**Env check:** a setting was added to the configuration but not to
`.env.example`. Add it there, with a comment saying what it is.

#### The migrations

`pnpm prisma:check` fails when a model in `prisma/` changed but no migration
records the change. The log lists the difference (e.g. "Added column
`nickname`"). Create the migration: `pnpm prisma:migrate`, then commit the new
folder under `prisma/migrations/`.

To run the check locally it needs an empty scratch database. Create one named
`shadow` in the dev Postgres (for example with `docker exec`, or any database
tool), and add to `.env.development`:

```bash
SHADOW_DATABASE_URL=postgresql://<DB_USERNAME>:<DB_PASSWORD>@localhost:<DB_PORT>/shadow
```

Each run wipes what that database holds, so never point it at a real one.

**Dependency advisories:** `pnpm audit --prod --audit-level high` names the
package and the version that fixes it.

1. A package listed in `package.json`: update it
   (`pnpm add <package>@^<fixed version>`) and run the tests.
2. A package pulled in by another one: `pnpm why <package>` shows which. Update
   that one first. If no release of it has the fix yet, add an *override* in
   `pnpm-workspace.yaml`, staying within the major version it asks for, with a
   comment saying why. There are examples there. Remove it once the parent
   catches up.

The image doesn't wait for this check: a newly published hole shouldn't block
an urgent fix. It stays red until dealt with.

**The image start ("Starts, migrates, and reaches Postgres and Redis"):** the
step prints the end of the app's log. Usually a setting production refuses,
added to the schema but not to `.env.example`.

**The image scan:** Trivy lists each hole with its package and fixed version.

- A package of the base image (Alpine or Node): usually fixed by the next
  build, which downloads the newest base. If the base hasn't published the
  fix yet, wait, or move the `Dockerfile` to a newer version of it.
- An npm package: as for the advisories above.
- A hole that doesn't affect you (the vulnerable part is never used): add its
  ID (e.g. `CVE-2026-12345`) to a file named `.trivyignore` at the root of
  the repository, one per line, with a comment saying why and when to look
  again.

## The free minutes

GitHub gives a free account **2,000 minutes a month** of runners for private
repositories, shared by all of your repositories. Public repositories are
free and unlimited.

Minutes are counted per job, each rounded up to a whole minute, so one run
counts more than it takes:

| Run | Takes | Counts |
|---|---|---|
| Push to `main` | about 8 minutes | about 13 minutes |
| Push to a branch | about 2½ minutes | about 7 minutes |
| Documentation only, on a branch | seconds | 1 minute |

This workflow saves minutes by:

- **caching**: the packages, the image's build layers and Trivy's database
  are downloaded once and reused;
- **skipping documentation**: a branch push that changes only `docs/` or
  `.md` files runs no checks;
- **building the image only on `main`**, when you click Run workflow, or on a
  branch that changes what goes into it;
- **cancelling** a branch's older run when you push again.

Usage so far: your GitHub account → Settings → **Billing and licensing**. If
the minutes run out, new runs fail to start until the next month begins
(or until you add a payment method and a budget); nothing else breaks.

## Turning it off

Nothing in the env files controls CI: GitHub runs whatever is in
`.github/workflows/`. To stop it:

| To… | How | Undo |
|---|---|---|
| Pause this workflow, keeping the file | **Actions** tab → **CI** (left column) → **⋯** (top right) → **Disable workflow** | The same menu → **Enable workflow** |
| Turn off Actions for the whole repository | **Settings** → **Actions** → **General** → *Actions permissions* → **Disable actions** → **Save** | Choose "Allow all actions…" again |
| Skip CI for one push | Put `[skip ci]` in the commit message | — |
| Remove it | Delete `.github/workflows/ci.yml` and commit | Restore the file |

While CI is off, nothing publishes images: `deploy.sh` in `registry` mode
then has nothing to download, so deploy with `DEPLOY_IMAGE_SOURCE=build`
([deploy.md](./deploy.md)).

## What CI doesn't do

- **Deploy.** CI publishes the image; you deploy it with `./deploy.sh` on the
  server ([deploy.md](./deploy.md)). Deploying automatically after CI is
  *CD* (continuous deployment), not set up here.
- **Test `deploy.sh` and the backups.** Nothing here starts a production
  stack, deploys to it or restores a dump. After changing either, try them on
  a server you can throw away ([deploy.md](./deploy.md),
  [backups.md](./backups.md)).
- **Test the frontend.** Its sign-in and profile flows are tested in the
  React repository.

## Where it is configured

Everything is in `.github/workflows/ci.yml`, with a comment on each part.
Change it like any file: edit, commit, push. The next run uses the new
version.

Nothing is needed in the repository's settings: the workflow uses the
temporary key GitHub gives every run, which may publish to this repository's
packages. Actions are on by default (Settings → Actions → General).
Creating the repository from the template, the package's visibility, and the
token the server uses to pull images are in [setup/github.md](./setup/github.md).

## Glossary

| Word | Meaning |
|---|---|
| **Workflow** | The instructions: `.github/workflows/ci.yml`. |
| **Run** | One execution of the workflow, for one commit. |
| **Job** | A group of steps with its own runner. The jobs of a run go in parallel unless one waits for another. |
| **Step** | One command or action inside a job. |
| **Runner** | The fresh Linux machine GitHub lends for a job, deleted afterwards. |
| **Image** | The app packed with everything it needs to run, what the server starts. |
| **Tag** | The name of one version of an image; here, the commit it was built from. |
| **Registry** | Storage for images. GHCR is GitHub's; Docker Hub is another. |
| **Advisory / CVE** | A published security hole in a package version. CVE IDs look like `CVE-2026-12345`. |
| **Override** | A rule in `pnpm-workspace.yaml` forcing a package pulled in by another one to a fixed version. |
| **Migration** | A file of SQL changes that brings a database from one version of the schema to the next. |
| **Smoke test** | Starting the finished thing and checking it answers: not everything, just "does it catch fire". |
| **CD** | Continuous deployment: CI's result is put on the server automatically. |
