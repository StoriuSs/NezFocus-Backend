# Cloudflare Turnstile: getting the keys

Turnstile is Cloudflare's "are you human?" check. This page gets you the two
values that turn it on, `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`: test
keys for development in one minute, or a real widget for production in about
ten. Without the keys, Turnstile is off and every form works without it.

When it is on, the API asks for a solved challenge on sign-up and forgot
password every time, and on sign-in from the third try after two failures.
Why, and how it changes the rate limits, is in
[../auth/turnstile.md](../auth/turnstile.md).

| | |
|---|---|
| Needed in development | No. Use the test keys if you want to see it |
| Needed in production | No, but recommended: it stops scripts from mass-creating accounts and guessing passwords |
| Cost | Free: unlimited challenges. Up to 20 widgets, 10 hostnames each |
| Time | 1 minute (test keys), 10 minutes (real widget) |
| You end with | `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` in the API's env file |
| The web app needs | Nothing. It gets the site key from the API |

- [The two keys](#the-two-keys)
- [Development: the test keys](#development-the-test-keys)
- [Production: create a widget](#production-create-a-widget)
- [Put the keys in the env file](#put-the-keys-in-the-env-file)
- [Check it works](#check-it-works)
- [Changing the secret key](#changing-the-secret-key)
- [Common mistakes](#common-mistakes)

## The two keys

| Key | Who uses it | Secret? |
|---|---|---|
| **Site key** | The web page, to draw the widget. The API hands it to the web app through `GET /api/v1/auth/options` | No. It is in every page |
| **Secret key** | The API, to ask Cloudflare whether a token the page sent is real (Cloudflare's *siteverify*) | Yes. Server only |

The person solves the challenge in the widget. The widget gives the page a
**token**; the page sends it to the API as `turnstile_token`; the API checks
it with Cloudflare using the secret key. A token works once.

## Development: the test keys

Cloudflare publishes keys that work on any hostname, `localhost` included,
with no account. They always give the same answer, which is what you want
while building pages and in automated tests.

| Purpose | Site key | Secret key |
|---|---|---|
| Always passes (visible widget) | `1x00000000000000000000AA` | `1x0000000000000000000000000000000AA` |
| Always fails (visible widget) | `2x00000000000000000000AB` | `2x0000000000000000000000000000000AA` |
| Forces an interactive challenge | `3x00000000000000000000FF` | (pair with a passing secret) |
| Secret that answers "token already spent" | (any test site key) | `3x0000000000000000000000000000000AA` |

Pair test keys with test keys. A test widget gives the dummy token
`XXXX.DUMMY.TOKEN.XXXX`, which a real secret key refuses; a real widget's token
is refused by a test secret.

Cloudflare also has invisible test site keys (ending in `BB`). Don't use
them: the web app draws a visible, managed widget.

To use the always-pass pair, put in `.env.development`:

```bash
TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

and restart the API ([below](#put-the-keys-in-the-env-file)).

## Production: create a widget

1. Sign up or log in at <https://dash.cloudflare.com>. Your domain doesn't
   need to be on Cloudflare for Turnstile.
2. Open **Turnstile** from the left sidebar. If you don't see it, it may sit
   under **Application security** or **Protect & Connect**; the dashboard's
   search box finds it too.
3. Click **Add widget**.
4. **Widget name**: e.g. `myapp-prod`. Only you see it.
5. **Hostname management** → **Add hostnames**: enter the **web app's**
   hostname, e.g. `app.example.com`. The widget runs in the web page, so this
   is the site's name, not the API's.
   - Bare hostname only: no `https://`, no port, no path.
   - A domain also covers its subdomains: `example.com` covers
     `app.example.com`.
   - Don't add `localhost` to the production widget. Cloudflare advises
     against it: anyone could then solve your widget on their own machine. For
     development, make a second widget named `myapp-dev` with only
     `localhost`, or use the [test keys](#development-the-test-keys).
6. **Widget Mode**: **Managed**. Cloudflare decides whether to show a checkbox;
   most people see nothing to click. Don't pick **Invisible**: the web app
   draws a visible widget, full width.
7. **Pre-clearance**: **No**. It only matters for sites behind Cloudflare's
   firewall rules.
8. Click **Create**.
9. Copy the **Site Key** and the **Secret Key**. If the page after **Create**
   doesn't show them, open the widget from the Turnstile list; both are on its
   page (the secret behind a **Copy** or **Show** button).

## Put the keys in the env file

The keys go in the **API's** env file. Set both or neither: with only one, the
API refuses to start (`"TURNSTILE_SECRET_KEY" is required when
"TURNSTILE_SITE_KEY" is set`, from [validation.ts](../../src/config/validation.ts)).

| File | `TURNSTILE_SITE_KEY` | `TURNSTILE_SECRET_KEY` |
|---|---|---|
| `.env.development` | a test site key, or your `myapp-dev` widget's | the matching secret |
| `.env.production` | the `myapp-prod` widget's site key (starts with `0x`) | its secret key |

Restart the API so it reads them:

- Development: `pnpm docker:dev`, or restart `pnpm start:dev`.
- Production: the next `./deploy.sh` ([../deploy.md](../deploy.md)).

**The web app (React starter) needs nothing.** It calls
`GET /api/v1/auth/options` and draws the widget when `turnstile_site_key` is
not `null`. Its Content-Security-Policy already allows
`https://challenges.cloudflare.com` (its `scripts/csp.mjs`). Don't put the
secret key in the web app's env: everything there ends up in the browser.

## Check it works

All three checks use `curl` against the development API; use
`https://api.example.com` in production.

1. **The API hands out the site key.**

   ```bash
   curl -s http://localhost:8888/api/v1/auth/options
   ```

   `data.turnstile_site_key` should be your site key. `null` means the API
   didn't get the keys.

2. **Sign-up without a token is refused.**

   ```bash
   curl -s -X POST http://localhost:8888/api/v1/auth/register \
     -H 'Content-Type: application/json' \
     -d '{"email":"turnstile-test@example.com","password":"Correct-Horse-42"}'
   ```

   Expect `400` with `"type":"AUTH_CAPTCHA_REQUIRED"` and code `400106`.

3. **The API can talk to Cloudflare with your secret.** Send the dummy token:

   ```bash
   curl -s -X POST http://localhost:8888/api/v1/auth/register \
     -H 'Content-Type: application/json' \
     -d '{"email":"turnstile-test@example.com","password":"Correct-Horse-42","turnstile_token":"XXXX.DUMMY.TOKEN.XXXX"}'
   ```

   | Answer | Means |
   |---|---|
   | `202` "Check your email to continue." | Expected with the always-pass test keys. The code is in Mailpit, <http://localhost:8025> |
   | `400` `AUTH_CAPTCHA_FAILED` (`400107`) | Expected with a real secret key: Cloudflare looked at the dummy token and refused it. That proves the secret works |
   | `503` `AUTH_CAPTCHA_UNAVAILABLE` (`503002`) | The API could not use Cloudflare: a wrong secret, or no network. For a wrong secret the API log says `check TURNSTILE_SECRET_KEY` |

4. **In the browser.** Open the web app's sign-up page
   (<http://localhost:3001> in development). The widget appears above the
   button; sign up as usual.

## Changing the secret key

If the secret leaked, or as routine:

1. Turnstile → open the widget → **Settings** → **Rotate Secret Key**.
2. Copy the new secret into `TURNSTILE_SECRET_KEY` in `.env.production` and
   deploy.

Cloudflare accepts the old and the new secret for two hours after a rotation,
so deploy within that window. The site key doesn't change.

## Common mistakes

| You see | Why | Fix |
|---|---|---|
| The widget shows error `110200` | The page's hostname isn't in the widget's **Hostname management** list | Add the web app's hostname (bare, no `https://`) |
| Every sign-up fails with `AUTH_CAPTCHA_FAILED` | A test site key with a real secret, or the other way round; or the site key of one widget with the secret of another | Use a matching pair from the same widget, or both test keys |
| `503 AUTH_CAPTCHA_UNAVAILABLE` on every form | The secret key is wrong (Cloudflare answers `invalid-input-secret`), or the server can't reach `challenges.cloudflare.com` | Copy the secret again; check outbound HTTPS from the server. The API refuses rather than skipping the check, on purpose ([../auth/turnstile.md](../auth/turnstile.md)) |
| API won't start: `"TURNSTILE_SECRET_KEY" is required when "TURNSTILE_SITE_KEY" is set` | Only one key is set | Set both, or empty both |
| You added the API's hostname (`api.example.com`) | The widget runs on the web page | Add the web app's hostname |
| End-to-end tests fail on sign-up | Real keys in the test environment: a script can't solve a real challenge | Use the always-pass test keys there |
| The widget never appears | `turnstile_site_key` is `null` (keys not loaded), or the browser blocks `challenges.cloudflare.com` (an ad blocker, or a stricter CSP you added) | Run check 1; try another browser |

Related: [../auth/turnstile.md](../auth/turnstile.md) (when each form asks),
[../auth/rate-limits.md](../auth/rate-limits.md) (how the limits change with
Turnstile on), [prepare-for-development.md](./prepare-for-development.md),
[prepare-for-production.md](./prepare-for-production.md).
