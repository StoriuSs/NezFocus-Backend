# Domain, DNS and HTTPS

To put the app on the internet you need a name for it (`example.com`), DNS
records that point that name at your server, and an HTTPS certificate so
browsers trust it. This page does all three, in order, for the two addresses
the starters use:

| Name | Serves | Set up from |
|---|---|---|
| `api.example.com` | This API | this repository's `nginx/bootstrap-nginx.sh` |
| `app.example.com` | The web app (React starter) | the web app repository's own `nginx/bootstrap-nginx.sh` |

It is for production only. In development everything runs on `localhost`.
Preparing the server itself (updates, SSH, fail2ban, swap) is
[../server.md](../server.md).

| | |
|---|---|
| Needed in development | No |
| Needed in production | **Yes** |
| Cost | The domain, roughly $10 to $15 a year for a `.com`. Cloudflare DNS (free plan) and Let's Encrypt certificates are free |
| Time | 30 minutes of work, plus waiting for DNS (minutes to a day) |
| You end with | `https://api.example.com` answering, with a certificate that renews itself |

- [1. Buy a domain](#1-buy-a-domain)
- [2. Put the domain's DNS on Cloudflare](#2-put-the-domains-dns-on-cloudflare)
- [3. Point the names at your server](#3-point-the-names-at-your-server)
- [4. Open the firewall](#4-open-the-firewall)
- [5. HTTPS for the API](#5-https-for-the-api)
- [6. HTTPS for the web app](#6-https-for-the-web-app)
- [7. Tell the app its addresses](#7-tell-the-app-its-addresses)
- [Optional: Cloudflare's proxy (orange cloud)](#optional-cloudflares-proxy-orange-cloud)
- [Check it works](#check-it-works)
- [Common mistakes](#common-mistakes)

## 1. Buy a domain

Any **registrar** (the shop that sells domain names) works: Cloudflare
Registrar, Namecheap, Porkbun, Gandi, or your hosting provider.

- Cloudflare Registrar sells at cost, but needs the domain's DNS on Cloudflare
  first ([step 2](#2-put-the-domains-dns-on-cloudflare)); you can move it
  there later.
- Turn on **auto-renew**. An expired domain takes the API, the web app and
  your email down at once.
- Turn on WHOIS privacy if the registrar offers it (most do, for free).

## 2. Put the domain's DNS on Cloudflare

**DNS** is the internet's phone book: it turns `api.example.com` into your
server's IP address. Your registrar runs it by default. This guide uses
Cloudflare's free DNS, because the starter is ready for Cloudflare's proxy
([later](#optional-cloudflares-proxy-orange-cloud)). Your registrar's DNS is fine as well: skip to
[step 3](#3-point-the-names-at-your-server) and add the same records there.

1. Sign up at <https://dash.cloudflare.com>.
2. **Domains** → **Onboard a domain** (older dashboards: **Add a site**).
   Enter `example.com` (the domain itself, no `www` or `api`) → **Continue**.
3. Choose the **Free** plan.
4. Cloudflare scans your existing records and lists them. Keep anything you
   already use, especially mail records (MX, SPF, DKIM).
5. If **DNSSEC** is on at your registrar, turn it off there first. Changing
   nameservers with DNSSEC on makes the domain unreachable. You can turn
   DNSSEC on again through Cloudflare afterwards.
6. Cloudflare shows two **nameservers** (like `ada.ns.cloudflare.com`). At
   your registrar, find the domain's nameserver setting, choose custom
   nameservers, and replace the existing ones with these two.
7. Wait until the domain's **Overview** page in Cloudflare says **Active**.
   Usually minutes, at most about a day. Cloudflare emails you.

## 3. Point the names at your server

An **A record** says "this name is at this IPv4 address". Make one per name.

1. Cloudflare → your domain → **DNS** → **Records** → **Add record**.
2. Fill in:

   | Field | API | Web app |
   |---|---|---|
   | **Type** | `A` | `A` |
   | **Name** | `api` | `app` |
   | **IPv4 address** | your server's public IP | the same (or the web app's server) |
   | **Proxy status** | **DNS only** (grey cloud) | **DNS only** (grey cloud) |
   | **TTL** | Auto | Auto |

3. **Save** after each.
4. If the server has an IPv6 address, add `AAAA` records for both names too
   (the nginx template listens on IPv6). If it doesn't, make sure no old
   `AAAA` record exists for these names: Let's Encrypt tries IPv6 first.

Start with **DNS only**. The certificate is easier to get that way; you can
switch on the proxy afterwards.

Email records (SPF, DKIM, DMARC for your mail provider) go here too: see
[email.md](./email.md#adding-the-dns-records).

Check, from your own machine:

```bash
dig +short api.example.com      # your server's IP
dig +short app.example.com      # your server's IP
```

(On Windows without `dig`: `nslookup api.example.com`.) Don't go on until both
print the right address.

## 4. Open the firewall

Only three ports need to be reachable from the internet:

| Port | Why |
|---|---|
| 22/tcp | SSH, for you and for GitHub's Deploy button |
| 80/tcp | HTTP. Let's Encrypt checks you own the name over port 80, and nginx redirects everything else to HTTPS |
| 443/tcp | HTTPS |

Set it in your provider's firewall (security group, cloud firewall), or with
`ufw` on the server: `sudo ufw allow 22,80,443/tcp && sudo ufw enable`
(allow 22 before enabling, or you lock yourself out). Details:
[../server.md](../server.md#the-firewall). The database, Redis and monitoring
are bound to `127.0.0.1` by the compose file; don't open their ports.

## 5. HTTPS for the API

**nginx** is the web server in front of the API. It answers on ports 80 and
443, handles HTTPS, and passes requests to the API container on
`127.0.0.1`. **certbot** gets a free certificate from **Let's Encrypt** and
renews it. [nginx/bootstrap-nginx.sh](../../nginx/bootstrap-nginx.sh) sets up
both, once per server.

**Before you run it:**

- The repository is cloned on the server ([../deploy.md](../deploy.md)).
- `dig +short api.example.com` prints this server's IP.
- Ports 80 and 443 are open.
- You know the API's host port: `PORT` in `.env.production`, the port the
  container is published on (`127.0.0.1:${PORT}:3000` in
  [docker-compose.prod.yaml](../../docker-compose.prod.yaml)). nginx proxies to
  3000 by default. `.env.example` ships `PORT=8888` for development, so set
  `PORT=3000` in `.env.production`, or pass `--api-port 8888` below.

**Run it** from the repository's folder on the server:

```bash
sudo ./nginx/bootstrap-nginx.sh --api-domain api.example.com --email you@example.com
```

The script takes these flags, and only these:

| Flag | Default | What it is |
|---|---|---|
| `--api-domain` | (required) | The API's public name |
| `--api-port` | `3000` | The host port nginx passes requests to. Must equal `PORT` in `.env.production` |
| `--email` | (required, unless `--skip-certbot`) | Your Let's Encrypt account's contact address. Let's Encrypt no longer sends expiry warnings; renewal is automatic |
| `--site-name` | `nest-api` | The file name under `/etc/nginx/sites-available/`. Change it only to run a second copy of the starter on the same server |
| `--skip-certbot` | off | Set up nginx on HTTP only, and print the certbot command to run later (when DNS isn't ready yet) |

`--help` prints the same. Any other flag stops it with `Unknown flag`. (An
older page passed `--auth-domain`; that was for a sign-in server this starter
no longer has.)

**What it does**, in order:

1. Installs `nginx`, `certbot` and `python3-certbot-nginx` with `apt`.
2. If `ufw` is active, allows `Nginx Full` (ports 80 and 443).
3. Writes [nginx/app.conf.template](../../nginx/app.conf.template) to
   `/etc/nginx/sites-available/nest-api`, with your domain and port filled in,
   enables it and removes nginx's default site.
4. Checks the configuration (`nginx -t`) and reloads nginx.
5. Runs `certbot --nginx -d api.example.com --email ... --agree-tos --redirect
   --non-interactive`: gets the certificate, adds the HTTPS part to the nginx
   file, and redirects HTTP to HTTPS.
6. Makes sure `certbot.timer` is running: it renews the certificate before it
   expires (Let's Encrypt certificates last 90 days today, and are getting
   shorter; the timer handles that).

Running it again is safe. It rewrites the nginx file from the template and, if
a certificate already exists, re-attaches it instead of asking for a new one.

The template also:

- blocks `/api/v1/metrics` and `/admin/queues` from the internet (they answer
  `403` from outside; reach them over SSH);
- limits request bodies to 6 MB (the 5 MB avatar limit plus room);
- passes the visitor's real IP to the API, also behind Cloudflare's proxy
  ([below](#optional-cloudflares-proxy-orange-cloud)).

Certbot's own install guide now recommends the snap package instead of `apt`.
Both work; don't mix them. If you switch to the snap, remove the `apt` one
first (`sudo apt-get remove certbot`), and note that its timer is then
`snap.certbot.renew.timer`, and that running this script again would install
the `apt` copy back.

## 6. HTTPS for the web app

The web app's repository ships its own script with its own flags. From that
repository's folder on the server:

```bash
sudo ./nginx/bootstrap-nginx.sh --frontend-domain app.example.com --email you@example.com
```

Its default site name is `react-app`, so it doesn't overwrite the API's. Its
port flag is `--frontend-port` (default `8081`). See that repository's docs.

## 7. Tell the app its addresses

With the names working, set them in the **API's** `.env.production`:

```bash
BASE_URL=https://api.example.com
FRONTEND_URL=https://app.example.com
CORS_ORIGINS=https://app.example.com
```

- `BASE_URL` is the API's public address. Google's redirect URI and the links
  to locally stored uploads are built from it
  ([google-sign-in.md](./google-sign-in.md)).
- `FRONTEND_URL` is where email links and the Google sign-in return go.
- `CORS_ORIGINS` lists the web pages allowed to call the API with cookies.

`api.example.com` and `app.example.com` share the domain `example.com`, so
the sign-in cookie works with the default `AUTH_COOKIE_SAMESITE=lax`. Putting
the API and the web app on two unrelated domains needs other settings:
[../auth/sessions-and-tokens.md](../auth/sessions-and-tokens.md).

The web app's side is its `VITE_API_URL=https://api.example.com/api/v1`, set
in its own repository. Then deploy both ([../deploy.md](../deploy.md)).

## Optional: Cloudflare's proxy (orange cloud)

With **Proxy status** set to **Proxied**, visitors connect to Cloudflare, and
Cloudflare connects to your server. What changes:

| | DNS only (grey) | Proxied (orange) |
|---|---|---|
| Who sees your server's IP | Everyone (`dig` prints it) | Only Cloudflare; `dig` prints Cloudflare's addresses |
| Attacks that flood the server | Reach the server | Cloudflare absorbs most |
| HTTPS | Your Let's Encrypt certificate | Cloudflare's certificate to visitors, yours between Cloudflare and the server |
| The visitor's IP, as the API sees it | Direct | Restored by nginx from Cloudflare's `CF-Connecting-IP` header (below) |
| SSH to the name | Works | Doesn't: the proxy only carries web traffic. Use the IP for `DEPLOY_HOST` ([github.md](./github.md)) |

**The real IP.** Behind the proxy, every request arrives from a Cloudflare
address. [nginx/app.conf.template](../../nginx/app.conf.template) lists
Cloudflare's address ranges (`set_real_ip_from`) and, for requests from
those, takes the visitor's address from `CF-Connecting-IP`. nginx then sends
it on in `X-Forwarded-For`, and the API trusts exactly one proxy hop
(`trust proxy 1`). Without that, every visitor would share one address, and
the rate limits would lock everyone out together. The block does nothing
with DNS only, so it is safe to leave in. Cloudflare changes its ranges
rarely; compare the template's list with <https://www.cloudflare.com/ips-v4>
and <https://www.cloudflare.com/ips-v6> now and then (the template notes when
it was last refreshed). More in
[../rate-limit.md](../rate-limit.md#behind-nginx-and-cloudflare).

**Turning it on:**

1. Get the certificates first, with DNS only ([step 5](#5-https-for-the-api),
   [step 6](#6-https-for-the-web-app)).
2. Cloudflare → your domain → **SSL/TLS** → **Overview** → set the encryption
   mode to **Full (strict)**. (If you see **Automatic SSL/TLS** selected,
   choose **Custom** and then **Full (strict)**.) "Strict" means Cloudflare
   checks your server's certificate, which your Let's Encrypt certificate
   passes.
3. **DNS** → **Records** → edit `api` and `app` → **Proxy status**
   **Proxied** → **Save**.

**Never choose Flexible.** Flexible means Cloudflare talks to your server over
plain HTTP; nginx redirects HTTP to HTTPS; Cloudflare follows with HTTP again;
the browser ends with "too many redirects".

Renewal keeps working when proxied: Let's Encrypt checks over port 80, which
Cloudflare passes through.

## Check it works

On the server:

```bash
sudo nginx -t                          # syntax is ok, test is successful
sudo certbot certificates              # api.example.com, with its expiry date
sudo certbot renew --dry-run           # renewal would succeed
systemctl status certbot.timer         # active (waiting)
```

From anywhere, once the API is deployed:

```bash
curl -I https://api.example.com/api/v1/health/live      # HTTP/2 200 (or HTTP/1.1 200)
curl -I http://api.example.com/api/v1/health/live       # 301 to https://
curl -s -o /dev/null -w '%{http_code}\n' https://api.example.com/api/v1/metrics   # 403
```

And in a browser, <https://api.example.com/api/v1/health/live> shows a padlock.
Then add an outside uptime check, which also tells you if a certificate ever
fails to renew: [uptime-check.md](./uptime-check.md).

## Common mistakes

| You see | Why | Fix |
|---|---|---|
| `Certbot failed — check that the DNS A-record for the domain points to this VPS` | The name doesn't resolve to this server yet, port 80 is closed, or an old `AAAA` record points elsewhere | Check `dig +short api.example.com` and `dig AAAA +short api.example.com`; open port 80; run the script again |
| certbot: too many failed authorizations | Let's Encrypt allows only a few failed checks per name per hour | Fix DNS or the firewall, wait an hour, then retry (`--skip-certbot` sets up the rest meanwhile) |
| `Unknown flag: --auth-domain` | An old instruction | Use only `--api-domain`, `--api-port`, `--email`, `--site-name`, `--skip-certbot` |
| `502 Bad Gateway` | nginx can't reach the API: it isn't running, or `--api-port` doesn't match `PORT` in `.env.production` | `docker ps`; make the port agree (rerun the script with `--api-port`, or change `PORT` and deploy) |
| "Too many redirects" with the orange cloud | Cloudflare's SSL mode is **Flexible** | **SSL/TLS** → **Full (strict)** |
| `526 Invalid SSL certificate` with the orange cloud | **Full (strict)**, but the server's certificate is missing or expired | Turn the proxy off, run the script, turn it back on |
| The domain stopped resolving after moving to Cloudflare | DNSSEC was still on at the registrar | Turn DNSSEC off at the registrar; turn it on later through Cloudflare |
| The Deploy button can't connect | `DEPLOY_HOST` is a proxied name | Use the server's IP, or a DNS-only name |
| Every visitor hits the rate limit at once | Another proxy in front of nginx (a load balancer) that the trust settings don't know | See [../rate-limit.md](../rate-limit.md#behind-nginx-and-cloudflare) |
| `403` on `/api/v1/metrics` or `/admin/queues` | Expected: the template blocks them from outside | Use an SSH tunnel |
| Certificate expired | `certbot.timer` not running, or two certbot installs (apt and snap) fighting | `systemctl status certbot.timer`; keep one install; `sudo certbot renew` |

Related: [../server.md](../server.md) (the server itself),
[../deploy.md](../deploy.md), [email.md](./email.md) (mail DNS records),
[github.md](./github.md) (`DEPLOY_HOST`),
[prepare-for-production.md](./prepare-for-production.md).
