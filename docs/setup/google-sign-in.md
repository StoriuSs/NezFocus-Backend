# Google sign-in: getting the keys

This page walks you through Google Cloud Console, step by step, to get the two
values that turn on "Continue with Google": `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET`. You need it only if you want people to sign in with
their Google account. Without the keys, the button is hidden and everything
else works.

How the app uses Google once the keys are in (PKCE, the state cookie, which
account a Google sign-in lands in) is explained in
[../auth/google-sign-in.md](../auth/google-sign-in.md).

| | |
|---|---|
| Needed in development | No. Optional, if you want to try the button locally |
| Needed in production | No. Optional |
| Cost | Free |
| Time | About 15 minutes |
| You end with | `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the API's env file |
| The web app needs | Nothing. It asks the API which providers are on |

- [Before you start: the redirect URI](#before-you-start-the-redirect-uri)
- [1. Create a project](#1-create-a-project)
- [2. Fill in the branding (the consent screen)](#2-fill-in-the-branding-the-consent-screen)
- [3. Choose who may sign in (Audience)](#3-choose-who-may-sign-in-audience)
- [4. Scopes: nothing to add](#4-scopes-nothing-to-add)
- [5. Create the OAuth client](#5-create-the-oauth-client)
- [6. Put the keys in the env file](#6-put-the-keys-in-the-env-file)
- [Check it works](#check-it-works)
- [Going to production](#going-to-production)
- [Changing the secret later](#changing-the-secret-later)
- [Common mistakes](#common-mistakes)

## Before you start: the redirect URI

A **redirect URI** is the address Google sends the browser back to after the
person picks their account. Google only sends people back to addresses you
registered in advance, so a stolen client ID can't be used to send someone's
sign-in to another site.

The API builds its redirect URI from `BASE_URL` and `API_PREFIX`
([auth.config.ts](../../src/config/auth.config.ts)):

```
<BASE_URL>/<API_PREFIX>/v1/auth/google/callback
```

With the values in [.env.example](../../.env.example) that is:

| Where | `BASE_URL` | Redirect URI to register |
|---|---|---|
| Your machine | `http://localhost:8888` | `http://localhost:8888/api/v1/auth/google/callback` |
| Production | `https://api.example.com` | `https://api.example.com/api/v1/auth/google/callback` |

Google compares it character for character: scheme (`http`/`https`), host,
port and path. No trailing slash. `localhost` and `127.0.0.1` count as
different hosts. Plain `http` is accepted only for `localhost`.

## 1. Create a project

A Google Cloud **project** is a folder that holds your app's sign-in settings.

1. Open <https://console.cloud.google.com> and sign in. Use an account your
   team can still reach in a year (a shared admin account or a Google Workspace
   account), not a personal one that may leave with a person.
2. Click the project picker in the top bar. It shows **Select a project** or
   the name of the current project.
3. Click **New project**.
4. **Project name**: your app's name, e.g. `myapp`. Leave **Organization** and
   **Location** as they are.
5. Click **Create**. Wait for the notification, then click **Select project**
   in it (or pick the project in the top-bar picker).

Check the top bar shows your new project before going on. Every later step
happens inside it.

## 2. Fill in the branding (the consent screen)

The **consent screen** is the Google page that says "Sign in to *myapp*" and
lists what the app will see. Google now calls this section **Google Auth
Platform**.

1. Open the menu (☰, top left) → **Google Auth Platform** → **Branding**.
   - If you can't find it, type `Google Auth Platform` in the console's search
     bar. Older consoles call it **APIs & Services → OAuth consent screen**.
2. If you see **Get started**, click it. A short form opens with four parts:
   1. **App Information**: **App name** (shown to people on the consent
      screen) and **User support email** (pick your address from the list).
      Click **Next**.
   2. **Audience**: choose **External**, so any Google account can sign in.
      Choose **Internal** only if every user is in your own Google Workspace
      organisation. Click **Next**.
   3. **Contact Information**: an address where Google sends notices about
      the project. Click **Next**.
   4. **Finish**: tick the box to agree to the Google API Services: User Data
      Policy, click **Continue**, then **Create**.
3. Back on **Branding**, for production fill in:
   - **Authorized domains**: click **+ Add domain** and enter the registrable
     domain of your API, e.g. `example.com` for `api.example.com`. Google
     refuses a production redirect URI on a domain that isn't listed here.
     You don't need `localhost`.
   - **App domain** links (home page, privacy policy, terms of service) are
     optional while you test. Add them before you publish.
   - Click **Save**.
