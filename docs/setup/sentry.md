# Sentry

**What it is for here.** When the API fails in a way nobody expected (a 500, a
crash, a background job that gave up for good), the error goes to the logs and,
with Sentry set up, to [Sentry](https://sentry.io) too. Sentry groups identical
errors into one **issue**, counts them, shows the stack trace and the request
that caused it, names the release (the deployed commit) that introduced it,
and emails you when a new issue appears or a fixed one comes back. What the
API sends and what it never sends: [../error-tracking.md](../error-tracking.md).

**Do you need it?** No: it is off unless `SENTRY_DSN` is set, and with it off
the app sends nothing anywhere. Recommended in production: logs tell you what
happened, Sentry tells you which distinct bugs exist and which are new.

**Cost.** The free **Developer** plan: 5,000 errors a month (shared by all your
projects), 1 user, 30 days of history, alerts **by email only** (Slack and
Discord need the paid Team plan). The starter is built to stay inside it:
tracing is off, 4xx answers are not reported, and each distinct error sends at
most 10 events at once and then one every 6 minutes.

- [1. Account and organization](#1-account-and-organization)
- [2. Two projects: the API and the web app](#2-two-projects-the-api-and-the-web-app)
- [3. Where each value goes](#3-where-each-value-goes)
- [4. Source maps for the web app (optional)](#4-source-maps-for-the-web-app-optional)
- [5. Email alerts](#5-email-alerts)
- [6. Staying inside the free plan](#6-staying-inside-the-free-plan)
- [Check it works](#check-it-works)
- [Common mistakes](#common-mistakes)

## 1. Account and organization

1. Go to https://sentry.io/signup/ and create an account (email, or sign in
   with GitHub or Google).
2. Sentry asks you to create an **organization**: the account that holds your
   projects. Enter an **Organization Name** (your company or project name).
3. Choose the **Data Storage Location**: **United States** or **European
   Union**. **This cannot be changed later**; moving means a new organization.
   - US: your DSNs will look like `https://<key>@o<id>.ingest.us.sentry.io/<id>`.
   - EU (Frankfurt): `https://<key>@o<id>.ingest.de.sentry.io/<id>`.
   - Both work for sending errors from the API and the web app. Choose US unless
     you need the data kept in the EU. If you choose EU and use source-map
     uploads (section 4), check the web app's build log once for
     `[sentry] Sourcemaps were NOT uploaded`: in 2026 some EU organization
     tokens were refused with "Invalid org token", and whether that is fixed
     could not be confirmed when this page was written.

If the sign-up screens differ from these labels, look for the same choices:
an organization name and a data region.

## 2. Two projects: the API and the web app

Make **one project per app**, so the API's and the web app's errors are kept
apart, each with its own DSN. A **DSN** (Data Source Name) is the address an app
sends its errors to. It can only send, not read anything, so it is not a
password; it is still kept out of git with the rest of the env file.

For each project:

1. Click your organization's name or icon (top left) → **Projects** →
   **Create Project**. (On a first sign-in Sentry may open this screen by itself.)
2. **Choose your platform**:
   - for the API: **NestJS** (search "nest"; it is listed with the Node.js
     platforms). If you can't find it, **Node.js** works too: the platform only
     changes the setup guide Sentry shows, not what the API sends;
   - for the web app: **React**.
3. If asked which products to set up, keep only **Error Monitoring**. Tracing
   and Session Replay use up the free quota and the starters don't send them.
4. **Set your alert frequency**: choose **Alert me on high priority issues**.
   That creates an email alert for you.
5. **Name your project**. The name becomes the project's **slug**, the short
   name in URLs and settings: e.g. `api` and `web`. Pick a **Team** (the default
   team is fine).
6. Click **Create Project**. The setup guide that opens shows the DSN, in a
   line like `dsn: "https://...ingest...sentry.io/..."`. Copy it. You can skip
   the rest of the guide: the starters already contain the code.

To find a DSN later: open the project → **Settings** (the gear) → **SDK Setup**
→ **Client Keys (DSN)**. Older screens call it **Settings → Projects →
<project> → Client Keys (DSN)**; it is the same page.

## 3. Where each value goes

**The API** (this repository):

| Value | Variable | File | Notes |
|---|---|---|---|
| The API project's DSN | `SENTRY_DSN` | `.env.development` and/or `.env.production` | Read when the app starts. Must have the shape `https://<key>@<host>/<project>`, or the app refuses to start. Empty: off |
| Share of requests traced | `SENTRY_TRACES_SAMPLE_RATE` | the same | Keep `0`. Tracing uses the free quota fast ([../error-tracking.md](../error-tracking.md#tracing)) |
| The release | `SENTRY_RELEASE` | **don't set it** | In production `docker-compose.prod.yaml` sets it to the commit `deploy.sh` is deploying |

Errors are filed under an **environment**, taken from `NODE_ENV`:
`development` from your machine, `production` from the server. One project can
hold both; Sentry's environment filter keeps them apart. A separate project per
environment works too: use a different DSN in each file.

The API uploads no source maps, and this repository's CI uses no Sentry values.

**The web app** (the `React-Starter-No-Keycloak` repository) gets **its own
project and DSN**:

| Value | Variable | Where | When it is read |
|---|---|---|---|
| The web project's DSN | `VITE_SENTRY_DSN` | The web app's `.env.development` / `.env.production` | Development: when Vite starts (`pnpm dev`). Production: **when the container starts**, which writes it into `/config.js` for the browser. Changing it needs the web app's `./deploy.sh`, not a new image |
| The release | `VITE_SENTRY_RELEASE` | don't set it | Its `deploy.sh` and CI set it to the commit |
| Source maps | `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | Section 4 | When the image is built |

## 4. Source maps for the web app (optional)

The web app's code is minified, so its stack traces read like `a.b is not a
function` at line 1. **Source maps** let Sentry show the original file and line.
The web app's build uploads them when it has all three of these, and skips the
upload with none of them:

| Value | Where to find it | Variable |
|---|---|---|
| Organization slug | **Settings → General Settings → Organization Slug**, or the first part of your Sentry address: `https://<org-slug>.sentry.io/` | `SENTRY_ORG` |
| Web project slug | The project's name in **Projects**, or the project's **Settings → General Settings** | `SENTRY_PROJECT` |
| An organization token | Below | `SENTRY_AUTH_TOKEN` (a secret) |

**The token:**

1. **Settings → Developer Settings → Organization Tokens → Create New Token**.
2. Give it a name, e.g. `web-sourcemaps`, and create it. Its permissions are
   fixed to what CI uploads need (`org:ci`: source maps and releases, nothing
   else).
3. **Copy it now**: it is shown once. It starts with `sntrys_`.

A personal token (**User Settings → Personal Tokens**) also works, with
**Project: Read & Write** and **Release: Admin**, but it acts as you and can
reach every organization you belong to. Prefer the organization token.

**Where the three go** depends on where the web app's image is built:

| The image is built | Put them in |
|---|---|
| On the server (`DEPLOY_IMAGE_SOURCE=build`) | The web app's `.env.production` on the server |
| By GitHub Actions (`registry` mode) | The **web** repository's **Settings → Secrets and variables → Actions**: `SENTRY_ORG` and `SENTRY_PROJECT` on the **Variables** tab (**New repository variable**), `SENTRY_AUTH_TOKEN` on the **Secrets** tab (**New repository secret**). The web app's `ci.yml` reads `vars.SENTRY_ORG`, `vars.SENTRY_PROJECT` and `secrets.SENTRY_AUTH_TOKEN` |

The token is passed to the build as a build secret and is not stored in the
image. More: [github.md](./github.md#3-secrets-and-variables).

## 5. Email alerts

On the free plan, alerts arrive by email.

1. The project you created in section 2 already has an alert for high-priority
   issues, if you chose **Alert me on high priority issues**.
2. To be told about **every new issue and every regression** (a resolved issue
   that comes back) in production, add one:
   1. **Alerts** (in 2026 Sentry moved it under **Monitors → Alerts**; older
      screens have **Alerts** in the left sidebar) → **Create Alert**.
   2. Choose issues, for the API project (or all projects).
   3. Environment: `production`.
   4. **When**: **A new issue is created**, and **A resolved issue becomes
      unresolved** (or "regresses").
   5. **Then**: notify **Suggested Assignees**, falling back to **Recently
      Active Members** (that is you, on the free plan), by email.
   6. Save it.
3. Check that your email notifications are on: **User Settings →
   Notifications** → **Alerts** and **Issue Workflow** set to email.

How the starter decides what is worth an issue, and what a free plan email
looks like: [../error-tracking.md](../error-tracking.md#notifications).

## 6. Staying inside the free plan

Already done by the starter:

- **API**: no tracing (`SENTRY_TRACES_SAMPLE_RATE=0`); 4xx answers and 503s are
  not reported; a failing background job is reported once, when it gives up,
  not on every retry; each distinct error sends at most 10 events at once, then
  one every 6 minutes.
- **Web app**: each error at most 5 times per page load, then once every 5
  minutes, 30 events per page load at most; failed API calls, browser-extension
  errors and stale-chunk errors are not sent; no tracing, no replay.

Worth doing yourself:

- **Settings → Spike Protection**: turn it on, so one runaway error can't use
  the month's quota in an hour.
- Watch the usage: **Settings → Subscription** (or **Usage & Billing**).

## Check it works

**The API, on your machine:**

```bash
pnpm sentry:check
```

It reads `.env.development`, sends one error ("Test error from pnpm
sentry:check"), and prints `Accepted by <host>: event <id>, environment
"development".` Or why not: the DSN refused (401/403), the quota used up (429),
or Sentry unreachable.

**The API, on the server**, after a deploy:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yaml \
  exec app node dist/src/bootstrap/sentry-check.js
```

**The web app, in development:** open it, open the browser's developer console,
and run `setTimeout(() => { throw new Error('Sentry test') })`. (The
`setTimeout` matters: the console swallows an error thrown directly.)

**Where to look:** the project's **Issues** page. Check the **environment**
filter at the top: `development` and `production` are listed separately, and
the page may show only one of them.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| The app refuses to start: `SENTRY_DSN is not a DSN` | A partial copy, or the project's URL instead of its DSN | Copy the whole DSN from **Client Keys (DSN)**: `https://<key>@...sentry.io/<number>` |
| `pnpm sentry:check` says `SENTRY_DSN is not set` | The DSN is in `.env.production`, and the check reads `.env.development` | Run the server form above, or put the DSN in `.env.development` too |
| The check says accepted, but **Issues** is empty | The environment filter shows only `production` | Choose **All Environments** at the top |
| Errors from the web app arrive in the API's project | The same DSN used in both | Make the second project (section 2) and use its DSN in the web app |
| A 4xx error you expected is not in Sentry | 4xx answers are the client's mistake, not a bug, and are not reported | They are in the logs ([../logging.md](../logging.md)) |
| Web stack traces are minified | No source maps uploaded | Section 4. All three values, or none |
| Source-map upload fails with 401 "Invalid org token" | An EU organization's token (see section 1), or a token from another organization | Check the token's organization; for EU, try a personal token |
| No email about a new issue | No alert rule for it, or email notifications off | Section 5 |
| The monthly quota ran out | A noisy error, or tracing turned on | Fix or ignore the noisy issue (**Ignore** in Sentry), keep `SENTRY_TRACES_SAMPLE_RATE=0`, turn on Spike Protection |
