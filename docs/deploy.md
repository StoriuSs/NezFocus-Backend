# Deploying

`./deploy.sh` puts a new version of the app live on the server, checks that it
is healthy, and puts the previous version back if it isn't.

```
./deploy.sh                    # deploy the latest commit of the current branch
./deploy.sh --rollback         # go back to the previous version
./deploy.sh --rollback <tag>   # go back to a specific version
./deploy.sh --list             # which versions exist, which one is live
./deploy.sh --help             # every option
```

## How it works

### Releases: one image per commit

The app is packaged as a Docker image. Every deploy builds (or downloads) the
image for the commit being deployed and labels it with the first 12 characters
of the commit ID, e.g. `hexagonal-auth-prod-app:3f9c2a1b7d4e`. That labelled image is
a **release**.

Because each release has its own label, deploying a new one doesn't destroy the
old one. The last few stay on the server (3 by default), ready to start again.

### A deploy, step by step

1. **Checks.** The working tree must be clean: a release is labelled with its
   commit, and an image built from uncommitted changes wouldn't match its label.
2. **Pull** the branch (`git pull --ff-only`).
3. **Get the images**: build the app's image for the commit, or download it from a
   registry (see [Where images come from](#where-images-come-from)); build the
   small backup image; and pull any other service's image that isn't on the
   server yet. A registry that can't be reached stops the deploy here.
4. **Check the environment**: the new image checks `.env.production`, as compose
   passes it to the app, against its own configuration rules
   ([environment.md](./environment.md#checking-a-file)). A missing or invalid
   value stops the deploy here, before migrations, with nothing changed. Keys
   nothing reads, keys set twice, keys compose overrides and values with a `$`
   are warned about but don't stop it. The live release is checked too: if the
   env file no longer suits it, you're warned that an automatic rollback would
   fail.
5. **Migrate the database** with the new image — once, before anything is
   switched. If the release adds migrations (compared by folder name, so a
   renamed or squashed migration counts), the databases are
   [backed up](./backups.md) first (`--skip-backup` to skip); a failed backup
   stops the deploy. If a migration fails, the deploy stops here and the live
   version keeps running untouched.
6. **Switch**: recreate the app container from the new image. An error from
   another service here (a monitoring port already taken) is reported but
   doesn't fail the release; the health of the services below decides.
7. **Wait until healthy**: the database, Redis and the app must all
   pass their healthchecks. All of them are checked on every round, so a
   container that exits, restarts or turns unhealthy fails the deploy at once,
   even while another service is still starting; otherwise the wait lasts up
   to `DEPLOY_HEALTH_TIMEOUT` (600s — a first start pulls images and migrates).
8. **Healthy**: the release is recorded as live. The images of the last
   `DEPLOY_KEEP_IMAGES` releases stay; older ones, and images of failed
   deploys, are removed.
   **Not healthy**: the logs of the failing service are printed, the previous
   release is started again, and the script exits with an error. The site stays
   up on the old version; fix the problem and deploy again.

Every deploy that gets past the pull is written to `.deploy/history.log`,
including ones that stopped before switching, and so is every rollback that
got as far as starting its release. (A deploy refused earlier — uncommitted
changes, a failed pull — isn't, and neither is one interrupted with Ctrl-C,
nor a rollback refused before it started anything.) Only one deploy can run at a time; a second one
stops with a message. The lock is released when the script ends, however it
ends.

The script updates itself with `git pull`; a deploy always finishes with the
version of the script it started with.

**Requirements on the server**: bash, git, flock (util-linux, installed on every
common Linux distribution), and Docker Engine 25 or newer with the
compose plugin (the healthchecks use `start_interval`).

**The server itself** — security updates, fail2ban, swap, SSH, the firewall —
is [server.md](./server.md). Worth half an hour before the first deploy.

### Rollback

`./deploy.sh --rollback` starts the release that was live before the current
one — no build, so it takes seconds. If that release doesn't become healthy,
the one that was live is started again. `./deploy.sh --list` shows the
releases on this server; `./deploy.sh --rollback <tag>` picks one. Rolling back
twice returns to where you started.

A rollback checks the environment against the target release first: if
`.env.production` has since changed in a way that release can't start with, it
stops before touching the live one. (Releases older than the check start
without one.)

In `build` mode a release whose image was already pruned can't be started
again; build that commit instead: `git checkout <tag> && ./deploy.sh --no-pull`,
then `git switch <branch>` so later deploys can pull again. That runs the
`deploy.sh` and compose file of that commit, not the current ones. In
`registry` mode it is downloaded again.

A rollback swaps the **image**, not the files in this checkout. If the release
you are rolling back from changed `docker-compose.prod.yaml` — a wrong address,
a service that can't start — the previous image runs with that same broken
file, and the rollback fails too. Go back to the commit instead, which brings
its own compose file with it:
`git checkout <tag> && ./deploy.sh --no-pull`.

Rollback swaps the **code**, not the **database**. See the next section.

## Database migrations and rollback

Rolling back cannot undo a migration. After a rollback the older code runs
against the newer schema, so every migration must keep the previous release
working. The rule is **expand, then contract** — change the schema in two
deploys:

| Change | Deploy 1 (expand) | Deploy 2 (contract), once deploy 1 is stable |
|---|---|---|
| Rename a column | Add the new column; write to both, read the new one | Drop the old column |
| Remove a column | Stop using it in the code | Drop it |
| Make a column required | Add it as optional; fill it in | Make it `NOT NULL` |

Adding a table or an optional column is safe in one deploy.

When a rollback crosses migrations, the script lists them (if a commit isn't in
the server's git clone, it says it can't tell):

```
⚠ Release 3f9c2a1b7d4e applied migrations that 8e21d0c4a9b3 doesn't know about:
    20260915000100_add_display_color
⚠ Rolling back the code does not undo them. 8e21d0c4a9b3 must work with the newer schema (see docs/deploy.md).
```

### When a migration fails

Postgres runs each migration in a transaction, so a failed migration leaves the
schema unchanged — but Prisma records it as failed and refuses to apply anything
until you say what happened. After fixing or removing the migration in the code:

```
docker compose --env-file .env.production -f docker-compose.prod.yaml run --rm app \
    ./node_modules/.bin/prisma migrate resolve --rolled-back <migration_name>
./deploy.sh
```

## Where images come from

Set in `.env.production` on the server:

```
DEPLOY_IMAGE_SOURCE=build          # default
# or
DEPLOY_IMAGE_SOURCE=registry
DEPLOY_IMAGE=ghcr.io/you/your-app
```

Everything else — releases, migrations, health, rollback — is identical.

### `build`: the server builds the image

The simplest setup: nothing but the server and git. The cost is that every
deploy compiles the app on the server, which takes minutes, needs spare memory
(a 1 GB server can run out mid-build) and competes with the running app for
CPU.

`--skip-build` redeploys the commit's existing image without building it, e.g.
after changing only `.env.production`.

### Changing a setting

The app reads `.env.production` when its container is created, so an edit
takes effect at the next deploy: `./deploy.sh --skip-build` in `build` mode,
or `./deploy.sh --no-pull` to redeploy the live commit in `registry` mode. The
environment check runs first, so a bad value stops there with nothing changed.

One setting needs a step before the deploy: **`BASE_URL`**. Register the new
Google redirect URI first, if Google sign-in is on; every access token is
refused once after the change, and the web app refreshes it.

### Running a command on the server

The command-line tools run inside the app's container, compiled, with the
production environment. Always pass `--env-file .env.production`: compose
fills in the compose file's `${...}` from it, and refuses to run anything,
`exec` included, without `REDIS_PASSWORD` and the other required values.

```bash
# Make someone an administrator (pnpm user:promote)
docker compose --env-file .env.production -f docker-compose.prod.yaml exec app \
    node dist/src/bootstrap/user-roles.js you@example.com
```

What each does, and when: [auth/operations.md](./auth/operations.md).

### `registry`: CI builds, the server downloads

(The backup service's small image is still built on the server, in seconds.)

CI builds and tests the image on every push to `main` and publishes it to a
registry as `DEPLOY_IMAGE:<12-character commit>`: the GitHub Actions workflow
in this repository does, to GitHub Container Registry ([ci.md](./ci.md)). A
branch that changes what goes into the image has it built and tested too, but
only `main` publishes one, so deploy commits that are on `main`. The deploy downloads
that image instead of building. Deploys are faster, the server needs no build
headroom, and what runs is exactly what CI tested. Older releases stay in the
registry, so you can roll back even to one already removed from the server.

Setup on the server, once:

1. Log in to the registry. For GitHub Container Registry, create a personal
   access token with the `read:packages` scope, then:
   ```
   echo <token> | docker login ghcr.io -u <github-username> --password-stdin
   ```
2. In `.env.production`: `DEPLOY_IMAGE_SOURCE=registry` and
   `DEPLOY_IMAGE=ghcr.io/<owner>/<image>`. With this repository's workflow the
   image is named after the repository, in lower case:
   `ghcr.io/<owner>/<repository>`.

If CI hasn't published the commit yet (still running, or failed), the deploy
stops before changing anything:

```
✗ Could not pull ghcr.io/you/your-app:3f9c2a1b7d4e. Has CI finished publishing commit 3f9c2a1b7d4e? Is this server logged in to the registry (docker login)? Nothing was changed.
```

The token belongs to your GitHub account: if it expires or is revoked, deploys
fail until you log in again with a new one.

## The Deploy button

`./deploy.sh` on the server is the whole deploy. The button is a way to run it
without opening a terminal: **Actions** → **Deploy** → **Run workflow**, choose
`deploy` or `rollback`, and GitHub logs in to your server over SSH and runs it
there. Nothing deploys by itself — a push to `main` only builds and publishes
the image ([ci.md](./ci.md)).

**What it needs**, once, under the repository's **Settings** →
**Secrets and variables** → **Actions**:

| | Name | Value |
|---|---|---|
| Secret | `DEPLOY_SSH_KEY` | A private key that may log in to the server. Make a new one for this, not your own: `ssh-keygen -t ed25519 -f deploy_key -N ""`, then add `deploy_key.pub` to `~/.ssh/authorized_keys` on the server and paste the contents of `deploy_key` here |
| Variable | `DEPLOY_HOST` | The server's address |
| Variable | `DEPLOY_USER` | The user to log in as, e.g. `ubuntu` |
| Variable | `DEPLOY_PATH` | Where this repository is checked out there, e.g. `/home/ubuntu/nest` |
| Variable | `DEPLOY_HOST_KEY` | The server's own host key, so the runner knows it is really your server: `ssh-keyscan -t ed25519 <address>` prints it; use the part from `ssh-ed25519` onwards |

With any of them missing the run stops at the first step and names what to add.

**The server must accept SSH from GitHub.** Runners have no fixed address, so
a firewall that only allows SSH from your own address will refuse them. Either
allow port 22 from anywhere — the server accepts keys only, never passwords,
which is how it is set up here — or keep it closed and deploy from your own
terminal, which needs no button at all. GitHub publishes the address ranges its
runners use (`https://api.github.com/meta`, the `actions` list) if you would
rather allow only those, but the list changes and has to be kept up to date.

**Rolling back** uses the same button: choose `rollback`, and leave the tag
empty for the previous release or give a 12-character commit to go further
back. It runs `./deploy.sh --rollback` on the server, with everything that
means above — the release must still have an image, and the environment file
must still suit it.

**What you see**: the deploy's own output, live, in the run's log — the same
lines `./deploy.sh` prints in a terminal, including which release went live
and any rollback. One deploy runs at a time; a second run waits.

## Options and settings

| Option | |
|---|---|
| `--no-pull` | Deploy the commit that is checked out, without pulling. Also for a detached HEAD. |
| `--skip-build` | `build` mode: reuse the image already built for this commit. |
| `--skip-migrate` | Don't run migrations. |
| `--skip-backup` | Don't back up the databases before applying new migrations. |
| `--allow-dirty` | Deploy despite uncommitted changes. Without a terminal the script refuses rather than asks. |
| `--reload-nginx` | Validate and reload the host's nginx afterwards. Only needed after changing the nginx config: a normal deploy keeps the same ports. |

| `.env.production` | Default | |
|---|---|---|
| `DEPLOY_IMAGE_SOURCE` | `build` | `build` or `registry` |
| `DEPLOY_IMAGE` | `hexagonal-auth-prod-app` | Image name; the registry path in `registry` mode |
| `DEPLOY_KEEP_IMAGES` | `3` | Releases whose images stay on the server, the live one included. In `build` mode you can only roll back to these, so it must be 2 or more. |
| `DEPLOY_HEALTH_TIMEOUT` | `600` | Seconds to wait for services to become healthy |

State is kept in `.deploy/` (gitignored): `releases` (live release last),
`history.log` (deploys and rollbacks, with the result) and `deploy.lock`.

## Downtime during a deploy

The switch recreates the app container, so while the new version starts, nginx
has nothing to forward to and visitors get a 502. On a development machine that
gap measured about 2–3 seconds; on a small server allow up to 10–20. Builds,
downloads and migrations happen before the switch and don't add to it. For most
projects this is acceptable, especially when deploying at a quiet time.

Avoiding it needs **blue/green** deploys: start the new version next to the old
one on another port, wait until it is healthy, point nginx at it, then stop the
old one. That isn't built in. Options if it ever matters:

- **Kamal** (kamal-deploy.org) does blue/green on plain servers with its own
  small proxy in front of the containers.
- **Managed platforms** do it for you: on AWS, ECS behind an Application Load
  Balancer runs rolling or blue/green deploys with automatic rollback. It costs
  more (the load balancer alone is roughly $16/month) and takes more setup.

Either way the database rule above still applies: during a zero-downtime
deploy, old and new code run against the same database at the same time.
