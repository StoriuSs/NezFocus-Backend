# GitHub

**What it is for here.** Beyond holding the code, GitHub does four jobs for the
starter:

- **CI** (GitHub Actions): on every push it installs everything from scratch and
  runs the checks and tests; on `main` it also builds the production image and
  publishes it ([../ci.md](../ci.md)).
- **The image registry** (GHCR, GitHub Container Registry): stores those
  images, so the server can download a tested image instead of building one
  ([../deploy.md](../deploy.md#where-images-come-from)).
- **The Deploy button**: a workflow that logs in to your server over SSH and
  runs `./deploy.sh` there ([../deploy.md](../deploy.md#the-deploy-button)).
- **Renovate**: a bot that opens pull requests to update the dependencies
  ([../renovate.md](../renovate.md)).

**Do you need it?** CI needs nothing from you: it runs as soon as the code is on
GitHub. The rest is optional, but the server needs a way to **clone** the
repository if it is private (section 4).

**Cost.** Public repositories: free. Private: 2,000 Actions minutes a month on a
free account, shared by all your repositories. A push to `main` counts about 13
minutes, a branch push about 7 ([../ci.md](../ci.md#the-free-minutes)). GHCR
storage for private images has a free allowance; old images are not deleted
automatically. Renovate is free.

- [1. Your own repository](#1-your-own-repository)
- [2. Actions](#2-actions)
- [3. Secrets and variables](#3-secrets-and-variables)
- [4. Let the server clone the repository](#4-let-the-server-clone-the-repository)
- [5. Let the server download the image](#5-let-the-server-download-the-image)
- [6. The Deploy button](#6-the-deploy-button)
- [7. Renovate](#7-renovate)
- [Check it works](#check-it-works)
- [Common mistakes](#common-mistakes)

## 1. Your own repository

If the starter's repository page shows a green **Use this template** button:
**Use this template → Create a new repository**, choose the owner, a name,
**Private**, **Create repository**. Then clone yours.

Otherwise, make an empty repository and push the starter into it:

1. On GitHub: **+** (top right) → **New repository** → a name → **Private** →
   leave "Add a README", ".gitignore" and "license" **off** (the repository must
   be empty) → **Create repository**.
2. On your machine, in your clone of the starter:

   ```bash
   git remote rename origin starter      # keep the starter, to compare or pull fixes later
   git remote add origin git@github.com:<your-org>/<your-repository>.git
   git push -u origin main
   ```

   To start without the starter's history instead: [../making-it-yours.md](../making-it-yours.md).

Do the same for the web app (the `React-Starter-No-Keycloak` repository) if you
use it. Each repository has its own Actions, secrets and variables.

## 2. Actions

GitHub Actions is on by default, and `.github/workflows/ci.yml` runs on the
first push. To check:

1. The repository's **Settings → Actions → General**.
2. **Actions permissions**: **Allow all actions and reusable workflows** →
   **Save** if you changed it.
3. **Workflow permissions** can stay on the default (read-only). The image job
   asks for permission to publish packages itself (`packages: write` in
   `ci.yml`), using the temporary token GitHub gives every run (`GITHUB_TOKEN`).
   You create no token for CI.

If the repository was made as a **fork**, the **Actions** tab first shows "I
understand my workflows, go ahead and enable them": click it.

What each check does, and what to do when one fails: [../ci.md](../ci.md).

## 3. Secrets and variables

Some workflows need values from you. GitHub keeps them per repository:

- a **secret** is hidden once saved and masked in logs: keys and tokens;
- a **variable** is plain text, visible to anyone with access: addresses, names.

To add one: the repository's **Settings** → in the left column under
**Security**, **Secrets and variables → Actions** →

- **Secrets** tab → **New repository secret** → **Name** and **Secret** →
  **Add secret**;
- **Variables** tab → **New repository variable** → **Name** and **Value** →
  **Add variable**.

**Every value the workflows read:**

| Repository | Kind | Name | Read by | Needed for | Value |
|---|---|---|---|---|---|
| API (this one) | built in | `GITHUB_TOKEN` | `ci.yml` | Publishing the image | Nothing to set |
| API | Secret | `DEPLOY_SSH_KEY` | `deploy.yml` | The Deploy button | A private key that may log in to the server (section 6) |
| API | Variable | `DEPLOY_HOST` | `deploy.yml` | The Deploy button | The server's IP address |
| API | Variable | `DEPLOY_USER` | `deploy.yml` | The Deploy button | The user to log in as, e.g. `ubuntu` |
| API | Variable | `DEPLOY_PATH` | `deploy.yml` | The Deploy button | Where the repository is cloned on the server, e.g. `/home/ubuntu/nest` |
| API | Variable | `DEPLOY_HOST_KEY` | `deploy.yml` | The Deploy button | The server's host key, `ssh-ed25519 AAAA...` (section 6) |
| Web app | Secret, Variables | `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH`, `DEPLOY_HOST_KEY` | its `deploy.yml` | Its Deploy button | The same, with its own `DEPLOY_PATH` (e.g. `/home/ubuntu/web`) |
| Web app | Variable | `SENTRY_ORG` | its `ci.yml` | Source maps in Sentry (optional) | The Sentry organization slug ([sentry.md](./sentry.md#4-source-maps-for-the-web-app-optional)) |
| Web app | Variable | `SENTRY_PROJECT` | its `ci.yml` | Source maps (optional) | The web Sentry project's slug |
| Web app | Secret | `SENTRY_AUTH_TOKEN` | its `ci.yml` | Source maps (optional) | A Sentry organization token, `sntrys_...` |

The API's CI reads no secret of yours: its tests run against throwaway
services, never your real providers.

## 4. Let the server clone the repository

**Public repository:** nothing to do; clone with
`git clone https://github.com/<your-org>/<your-repository>.git`.

**Private repository:** give the server a **deploy key**: an SSH key that may
read this one repository and nothing else. If the server is taken over, the
attacker gets read access to one repository, not your account. GitHub refuses
the same deploy key on two repositories, so make one per repository.

On the server, as the user that will run deploys:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/nest_deploy -N "" -C "server: nest"
cat ~/.ssh/nest_deploy.pub          # copy this line
```

On GitHub, in the API repository: **Settings → Deploy keys → Add deploy key** →
**Title** `server` → **Key**: paste the line → leave **Allow write access**
unticked → **Add key**.

Back on the server, tell SSH to use that key for this repository, under a name
of its own (`github-nest`):

```bash
cat >> ~/.ssh/config <<'EOF'
Host github-nest
  HostName github.com
  User git
  IdentityFile ~/.ssh/nest_deploy
  IdentitiesOnly yes
EOF
ssh -T git@github-nest
```

The first `ssh -T` asks whether to trust github.com and shows its fingerprint.
Compare it with [GitHub's published fingerprints](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints)
(for ED25519: `SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU`), then answer
`yes`. It ends with "Hi <your-org>/<your-repository>! You've successfully
authenticated, but GitHub does not provide shell access." That is success.

Then clone with the alias:

```bash
git clone git@github-nest:<your-org>/<your-repository>.git ~/nest
```

`deploy.sh` runs `git pull` with that same address, so it keeps working. For
the web app, repeat with `web_deploy` and a `github-web` alias.

## 5. Let the server download the image

Only for `DEPLOY_IMAGE_SOURCE=registry`, where CI builds the image and the
server downloads it (faster deploys, no build on a small server, and exactly
what CI tested). Skip this with the default `build`.

**The image.** The first push to `main` that passes CI publishes
`ghcr.io/<owner>/<repository>`, all lower case, tagged with the first 12
characters of each commit. It is **private**, like the repository, and linked
to it. Find it under your profile → **Packages**, or in the repository's right
column → **Packages**.

**A token for the server.** GHCR accepts only a **classic** personal access
token for this; fine-grained tokens don't work with it.

1. Your avatar → **Settings → Developer settings → Personal access tokens →
   Tokens (classic) → Generate new token → Generate new token (classic)**.
2. **Note**: `server ghcr pull`.
3. **Expiration**: choose a date, and put a reminder in your calendar: when it
   expires, deploys fail until you log in again with a new one.
4. Tick **only** `read:packages`.
5. **Generate token**, and copy it (`ghp_...`): shown once.

The token can read every package your account can read. A separate GitHub
account (a "machine user") with access to these repositories only narrows that.

**Log in on the server**, as the user that runs `deploy.sh` (the login is saved
in that user's `~/.docker/config.json`):

```bash
read -rs CR_PAT                       # paste the token, press Enter (nothing is shown)
echo "$CR_PAT" | docker login ghcr.io -u <your-github-username> --password-stdin
unset CR_PAT
```

One login covers the API's and the web app's images.

**Tell `deploy.sh`**, in `.env.production`:

```bash
DEPLOY_IMAGE_SOURCE=registry
DEPLOY_IMAGE=ghcr.io/<your-org>/<your-repository>   # lower case, no tag
```

(For a public repository you can instead make the package public: the package
page → **Package settings** → **Change visibility** → **Public**. Then no login
is needed.)

## 6. The Deploy button

Lets you deploy or roll back from the **Actions** tab, without opening a
terminal. Nothing deploys by itself: a push only builds and publishes the
image.

**1. A key for GitHub to log in to the server.** On your laptop (not the
server):

```bash
ssh-keygen -t ed25519 -f deploy_key -N "" -C "github-actions-deploy"
ssh ubuntu@<server-ip> 'cat >> ~/.ssh/authorized_keys' < deploy_key.pub
```

Open `deploy_key` (the one **without** `.pub`), copy all of it, from
`-----BEGIN OPENSSH PRIVATE KEY-----` to `-----END OPENSSH PRIVATE KEY-----`
included, into the secret **`DEPLOY_SSH_KEY`** (section 3). Then delete both
files from your laptop. Use one key per repository if you want to withdraw them
separately: each is a line in the server's `~/.ssh/authorized_keys`.

**2. The server's host key**, so the workflow can tell it is really your server
and not something pretending to be it. On the server:

```bash
cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub
```

It prints `ssh-ed25519 AAAA...`: that whole line, **without** a host name in
front, is the variable **`DEPLOY_HOST_KEY`**. (From your laptop,
`ssh-keyscan -t ed25519 <server-ip>` prints the same with the address in front;
drop the address.)

**3. The other variables**: `DEPLOY_HOST` (the server's IP), `DEPLOY_USER`
(e.g. `ubuntu`), `DEPLOY_PATH` (e.g. `/home/ubuntu/nest`).

**4. Let GitHub in.** The workflow connects to **port 22**, from GitHub's
machines, whose addresses change. So port 22 must be open to the internet (the
server accepts keys only, which is what makes that safe:
[../server.md](../server.md#ssh)). `DEPLOY_HOST` must be the IP address, or a
name that is **not** proxied by Cloudflare: Cloudflare's proxy does not carry
SSH.

**5. Use it**: **Actions** → **Deploy** (left column) → **Run workflow** →
choose `deploy` (or `rollback`, with an optional 12-character release) →
**Run workflow**. The run's log shows the same lines `./deploy.sh` prints in a
terminal.

## 7. Renovate

Renovate runs on its maker's (Mend's) servers, not on your Actions minutes;
each pull request it opens does run CI.

1. Open https://github.com/apps/renovate → **Install** (or **Configure**, if it
   is installed already).
2. Choose your account or organization → **Only select repositories** → pick
   the API and web app repositories → **Install**.
3. Both repositories already have a `renovate.json` with the rules. Change its
   `timezone` if you are not in Vietnam's time zone.
4. Sign in to https://developer.mend.io with GitHub and check that each
   repository's mode is **Scan and Alert**: "Scan Only" makes Renovate silent.
   (If the portal names it differently now, look for the setting that lets
   Renovate open pull requests.)

Within a few hours an issue named **Dependency Dashboard** appears in each
repository. If Renovate opens a "Configure Renovate" pull request instead,
merge it. The weekly routine: [../renovate.md](../renovate.md).

To add a repository later: your avatar → **Settings → Applications → Installed
GitHub Apps → Renovate → Configure → Repository access → Select repositories →
Save**.

## Check it works

- [ ] **CI**: push a commit; a yellow dot and then a green ✓ appear next to it,
      and the **Actions** tab lists the run.
- [ ] **The image**: after a push to `main`, your profile's **Packages** tab
      lists `<repository>` with a 12-character tag.
- [ ] **The deploy key**: `ssh -T git@github-nest` on the server answers "Hi
      <your-org>/<your-repository>!".
- [ ] **The registry login**: on the server, `docker pull ghcr.io/<your-org>/<your-repository>:<12-character commit>` downloads.
- [ ] **The Deploy button**: run it with `deploy`; the run ends green with
      `Release <tag> is live` in its log.
- [ ] **Renovate**: the **Dependency Dashboard** issue exists.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| `Permission denied (publickey)` when cloning on the server | No deploy key, or cloned with `git@github.com:` instead of the alias | Section 4: clone from `git@github-nest:...` |
| "Key is already in use" when adding a deploy key | The same key on a second repository | One key per repository |
| `deploy.sh`: `Could not pull ghcr.io/...` | CI has not finished (or failed) for that commit, or the server is not logged in, or the token expired | The **Actions** tab; `docker login ghcr.io` again with a new token |
| `docker login` refused with a fine-grained token | GHCR needs a classic token | Section 5 |
| `DEPLOY_IMAGE must be lowercase` | GitHub names the image in lower case | Write the owner and repository in lower case |
| Deploy run: `Deploy is not set up: Missing: ...` | A secret or variable is missing or misspelled | Section 3; names are case-sensitive |
| Deploy run: `Host key verification failed` | `DEPLOY_HOST_KEY` has the host name in front, or is the RSA key, or the server was rebuilt | Section 6, step 2: `ssh-ed25519 AAAA...` only |
| Deploy run: `Connection timed out` | Port 22 closed to GitHub, or `DEPLOY_HOST` is a Cloudflare-proxied name, or SSH is on another port | Section 6, step 4. The workflow always uses port 22 |
| Deploy run: `Permission denied (publickey)` | The public half is not in the server's `authorized_keys`, or the secret lost its first or last line | Section 6, step 1 |
| No CI runs at all | Actions disabled, or a fork that needs enabling | Section 2 |
| Renovate opens nothing | Mode "Scan Only", or the repository not selected | Section 7 |
