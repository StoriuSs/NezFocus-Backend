# Renovate: dependency updates

A project depends on hundreds of packages and a dozen Docker images, and each
of them releases new versions: bug fixes, security fixes, new features.
**Renovate** is a bot that watches all of them and opens pull requests that
update them. CI tests each pull request ([ci.md](./ci.md)); you read it and
merge it. Nothing changes on `main` without you.

This guide explains what you will see, the weekly routine, how to ask for a
major upgrade, and what each rule in `renovate.json` does.

- [What it costs](#what-it-costs)
- [What you will see](#what-you-will-see)
- [The weekly routine](#the-weekly-routine)
- [Major versions: on request](#major-versions-on-request)
- [Security fixes](#security-fixes)
- [The rules](#the-rules)
- [Where versions are written](#where-versions-are-written)
- [Common actions](#common-actions)
- [A new project](#a-new-project)
- [Turning it off](#turning-it-off)
- [When something looks wrong](#when-something-looks-wrong)

## What it costs

Renovate itself is free, for private repositories too: it runs on the servers
of Mend, the company behind it, not on your GitHub Actions minutes. Each pull
request it opens does run CI. A dependency change also builds and scans the
production image, as it changes what goes into it ([ci.md](./ci.md)), so its
run costs about as much as one on `main` — roughly 13 minutes of your 2,000 a
month, and merging it runs `main` again. With one grouped pull request a week,
that is roughly 100 minutes a month.

## What you will see

In the repository on GitHub:

- **An issue named "Dependency Dashboard"** (the **Issues** tab), kept up to
  date by Renovate. It lists every update: the pull requests open, the ones
  waiting for their schedule, and the major versions waiting for you to ask
  for them. Checkboxes in it are how you tell Renovate what to do.
- **Pull requests from `renovate[bot]`**, with the label `dependencies`:
  - **"Update all non-major dependencies"**, once a week, on Monday before 6 am
    (Vietnam time): every small update at once, in one pull request.
  - **Security fixes**, as soon as a fix exists, labelled `security`.
  - **"Lock file maintenance"**, once a month: refreshes the packages that
    your packages depend on, within the versions allowed.
  - **A major version**, only when you ask for it (below).

Each pull request's description lists every package it changes, with links to
their release notes, and badges showing how old the release is and how many
other projects updated without trouble.

## The weekly routine

On Monday, or whenever suits you:

1. Open the **"Update all non-major dependencies"** pull request.
2. Wait for CI (the ✓ or ✗ at the bottom of the pull request).
3. **Green ✓:** skim the list. A patch version (1.2.**3**) only fixes bugs; a
   minor version (1.**3**.0) adds features without breaking anything, by the
   rules of versioning. Click through to the release notes of anything you
   use heavily. Then **Merge pull request**.
4. **Red ✗:** open the failed job ([ci.md](./ci.md), "When a check fails").
   Usually one package in the group caused it. Either fix the code on the
   pull request's branch (it is a normal branch: `git fetch`, `git switch
   renovate/all-minor-patch`, fix, push), or hold that one package back
   ([below](#common-actions)) and let Renovate rebuild the group without it.

Merging publishes a new image, as any merge to `main` does. It doesn't deploy
it: run `./deploy.sh` on the server when you want the updates live.

If you skip a week, nothing breaks: the next Monday's pull request includes
everything since.

## Major versions: on request

A major version (**2**.0.0) may break things on purpose: renamed functions,
removed options, a new database format. Each one is a small project, so
Renovate doesn't open them by itself. They wait in the Dependency Dashboard,
under **"Pending Approval"**, each with a checkbox.

To do one: tick its checkbox. Within a few minutes Renovate opens its pull
request, labelled `major`. Read the package's migration guide (linked from
the release notes), make the changes it needs on that branch, and merge when
CI is green.

Some come with a warning in the pull request, because merging them alone does
damage:

| Major upgrade | Why it needs more than a merge |
|---|---|
| **Postgres** | The new server can't read the old data: dump the database, start the new version, restore ([backups.md](./backups.md)). Merging only the new image leaves Postgres unable to start. |
| **Grafana** | Grafana 13.2 used over 1 GB with these dashboards and was killed at the production memory limit ([monitoring.md](./monitoring.md), "Versions"). Measure it before merging. |
| **NestJS** | All `@nestjs/*` packages move together, in one pull request. Follow NestJS's migration guide; expect code changes. |
| **Node.js** | The Dockerfile, `.nvmrc` and `@types/node` move together. Choose an LTS version (even-numbered, marked LTS on nodejs.org). |

**Sign-in libraries: no warning, but test them.** Five packages carry the
auth module, and a major version of any of them can break sign-in without
breaking the build:

| Package | What it does here |
|---|---|
| `jose` | signs and checks access tokens (JWTs) |
| `openid-client` | Google sign-in |
| `@node-rs/argon2` | hashes passwords |
| `@nestjs-modules/mailer` | sends every email, sign-up and reset codes included |

A rule in `renovate.json` adds a note to their major pull requests saying
so. Before merging one, run the integration suites that exercise them, which
the pre-push hook does not run ([git-hooks.md](./git-hooks.md)):

```bash
pnpm test:services:up
pnpm test:integration -- auth oauth email
```

CI runs them too, so a red integration job on that pull request is the
signal.

## Security fixes

When a package you use has a published security hole and a fixed version
exists, Renovate opens a pull request for it **straight away**: not waiting
for Monday, and even for a major version. It carries the `security` label.
These are the ones to merge first.

Renovate learns about security holes from OSV, a public database, so nothing
needs turning on in GitHub.

## The rules

All of this is in `renovate.json`; each rule has a `description` saying what
it does. In short:

| Rule | Why |
|---|---|
| Minor and patch updates: grouped, weekly, Monday before 6 am | One pull request to check a week, instead of dozens |
| Not grouped: minor updates below 1.0 (0.x) | Before 1.0, a minor version may break things; each gets its own pull request |
| npm releases wait 3 days | A broken or malicious release is usually withdrawn within days |
| Major versions: on request | See above |
| Security fixes: immediately, majors included | They matter more than the schedule |
| Postgres, Grafana, NestJS, Node.js: warnings in the pull request | See the table above |
| GitHub Actions: one pull request, majors included | Updates to the actions CI uses rarely need changes here; CI tests them |
| The runner's Ubuntu version: on request | A new Ubuntu can change the tools CI finds installed |
| The overrides in `pnpm-workspace.yaml`: never a major | They fix a package within the version its parent asks for ([ci.md](./ci.md)) |
| Lock file maintenance: monthly | Refreshes the packages your packages use, which pick up fixes this way |

## Where versions are written

Renovate finds most versions by itself: `package.json`, `pnpm-lock.yaml`, the
Dockerfiles, the compose files, `.nvmrc`, and the workflow. That includes the
development-only images in `docker-compose.dev.yaml`, such as Mailpit
(`axllent/mailpit`, the email catcher) and RustFS (`rustfs/rustfs`, the local
S3): they are updated like the rest. `renovate.json`
teaches it three more places:

- the monitoring stack's compose files, `monitoring/compose/*.yaml`;
- images named inside commands: the `monitoring:check` and `alerts:test`
  scripts in `package.json`, `scripts/*.sh`, and the Trivy image in the
  workflow;
- the Postgres image given as a default in `docker-compose.prod.yaml`
  (`${BACKUP_POSTGRES_IMAGE:-postgres:…}`).

When an image appears in several files, Renovate updates all of them in the
same pull request. A test (`src/config/image-versions.spec.ts`) fails if two
files ever name different versions of the same image, or if the Dockerfile
and `.nvmrc` name different Node.js majors, so a missed file shows up in CI.

If you add an image somewhere new (another script, for example), check that
Renovate sees it: it is listed in the Dependency Dashboard, under "Detected
dependencies".

## Common actions

Most are done from the Dependency Dashboard or the pull request, with a
checkbox:

| To… | How |
|---|---|
| Get a pull request now, before its schedule | Dependency Dashboard → tick it under "Awaiting Schedule" |
| Get a major version | Dependency Dashboard → tick it under "Pending Approval" |
| Rebuild a pull request (after merging something else, or a conflict) | In the pull request's description, tick "If you want to rebase/retry this PR" |
| Skip a version | Close its pull request without merging. Renovate won't offer that version again, only a newer one. For a group, it skips all of the group's versions; to skip one package only, see the next row |
| Hold one package back | In `renovate.json`, add a rule: `{ "matchPackageNames": ["the-package"], "enabled": false }`, with a description of why, and remove it later |
| See everything Renovate knows | The Dependency Dashboard, "Detected dependencies" |

Don't edit a Renovate pull request's description: Renovate rewrites it. Its
branch is fine to push to; Renovate then stops changing that branch.

## A new project

The app is installed once for your GitHub account. For each new repository:

1. GitHub → your avatar → **Settings** → **Applications** → **Installed
   GitHub Apps** → **Renovate** → **Configure**.
2. **Repository access** → **Select repositories** → add the new repository
   → **Save**.

A project made from this starter already has `renovate.json`, so Renovate
starts with these rules; its first Dependency Dashboard appears within a
few hours. Change `timezone` in `renovate.json` if you are not in Vietnam's time
zone.

(Choosing **All repositories** there covers new repositories without this
step, but also every other repository you own: each would get a "Configure
Renovate" pull request.)

In the Mend developer portal (developer.mend.io, signed in with GitHub), the
repository's mode must be **Scan and Alert**. "Scan Only" makes Renovate
silent: no pull requests.

## Turning it off

| To… | How | Undo |
|---|---|---|
| Pause it | In `renovate.json`, add `"enabled": false`, and merge that to `main` | Remove the line |
| Stop it for one repository | Installed GitHub Apps → Renovate → Configure → remove the repository | Add it back |
| Remove it completely | Installed GitHub Apps → Renovate → **Uninstall** | Install it again from github.com/apps/renovate |

Don't delete `renovate.json` to stop it: while the app can see the
repository, Renovate then treats it as new and opens a "Configure Renovate"
pull request again. Stopping it doesn't close its open pull requests; close
them yourself.

## When something looks wrong

**No pull request appeared.** In order of likelihood: it is scheduled for
Monday morning; the release is less than 3 days old (npm); it is a major
version waiting for your tick; or Renovate already has 10 pull requests open
(it opens more as those close). The Dependency Dashboard says which.

**An issue "Action Required: Fix Renovate Configuration" appeared.**
`renovate.json` has a mistake, and Renovate stops until it is fixed. Check a
change before pushing it:

```bash
docker run --rm -v "$PWD/renovate.json:/usr/src/app/renovate.json:ro" -w /usr/src/app \
  --entrypoint renovate-config-validator ghcr.io/renovatebot/renovate:44 --strict
```

**CI fails on every Renovate pull request, for the same reason.** Probably
unrelated to the updates: check whether `main` itself is red.

**What Renovate did, and why:** the Mend developer portal
(developer.mend.io) shows each run's log for each repository.
