# Setting up the outside services

The starter runs on its own in development: Postgres, Redis, a mail catcher and
the monitoring tools all start in Docker on your machine. In production it
leans on a few services run by other companies: something that delivers email,
somewhere to send alerts, a domain name, and so on.

This folder holds one page per service. Each page says what the service is for
here, whether you need it, what it costs, and then walks you through its
website click by click until you have the key or address the starter needs,
and tells you exactly which setting it goes into.

**Not sure where to start?** Follow one of the two walkthroughs. They put the
pages below in the right order and tell you when you are done with each step:

- [prepare-for-development.md](./prepare-for-development.md): from a fresh
  laptop to the API running on your machine, with an account you signed up
  yourself. About 30 minutes, no accounts anywhere needed.
- [prepare-for-production.md](./prepare-for-production.md): from nothing to the
  first deploy on a server of your own, with email, alerts and backups set up.
  An afternoon.

## Every service at a glance

"Dev" means `.env.development` on your machine; "prod" means `.env.production`
on the server. Free tiers change: check the provider's pricing page before you
rely on a number.

| Service | What it does here | Dev | Prod | Free tier | Page |
|---|---|---|---|---|---|
| A domain, DNS and HTTPS | Gives the API and the web app their addresses (`api.example.com`, `app.example.com`) and certificates | No | **Required** | DNS and certificates are free; the domain itself costs about $10 a year | [domain-dns-tls.md](./domain-dns-tls.md) |
| A server | Runs the app, Postgres, Redis and the monitoring | No | **Required** | No (about $5 to $25 a month) | [../server.md](../server.md) |
| Email (SMTP) | Delivers the six-digit codes for sign-up and password reset | No: Mailpit catches every email | **Required**: nobody can confirm an account without it | Brevo, Resend and others have free plans | [email.md](./email.md) |
| Discord | Receives the alerts ("the database is down") | Optional, a test channel | **Required** (`ALERT_WEBHOOK_URL`) | Free | [discord-alerts.md](./discord-alerts.md) |
| Uptime check and heartbeat | Tell you from outside when the site, or the alerting itself, is down | No | **Required** uptime check, recommended heartbeat | UptimeRobot and Healthchecks.io are free at this size | [uptime-check.md](./uptime-check.md) |
| Off-site backup bucket | Keeps a copy of the nightly database dumps at another provider | No | Strongly recommended | A few cents a month (Backblaze B2, Cloudflare R2) | [offsite-backups.md](./offsite-backups.md) |
| Google sign-in | The "Continue with Google" button | Optional, a dev client | Optional | Free | [google-sign-in.md](./google-sign-in.md) |
| Cloudflare Turnstile | A bot check on sign-up, forgot-password and repeated failed sign-ins | Optional, test keys | Recommended | Free, unlimited | [cloudflare-turnstile.md](./cloudflare-turnstile.md) |
| Object storage (S3 or R2) | Stores profile pictures in a bucket instead of the server's disk | No: local disk, or RustFS in Docker | Optional (`STORAGE_TYPE=local` is fine on one server) | R2 has a monthly free allowance; S3 bills per use | [storage-s3-r2.md](./storage-s3-r2.md) |
| Sentry | Groups unexpected errors (500s, crashes) into issues and emails you about new ones | Optional | Optional, recommended | Developer plan: 5,000 errors a month, 1 user | [sentry.md](./sentry.md) |
| Grafana Cloud | Hosts the dashboards and alerts instead of running them on the server | Optional | Optional (`MONITORING=grafana-cloud`) | 10,000 metric series, 50 GB of logs, 14 days | [grafana-cloud.md](./grafana-cloud.md) |
| GitHub | Runs the tests on every push, stores the production image, the Deploy button, Renovate | CI runs on every push | Needed for the server to clone a private repository, and for `registry` mode and the Deploy button | 2,000 Actions minutes a month for private repositories | [github.md](./github.md) |

## How the pages are laid out

Every page follows the same order, so you can skim to the part you need:

1. **What it is for** here, and whether you need it.
2. **Cost**, and the free tier.
3. **Steps**, numbered, with the names of the buttons as the provider shows
   them. Providers redesign their screens: where a step says "if the screen
   differs", look for the same words nearby, the step itself does not change.
4. **Where each value goes**: the exact variable, and the file it goes in.
5. **Check it works**: one command or click that proves it.
6. **Common mistakes**: what usually goes wrong, and the fix.

## Where the values end up

| Kind of value | Goes in | Who reads it |
|---|---|---|
| Keys and passwords for the API | `.env.development` (your machine) or `.env.production` (the server). Both are git-ignored; only `.env.example` is committed | The app, `docker compose` and `deploy.sh` |
| Keys for the web app (the React starter) | That repository's own `.env.development` / `.env.production` | Vite in development; the container at start in production |
| Settings for GitHub Actions | The repository's **Settings → Secrets and variables → Actions** | The workflows in `.github/workflows/` |

Never commit a real key, and never paste one into an issue or a chat. If one
leaks, the page for that service says how to replace it.

Every variable is described in [../environment.md](../environment.md).
`pnpm env:check` checks a file against the same rules the app applies when it
starts ([../environment.md](../environment.md#checking-a-file)).