4. **Leave the logo empty** unless you want to go through Google's brand
   verification: uploading a logo to an External app in production starts it.

## 3. Choose who may sign in (Audience)

A new app starts in **Testing**: only the accounts you list can sign in, up to
100. Everyone else sees `Error 403: access_denied`.

1. Left menu → **Audience**.
2. Under **Test users**, click **+ Add users**, enter the Google addresses you
   will test with (yours, your teammates'), and click **Save**.

That is enough for development. For production, see
[Going to production](#going-to-production).

## 4. Scopes: nothing to add

A **scope** is a piece of the person's Google data the app asks for. The
starter asks for `openid email profile` only: who they are, their address and
whether Google verified it, and their name
([openid-connect-provider.adapter.ts](../../src/modules/auth/infrastructure/adapters/openid-connect-provider.adapter.ts)).
These are allowed without listing them and need no review by Google.

You can skip **Data Access**. If you want the consent screen to list them
anyway: **Data Access** → **Add or remove scopes** → tick `openid`,
`.../auth/userinfo.email` and `.../auth/userinfo.profile` → **Update** →
**Save**.

## 5. Create the OAuth client

The **OAuth client** is the pair of keys the API uses to talk to Google. Make
one per environment: a development secret sits in files on laptops, and if it
leaks it can't be used with your production redirect URI. You can also delete
one without touching the other.

1. Left menu → **Clients** → **+ Create client**.
2. **Application type**: **Web application**.
3. **Name**: `myapp-dev`. Only you see it.
4. **Authorized JavaScript origins**: leave empty. They are for sign-in that
   runs in the browser. Here the API exchanges the code with Google, server to
   server.
5. **Authorized redirect URIs** → **+ Add URI** → enter
   `http://localhost:8888/api/v1/auth/google/callback` (or your own
   `BASE_URL` + `/api/v1/auth/google/callback`).
6. Click **Create**. A dialog shows the **Client ID** (ends in
   `.apps.googleusercontent.com`) and the **Client secret** (starts with
   `GOCSPX-`).
7. **Copy both now**, or click **Download JSON**. The full secret is shown
   only in this dialog; afterwards the console shows its last four characters.
   If you lose it, add a new one ([Changing the secret later](#changing-the-secret-later)).

For production, repeat with **Name** `myapp-prod` and the redirect URI
`https://api.example.com/api/v1/auth/google/callback`.

Google says a setting change can take from five minutes to a few hours to
apply. If the first try fails with `redirect_uri_mismatch` and everything
looks right, wait a few minutes.

## 6. Put the keys in the env file

The keys go in the **API's** env file. Set both or neither: with only one, the
API refuses to start (`"GOOGLE_CLIENT_SECRET" is required when
"GOOGLE_CLIENT_ID" is set`, from [validation.ts](../../src/config/validation.ts)).

| File | Variable | Value |
|---|---|---|
| `.env.development` | `GOOGLE_CLIENT_ID` | the `myapp-dev` client ID |
| `.env.development` | `GOOGLE_CLIENT_SECRET` | the `myapp-dev` secret |
| `.env.development` | `BASE_URL` | `http://localhost:8888` (already there) |
| `.env.production` | `GOOGLE_CLIENT_ID` | the `myapp-prod` client ID |
| `.env.production` | `GOOGLE_CLIENT_SECRET` | the `myapp-prod` secret |
| `.env.production` | `BASE_URL` | `https://api.example.com`, the public HTTPS address |
| `.env.production` | `FRONTEND_URL` | `https://app.example.com`: where the browser goes after Google |

```bash
GOOGLE_CLIENT_ID=1234567890-abc123.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-secret
```

Then restart the API so it reads them:

- Development: `pnpm docker:dev` (it recreates the container when the env file
  changed), or restart `pnpm start:dev`.
- Production: the next `./deploy.sh` ([../deploy.md](../deploy.md)).

**The web app (React starter) needs nothing.** It calls
`GET /api/v1/auth/options`, and shows "Continue with Google" when the answer's
`providers` list contains `google`. The button sends the browser to
`<API>/api/v1/auth/google`.

Only the client secret is secret. The client ID appears in the address bar
during every sign-in.

## Check it works

1. **The API sees the keys.**

   ```bash
   curl -s http://localhost:8888/api/v1/auth/options
   ```

   The `data` part should read `"providers":["google"]`. An empty list means
   the API didn't get the keys: check the file name and restart.

2. **The redirect URI is the one you registered.**

   ```bash
   curl -s -o /dev/null -D - http://localhost:8888/api/v1/auth/google | grep -i '^location'
   ```

   You get a `302` to `https://accounts.google.com/...`. Find
   `redirect_uri=` in it: `http%3A%2F%2Flocalhost%3A8888%2Fapi%2Fv1%2Fauth%2Fgoogle%2Fcallback`
   is `http://localhost:8888/api/v1/auth/google/callback`, URL-encoded. It
   must match the URI in the client exactly.

3. **A real sign-in.** Start the web app on <http://localhost:3001>, open the
   sign-in page and click **Continue with Google**. Pick an account listed
   under **Test users**. You should end up signed in on the web app.

   Without the web app: open <http://localhost:8888/api/v1/auth/google> in the
   browser. After Google, the browser goes to
   `http://localhost:3001/auth/callback?redirect=%2F`. The page won't load with
   no web app running, but an address without `error=` means the sign-in
   worked. `?error=...` means it didn't: see the table below and the API log.

In production, run the same checks against `https://api.example.com`.

## Going to production

1. Create the `myapp-prod` client with the production redirect URI
   ([step 5](#5-create-the-oauth-client)).
2. On **Branding**, add your domain under **Authorized domains**, and the home
   page and privacy policy links. Click **Save**.
3. On **Audience**, click **Publish app** and confirm. The status changes from
   **Testing** to **In production**, and any Google account can sign in. With
   only `openid email profile`, Google asks for no verification.
4. Put the production keys in `.env.production` and deploy.
5. Run [Check it works](#check-it-works) against the production API.

Publishing applies to the whole project, so the development client then also
accepts any account. That is harmless: its redirect URI is `localhost`.

Google may delete a client that has not been used for six months. You can
restore it within 30 days; look for a list of deleted clients on the
**Clients** page. A development client is the usual victim.

## Changing the secret later

Do this when the secret may have leaked, or as routine. Google lets a client
have two secrets at once, so nobody is signed out:

1. **Clients** → open the client → **Add secret**. Copy the new secret.
2. Put it in `GOOGLE_CLIENT_SECRET` in `.env.production` and deploy.
3. Back on the client, **Disable** the old secret, then delete it.

## Common mistakes

| You see | Why | Fix |
|---|---|---|
| Google page: `Error 400: redirect_uri_mismatch` | The URI the API sent isn't in the client's list. Usually `BASE_URL` differs (port, `http` vs `https`, `localhost` vs `127.0.0.1`, a trailing slash), or you registered it in the other client | Run check 2 above, copy the decoded `redirect_uri` into the client, or fix `BASE_URL`. Wait a few minutes |
| Google page: `Error 403: access_denied` | The app is in **Testing** and the account isn't a test user | **Audience** → **Test users** → add it, or **Publish app** |
| Google page: `Error 403: org_internal` | The audience is **Internal** and the account is outside your organisation | **Audience** → change the user type to External (if there is no button for it, look for **Make external**) |
| API won't start: `"GOOGLE_CLIENT_SECRET" is required when "GOOGLE_CLIENT_ID" is set` | Only one of the two is set | Set both, or empty both |
| Back on the web app with `?error=failed` | The API log says which. Often: the sign-in was started on `127.0.0.1` but `BASE_URL` says `localhost` (the `oauth_state` cookie stays on the host you started from, so it is missing at the callback); more than 10 minutes at Google; Redis down; wrong secret | Use the same host as `BASE_URL`; check the secret; see [../auth/operations.md](../auth/operations.md) |
| `?error=email_unverified` | Google hasn't verified that account's address | Expected; the person verifies the address with Google first |
| `?error=cancelled` | The person clicked **Cancel** at Google | Nothing to fix |
| Production: `redirect_uri_mismatch` with `http://` in the URI | `BASE_URL` in `.env.production` is `http://...` or the internal address | `BASE_URL=https://api.example.com`, the public address |
| Can't add the production URI: domain not authorized | The domain isn't under **Branding** → **Authorized domains** | Add `example.com` there first |
| The secret shows as `****abcd` | It is only shown in full when created | **Add secret** to get a new one |

Related: [../auth/google-sign-in.md](../auth/google-sign-in.md) (how it works),
[../auth/operations.md](../auth/operations.md) (troubleshooting in production),
[prepare-for-development.md](./prepare-for-development.md),
[prepare-for-production.md](./prepare-for-production.md).
