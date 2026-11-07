# Preparing a server

Everything on the machine that isn't the app itself: keeping it patched, making
brute-force attempts pointless, and leaving enough headroom that a busy moment
doesn't kill a container. Half of it is already true on a fresh Ubuntu server;
this page says which half, so you only do the rest.

It assumes one small server running this starter with `deploy.sh`
([deploy.md](./deploy.md)). Ubuntu is assumed; other distributions have the
same tools under the same names.

- [What the starter already does](#what-the-starter-already-does)
- [Security updates](#security-updates)
- [fail2ban: ban repeated failed logins](#fail2ban-ban-repeated-failed-logins)
- [Swap: room to breathe](#swap-room-to-breathe)
- [SSH](#ssh)
- [The firewall](#the-firewall)
- [The reverse proxy and HTTPS](#the-reverse-proxy-and-https)
- [Disk](#disk)
- [The clock](#the-clock)
- [A checklist](#a-checklist)

---

## What the starter already does

Before adding anything, know what you don't have to do:

| Already handled | Where |
|---|---|
| Postgres, Redis and the monitoring tools are reachable **only from the machine itself** | `docker-compose.prod.yaml` binds them to `127.0.0.1` |
| Container logs can't fill the disk | each service has a `logging:` block with a size cap ([logging.md](./logging.md)) |
| Old release images are removed | `deploy.sh` keeps the last few and prunes the rest |
| TLS, and its renewal | `nginx/bootstrap-nginx.sh` sets up certbot's timer |
| A release that can't serve is not promoted | the healthcheck asks `/health/ready`, and `deploy.sh` rolls back |
| Someone is told when the disk, memory or a service goes wrong | the alert rules ([alerts.md](./alerts.md)) |
| The database is dumped nightly, and can be restored | the backup service ([backups.md](./backups.md)) |

What follows is what the server itself needs.

---

## Security updates

A server that is never updated is the most common way a small site is taken
over: a hole is published, and machines that never applied the fix are found by
scanning.

**Ubuntu already does this.** `unattended-upgrades` is installed and enabled on
Ubuntu Server images, including AWS's, and applies **security** updates by
itself. Check:

```bash
systemctl is-active unattended-upgrades      # active
cat /etc/apt/apt.conf.d/20auto-upgrades      # both lines "1"
```

If it isn't there: `sudo apt install unattended-upgrades` and
`sudo dpkg-reconfigure --priority=low unattended-upgrades`.

**What it does not do:** reboot. A kernel update is downloaded and installed,
but the machine keeps running the old one until it restarts. Check whether a
reboot is pending with `ls /var/run/reboot-required`, and either reboot when it
suits you (`sudo reboot`, the containers come back by themselves, so a deploy
isn't needed) or let it happen automatically by editing
`/etc/apt/apt.conf.d/50unattended-upgrades`:

```
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
```

Automatic reboots are a fair trade on one small server with backups and health
checks; on a machine people depend on during the night, do it by hand.

---

## fail2ban: ban repeated failed logins

**What it is:** a small service that watches the log of a service — SSH here —
and, when the same address fails to log in several times in a row, tells the
firewall to drop that address for a while. It doesn't decide who may log in;
it only stops the same machine from trying thousands of times.

**Why you want it even with keys only.** Password login is off on this server,
so the attempts can never succeed — but they never stop, either. With port 22
open to the internet (which the Deploy button needs, see
[deploy.md](./deploy.md)) a fresh server sees thousands of them a day. fail2ban
turns that into a handful of lines and spares the load.

```bash
sudo apt install -y fail2ban
```

Then one file of your own, so a package update never overwrites your settings:

```bash
sudo tee /etc/fail2ban/jail.d/sshd.local >/dev/null <<'CONF'
[sshd]
enabled = true
# Ubuntu's ssh logs go to systemd's journal, not to a file.
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
CONF
sudo systemctl enable --now fail2ban
sudo systemctl restart fail2ban
```

That reads: five failures within ten minutes, and the address is dropped for an
hour. Raising `bantime` to `24h` is reasonable once you are sure your own
address is never the one failing.

**Check it:**

```bash
sudo fail2ban-client status sshd
```

```
Status for the jail: sshd
|- Filter
|  |- Currently failed:  0
|  |- Total failed:      0
`- Actions
   |- Currently banned:  0
   |- Total banned:      0
```

**Try it without locking yourself out** — ban a documentation address, then
release it:

```bash
sudo fail2ban-client set sshd banip 203.0.113.5
sudo fail2ban-client get sshd banned        # ['203.0.113.5']
sudo fail2ban-client set sshd unbanip 203.0.113.5
```

**If you ban yourself** (five wrong keys in ten minutes will do it), you are
locked out for `bantime`. Ways back in: your cloud provider's serial or browser
console, another machine whose address isn't banned, or simply waiting. Then
`sudo fail2ban-client set sshd unbanip <your address>`.

**Web traffic.** fail2ban can also watch nginx's logs, but on a public API
"too many requests from one address" is the app's job, and it does more than
count requests:

- the global rate limiter caps every route per signed-in user, or per IP
  without a valid access token ([rate-limit.md](./rate-limit.md));
- sign-in has its own limits: 5 failed sign-ins per email address in 15
  minutes and 30 per IP in 5 minutes, limits on code emails, wrong codes and
  sign-ups
  ([auth/rate-limits.md](./auth/rate-limits.md)).

These know which account is being guessed at, which nginx's log does not.
Adding an nginx jail mainly risks banning a whole office behind one address.

---

## Swap: room to breathe

**What it is:** disk the kernel may use when memory runs out. It is much
slower than memory, so it is not extra capacity — it is the difference between
"slow for a moment" and "the kernel kills Postgres".

The production stack fits in 4 GB with room to spare, but migrations, a backup
and an image build at the same time can spike. 2 GB of swap costs 2 GB of disk
and removes that risk:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab     # survives a reboot
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
sudo sysctl -w vm.swappiness=10
```

`swappiness=10` means "use memory; take swap only when you must". Check with
`free -m` — the Swap line should show the size, and `used` should stay near
zero. If swap is in constant use, the machine is too small; add memory rather
than more swap.

---

## SSH

On Ubuntu's cloud images this is already right, and the thing to do is **not
break it**. Check what is actually in force:

```bash
sudo sshd -T | grep -E '^(passwordauthentication|permitrootlogin|pubkeyauthentication)'
```

```
permitrootlogin prohibit-password
pubkeyauthentication yes
passwordauthentication no
```

- **`passwordauthentication no`** is what makes the endless login attempts
  harmless. Never turn it on to "just quickly" do something.
- **Keep your own key safe.** It is the only way in.
- **One key per purpose**, so you can withdraw one without touching the others:
  yours, and the Deploy button's ([deploy.md](./deploy.md)). Each is a line in
  `~/.ssh/authorized_keys`; delete the line to withdraw it.
- **Changing the port** (`Port 2222`) removes most of the noise, because scans
  look at 22. It is not security — anyone scanning finds it — and it means
  every tool, including the Deploy button, has to know the port. Do it for
  quiet logs, not for safety.

---

## The firewall

Two layers, and you only need one of them to be right:

- **Your provider's**, outside the machine: AWS security groups, DigitalOcean's
  firewall, Hetzner's. This is the one to use — a mistake inside the machine
  can't lock traffic out of it.
- **The machine's** (`ufw`): useful when your provider has no firewall.
  `sudo ufw allow 22,80,443/tcp && sudo ufw enable`. Be careful: enabling it
  without allowing 22 first ends your session.

Only three ports need to be reachable: **22** (SSH), **80** (HTTP, which
Let's Encrypt needs even if you redirect it away) and **443** (HTTPS).
Everything else — the database, Redis, Prometheus,
Grafana — is bound to `127.0.0.1` by the compose file and cannot be reached
from outside, whatever the firewall says. To look at Grafana from your laptop,
forward it over SSH rather than opening a port:

```bash
ssh -L 3002:127.0.0.1:3002 ubuntu@<server>    # then open http://localhost:3002
```

(Grafana's host port is `GRAFANA_PORT`, 3002 by default.)

---

## The reverse proxy and HTTPS

The domain, the DNS records and Cloudflare's proxy setting come first:
[setup/domain-dns-tls.md](./setup/domain-dns-tls.md) walks through them.

Your containers listen on ports on `127.0.0.1`. Visitors arrive at port 443
asking for a hostname. nginx on the host is what connects the two: it answers
every request, decides which container it is for, and terminates HTTPS.

It runs on the **host**, not in a container, because certbot needs to renew
certificates on a schedule and because one nginx can serve several projects on
the same machine.

### Before you run it

The DNS `A` record for the API has to point at this server **already**.
Let's Encrypt proves you own a name by fetching a file over HTTP from it, so a
record that has not propagated means a failed certificate and a rate limit you
then have to wait out.

```bash
dig +short api.example.com     # must print this server's IP
```

There is one name to set up here. Sign-in is part of the API
(`https://api.example.com/api/v1/auth/...`): there is no separate sign-in
domain. The web app (`app.example.com`) has its own copy of this script in the
React starter.

### Run it

Once per server, from the cloned repository:

```bash
sudo ./nginx/bootstrap-nginx.sh \
    --api-domain  api.example.com \
    --email       you@example.com \
    --site-name   my-api
```

It installs nginx and certbot, renders `nginx/app.conf.template` into
`/etc/nginx/sites-available/<site-name>`, checks the configuration, obtains a
certificate, switches the name to HTTPS, and leaves certbot's systemd timer to
renew it. The flags it accepts are `--api-domain` (required), `--api-port`,
`--email` (required unless `--skip-certbot`), `--site-name` and
`--skip-certbot`; anything else stops it with "Unknown flag"
(`--help` prints the usage).

`--site-name` matters when you run both starters on one machine: the frontend
ships its own copy of this script, and two runs sharing a name would have the
second overwrite the first one's vhost. The defaults differ (`nest-api` and
`react-app`), so you only need the flag for a third project.

Other flags: `--api-port` (default 3000), and `--skip-certbot` to set up
HTTP only, useful when DNS is not ready yet; run the script again with the
certificate once it is.

**Behind Cloudflare's proxy you still need the certificate.** With the proxy
on (the orange cloud), Cloudflare terminates the visitor's HTTPS, then opens
its own connection to your server. Set Cloudflare's SSL mode to
**Full (strict)**, which requires a valid certificate on the server, so let
the script obtain one. `--skip-certbot` there would leave the
Cloudflare-to-server leg unencrypted (Flexible mode) or failing (Full
(strict)). [setup/domain-dns-tls.md](./setup/domain-dns-tls.md) covers the
proxy setting, SSL modes and the real client IP.

**`--api-port` must match `PORT` in `.env.production`.** Inside the container
the app always listens on 3000; `PORT` only picks the host side of the port
mapping (`127.0.0.1:${PORT:-3000}:3000` in `docker-compose.prod.yaml`).
`.env.example` sets `PORT=8888` for development, so a copied file gives a host
port of 8888, and nginx proxying to 3000 answers 502. Set `PORT=3000` in
`.env.production`, or pass `--api-port 8888`.

### Afterwards

```bash
sudo nginx -t                        # the configuration is valid
sudo systemctl status certbot.timer  # renewal is scheduled
curl -I https://api.example.com/api/v1/health/live
```

If a certificate ever expires, `sudo certbot renew` and then check that timer —
an expiry almost always means the timer was not running, not that renewal
failed.

---

## Disk

The two things that fill a small disk are images and logs, and both are
handled: `deploy.sh` prunes old release images, and every container's logs are
capped ([logging.md](./logging.md)). What is left is everything else you do by
hand over a year.

```bash
df -h /                    # how full
docker system df           # what Docker holds
docker system prune -a     # careful: removes every image no container uses,
                           # including the previous release you might roll back to
```

`HostDiskSpaceLow` (below 15% free, then again below 5%) and
`HostDiskWillFillIn24Hours` (the last six hours' trend) alert before this
becomes a problem ([alerts.md](./alerts.md), rules in
[`monitoring/prometheus/rules/host.yml`](../monitoring/prometheus/rules/host.yml)).

---

## The clock

A wrong clock breaks TLS certificates, token expiry and one-time codes.
`systemd-timesyncd` is enabled by default on Ubuntu; `timedatectl` should say
`System clock synchronized: yes`. That is the whole task.

---

## A checklist

For a new server, in this order:

- [ ] Only ports 22, 80 and 443 reachable, in the provider's firewall
- [ ] `sudo sshd -T | grep passwordauthentication` says `no`
- [ ] `systemctl is-active unattended-upgrades` says `active`
- [ ] fail2ban installed, `fail2ban-client status sshd` shows the jail
- [ ] Swap on, `swappiness` 10
- [ ] `timedatectl` says the clock is synchronised
- [ ] Docker and the compose plugin installed ([deploy.md](./deploy.md))
- [ ] nginx and certbot set up (`nginx/bootstrap-nginx.sh`)
- [ ] `.env.production` filled in and checked (`pnpm env:check .env.production`),
  with `PORT` matching nginx's `--api-port`
- [ ] `JWT_SECRET` generated for this server (`openssl rand -hex 32`), never
  the `.env.example` value
- [ ] Email sending works: sign-up needs the emailed code, so without SMTP
  nobody can create an account ([setup/email.md](./setup/email.md))
- [ ] If Google sign-in is on: the production redirect URI
  `https://api.example.com/api/v1/auth/google/callback` is registered with
  Google ([setup/google-sign-in.md](./setup/google-sign-in.md))
- [ ] Backups running, and one restore tried ([backups.md](./backups.md))
- [ ] Alerts arriving somewhere you read ([alerts.md](./alerts.md))
- [ ] An uptime check from outside ([external-monitoring.md](./external-monitoring.md))
