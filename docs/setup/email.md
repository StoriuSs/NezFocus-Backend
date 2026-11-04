# Email: sending real mail

The API emails people a six-digit code to confirm their address, reset a
password, set a first password or delete their account, and it emails them
when something about their account's security changes. This page gets you an
email provider, proves to the world that its mail comes from your domain, and
puts its settings in the `EMAIL_*` variables.

In development you don't need any of it: every email lands in Mailpit, a
local inbox. In **production you do**: without `EMAIL_HOST` the API refuses to
start, because nobody could finish signing up. Which emails exist, when they
are sent and how to edit them is in [../auth/emails.md](../auth/emails.md).

| | |
|---|---|
| Needed in development | No. Mailpit catches everything |
| Needed in production | **Yes** |
| Cost | Free tiers cover a small app: Brevo about 300 a day, Resend 100 a day; Amazon SES $0.10 per 1,000 |
| Time | 15 minutes, plus waiting for DNS (minutes, sometimes hours) |
| You end with | `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`, `EMAIL_USER`, `EMAIL_PASSWORD`, `EMAIL_FROM_NAME`, `EMAIL_FROM_ADDRESS` in `.env.production` |
| The web app needs | Nothing |

- [Development: Mailpit](#development-mailpit)
- [Words you will meet](#words-you-will-meet)
- [Choosing a provider](#choosing-a-provider)
- [Brevo](#brevo)
- [Resend](#resend)
- [Amazon SES](#amazon-ses)
- [Gmail, for a quick test only](#gmail-for-a-quick-test-only)
- [Adding the DNS records](#adding-the-dns-records)
- [Put the settings in the env file](#put-the-settings-in-the-env-file)
- [Check it works](#check-it-works)
- [Common mistakes](#common-mistakes)

## Development: Mailpit

**Mailpit** is a fake mail server that keeps every message and shows it in a
web page. Nothing is delivered for real, so you can sign up as
`anyone@example.com`.

- `pnpm docker:dev` starts it. The dev compose file points the app at it
  **whatever `.env.development` says** (`EMAIL_HOST: mailpit` in
  [docker-compose.dev.yaml](../../docker-compose.dev.yaml)).
- Read the mail at <http://localhost:8025>.
- Running the API on your machine (`pnpm start:dev`) instead? Start Mailpit
  with `pnpm test:services:up`. The values in [.env.example](../../.env.example)
  (`EMAIL_HOST=localhost`, `EMAIL_PORT=1025`, empty `EMAIL_USER`) already
  point at it.

To send real mail from development (to test a provider before production),
run the API with `pnpm start:dev` and put the provider's values in
`.env.development`. Inside `pnpm docker:dev` the three `EMAIL_*` lines in
`docker-compose.dev.yaml` override your file; you'd have to remove them, and
not commit that.

## Words you will meet

**SMTP** is the protocol mail servers use to hand mail to each other. The API
speaks SMTP to your provider, and the provider delivers the mail. That is why
switching providers is only a change of settings: nothing in the code is tied
to one ([email.config.ts](../../src/config/email.config.ts)).

**Port and encryption** must agree, or the connection hangs and fails:

| `EMAIL_PORT` | `EMAIL_SECURE` | What happens |
|---|---|---|
| `587` | `false` | Connects in plain text, then upgrades to encryption (STARTTLS). The usual choice |
| `465` | `true` | Encrypted from the first byte |
| `2525` (some providers) | `false` | Like 587, for hosts that block 587 |

The **From address** (`EMAIL_FROM_ADDRESS`, e.g. `noreply@example.com`) must
be on a domain you have proved to the provider is yours. Receiving servers
check that with three DNS records:

- **SPF**: a TXT record listing the servers allowed to send mail for your
  domain. There can be only **one** SPF record per name; if you already have
  one, merge the new provider into it.
- **DKIM**: a public key in DNS (a TXT or CNAME record). The provider signs
  each message; receivers check the signature against the key. It proves the
  mail is from you and wasn't changed.
- **DMARC**: a TXT record at `_dmarc.example.com` that tells receivers what to
  do with mail that fails those checks (`p=none`, later `quarantine`, then
  `reject`) and where to send reports. One per domain.

Without them, your codes go to spam or are refused, and people can't sign up.

## Choosing a provider

| Provider | Free tier | Good for | Notes |
|---|---|---|---|
| [Brevo](#brevo) | About 300 emails a day (third-party figure; check their pricing page) | Starting out | Deactivates an SMTP key after 90 days without a successful send |
| [Resend](#resend) | 100 a day, 3,000 a month, 3 domains | Starting out, simple setup | Wants a subdomain like `mail.example.com` |
| [Amazon SES](#amazon-ses) | None as such; $0.10 per 1,000 | Volume | Starts in a sandbox; you ask AWS for production access |
| [Gmail](#gmail-for-a-quick-test-only) | 500 a day | A quick test from your machine | **Not for production** |

Any other SMTP provider (Postmark, Mailgun, Mailjet, your own server) works
the same way: get host, port, user and password, and add its DNS records.

## Brevo

1. Sign up at <https://www.brevo.com>.
2. **Add your domain.** Open the account menu (top right) → **Settings** →
   **Senders, Domains, IPs** → **Domains** → **Add a domain**. Enter
   `example.com` and click **Add domain**. (A free address like
   `@gmail.com` can't be authenticated; you need your own domain.)
3. **Authenticate it.** Brevo offers two ways:
   - **Authenticate the domain automatically**: Brevo signs in to your DNS
     provider (Cloudflare, for instance) and adds the records for you.
   - **Authenticate the domain yourself**: Brevo lists the records; add each
     one as in [Adding the DNS records](#adding-the-dns-records):
     a **Brevo code** TXT record (proves you own the domain), **DKIM** (one TXT
     or two CNAMEs, whichever Brevo shows) and **DMARC** (TXT). Then click
     **Authenticate this email domain**. It can take up to 48 hours.
4. **Add the sender.** **Senders** → **Add a sender**: **From name** (e.g.
   `MyApp`) and **From email** (e.g. `noreply@example.com`). On an
   authenticated domain it is verified straight away.
5. **Create the SMTP key.** Account menu → **Settings** → **SMTP & API** →
   **SMTP** tab → **Generate a new SMTP key**:
   1. Enter the code Brevo sends you, if it asks.
   2. Name the key, e.g. `myapp-prod`.
   3. Choose an expiry, or none. If you set one, put a reminder in your
      calendar: sign-up stops working the day it expires.
   4. Click **Generate**. **Copy the key now**; it is shown once.
   5. On the same page, copy the **Login** (it looks like
      `123abc@smtp-brevo.com`, or is your account's address on older accounts).
6. Values for `.env.production`:

   ```bash
   EMAIL_HOST=smtp-relay.brevo.com
   EMAIL_PORT=587
   EMAIL_SECURE=false
   EMAIL_USER=123abc@smtp-brevo.com      # the Login from step 5
   EMAIL_PASSWORD=xsmtpsib-...           # the SMTP key, not the API key
   EMAIL_FROM_NAME=MyApp
   EMAIL_FROM_ADDRESS=noreply@example.com
   ```

Watch out for: the **API key** (`xkeysib-...`) is a different thing and gives
`535 Authentication failed`; Brevo deactivates an SMTP key after **90 days
without a successful send**, which can bite a quiet app; and if you turn on
Brevo's blocking of unknown IP addresses, allow your server's public IP.

## Resend

1. Sign up at <https://resend.com>.
2. **Domains** → **Add Domain**. Enter a subdomain such as `mail.example.com`
   (Resend recommends one: it keeps this mail's reputation apart from your
   main domain's). Pick the region nearest your users. Click **Add**.
3. On the domain's page, Resend lists the records: SPF (a TXT plus an MX on a
   `send` name, or CNAMEs) and DKIM (a TXT at `resend._domainkey...`). Add each
   exactly as shown ([Adding the DNS records](#adding-the-dns-records)). On
   Cloudflare, set every CNAME to **DNS only** (grey cloud).
4. Click **Verify DNS Records**. It usually passes within 15 minutes. The
   status goes `pending` → `verified`. After 72 hours without success it
   fails; fix the records and click **Restart verification**.
5. Add DMARC yourself: a TXT record named `_dmarc` with the value
   `v=DMARC1; p=none; rua=mailto:you@example.com;`.
6. **API Keys** → **Create API Key**: a name, **Permission**: **Sending
   access**, and optionally limit it to your domain. **Copy the key now**; it
   is shown once.
7. Values for `.env.production`:

   ```bash
   EMAIL_HOST=smtp.resend.com
   EMAIL_PORT=465
   EMAIL_SECURE=true
   EMAIL_USER=resend                       # literally the word "resend"
   EMAIL_PASSWORD=re_...                   # the API key
   EMAIL_FROM_NAME=MyApp
   EMAIL_FROM_ADDRESS=noreply@mail.example.com   # on the verified domain
   ```

   Port `587` with `EMAIL_SECURE=false` works too.

## Amazon SES

For when volume grows. Shorter, because the AWS console changes often:

1. Open the SES console in the AWS region you want to send from (e.g.
   `eu-west-1`). Note the region: the SMTP host and credentials belong to it.
2. **Identities** → **Create identity** → **Domain** → `example.com`. Keep
   **Easy DKIM**. SES lists three CNAME records: add them to your DNS
   ([below](#adding-the-dns-records)). The identity turns **Verified** once SES
   sees them.
3. New accounts start in the **sandbox**: mail only to verified addresses, at
   most 200 a day. Ask for production access: **Account dashboard** → **Request
   production access** (it may sit behind **View Get set up page**), mail
   type **Transactional**. AWS answers in about a day.
4. **SMTP settings** → **Create SMTP credentials** → **Create user** → **Show**
   or **Download .csv file**. Shown once. These are **not** your AWS access
   keys, and they only work in this region.
5. Values for `.env.production`:

   ```bash
   EMAIL_HOST=email-smtp.eu-west-1.amazonaws.com   # your region
   EMAIL_PORT=587
   EMAIL_SECURE=false
   EMAIL_USER=AKIA...                  # SMTP user name from the CSV
   EMAIL_PASSWORD=...                  # SMTP password from the CSV
   EMAIL_FROM_NAME=MyApp
   EMAIL_FROM_ADDRESS=noreply@example.com
   ```

## Gmail, for a quick test only

You can send through your Gmail account to try real delivery from your
machine. **Don't use it in production**: no DKIM for your own domain, a low
limit (500 a day), and your personal account's reputation is at stake.

1. Turn on 2-Step Verification on the Google account.
2. Open <https://myaccount.google.com/apppasswords>, name it `myapp-dev`,
   click **Create**, and copy the 16-character password. (Not offered for
   work or school accounts, or with Advanced Protection.)
3. Values for `.env.development` (with `pnpm start:dev`, see
   [Development: Mailpit](#development-mailpit)):

   ```bash
   EMAIL_HOST=smtp.gmail.com
   EMAIL_PORT=587
   EMAIL_SECURE=false
   EMAIL_USER=you@gmail.com
   EMAIL_PASSWORD=abcdefghijklmnop     # the app password, no spaces
   EMAIL_FROM_ADDRESS=you@gmail.com
   ```

Changing the Google password revokes every app password.

## Adding the DNS records

You add the records wherever your domain's DNS is managed: your registrar, or
Cloudflare if you moved it there ([domain-dns-tls.md](./domain-dns-tls.md)).
On Cloudflare:

1. <https://dash.cloudflare.com> → your domain → **DNS** → **Records** →
   **Add record**.
2. **Type**: the type the provider shows (TXT, CNAME or MX).
3. **Name**: the name the provider shows. Cloudflare adds your domain itself:
   for `resend._domainkey.example.com`, enter `resend._domainkey`. For a
   record on the domain itself, enter `@`.
4. **Content** (or **Target**, **Mail server**): paste the provider's value
   exactly. For MX, also set the **Priority** shown.
5. **Proxy status**: **DNS only** (grey cloud) for every CNAME. A proxied
   CNAME breaks DKIM.
6. **Save**. Repeat for each record.

If you already have an SPF record (`v=spf1 ...`) on the same name, don't add a
second one: put the new provider's `include:` into the existing record, e.g.
`v=spf1 include:_spf.google.com include:amazonses.com ~all`.

Start DMARC at `p=none` and watch the reports for a few weeks before moving to
`quarantine`.

## Put the settings in the env file

All in the **API's** `.env.production` ([validation.ts](../../src/config/validation.ts)):

| Variable | Required | Value |
|---|---|---|
| `EMAIL_HOST` | **Yes, in production** | The provider's SMTP host |
| `EMAIL_PORT` | | `587` (default) or `465` |
| `EMAIL_SECURE` | | `false` with 587, `true` with 465 |
| `EMAIL_USER` | | The SMTP login. Empty means "don't log in", which only a private relay or Mailpit accepts |
| `EMAIL_PASSWORD` | | The SMTP password or key. **Secret** |
| `EMAIL_FROM_NAME` | | The name people see, e.g. your app's name |
| `EMAIL_FROM_ADDRESS` | | An address on the authenticated domain |
| `FRONTEND_URL` | **Yes, in production** | `https://app.example.com`: the links in the emails point at the web app's pages |
| `SUPPORT_EMAIL` | | Optional. An address named in the two-step sign-in and account-deleted emails, where only a person can help |

Apply them with the next `./deploy.sh` ([../deploy.md](../deploy.md)). Check
the file first: `pnpm env:check .env.production` reports every problem without
printing a value ([../environment.md](../environment.md#checking-a-file)).

## Check it works

**In development**, sign up and read the code in Mailpit:

```bash
curl -s -X POST http://localhost:8888/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"first@example.com","password":"Correct-Horse-42"}'
```

The answer is `202` "Check your email to continue." Open
<http://localhost:8025>: the message "Verify your YourAppName account" holds
the six-digit code. (With Turnstile on, use the web app's sign-up page
instead, or see [cloudflare-turnstile.md](./cloudflare-turnstile.md#check-it-works).)

**In production**, sign up on the web app with an address you can read, or
use the same `curl` against `https://api.example.com`. Then:

1. The email arrives within a minute, in the inbox and not in spam.
2. In Gmail, open it → **⋮** → **Show original**. **SPF**, **DKIM** and
   **DMARC** should all say `PASS`. A `FAIL` names the record to fix.
3. Nothing arrived? The API answers `202` before the email is sent (it is
   queued, so a slow provider never slows sign-up), so look in the log:

   ```bash
   docker logs nestapp-hexagonal-auth-prod 2>&1 | grep 'of auth failed'
   ```

   A send is tried 3 times; when the last try fails, the log says
   `Job send-code of auth failed after 3 attempt(s): <reason>`. The reason is
   the provider's own message, e.g. `Invalid login: 535 ...`.

## Common mistakes

| You see | Why | Fix |
|---|---|---|
| API won't start: `"EMAIL_HOST" is required in production` | `EMAIL_HOST` is empty in `.env.production` | Set the provider's host |
| `Invalid login: 535` in the log | Wrong user or password. With Brevo, the API key instead of the SMTP key; with Resend, a user other than `resend`; with SES, your AWS keys instead of the SMTP credentials | Copy the SMTP credentials again |
| The send hangs, then `Greeting never received` or `ETIMEDOUT` | Port and `EMAIL_SECURE` don't match (465 needs `true`, 587 needs `false`), or the server's host blocks outgoing port 587/465 | Fix the pair; try 2525 if the provider has it; some cloud hosts block SMTP until you ask them |
| Mail lands in spam | SPF, DKIM or DMARC missing or failing, or the From address isn't on the authenticated domain | Check **Show original**; fix the record it names |
| `550` "sender not verified" or similar | `EMAIL_FROM_ADDRESS` is on a domain the provider hasn't verified | Use an address on the verified domain |
| SES: mail only reaches your own addresses | The account is still in the sandbox | Request production access |
| It worked for months, then stopped (Brevo) | The SMTP key expired, or was deactivated after 90 days without a send | Generate a new key |
| Development mail never leaves Mailpit | `pnpm docker:dev` forces Mailpit, whatever the env file says | Expected. Use `pnpm start:dev` to test a provider |
| Two SPF records on the domain | Each provider's guide said "add this SPF record" | Merge them into one `v=spf1 ... ~all` |
| Email links open `localhost` | `FRONTEND_URL` not set to the public web app address | `FRONTEND_URL=https://app.example.com` |

Related: [../auth/emails.md](../auth/emails.md) (every email and its
template), [domain-dns-tls.md](./domain-dns-tls.md) (where DNS lives),
[../environment.md](../environment.md#email),
[prepare-for-production.md](./prepare-for-production.md).
