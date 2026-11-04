# Load testing

Everything works on your laptop with one user. This page is about finding out
what happens with two hundred, **before** the two hundred turn up.

The scripts live in [`k6/`](../k6). They are meant to be run by hand, from your
own machine, against a server you can afford to break — a staging environment,
or a copy of production. They are deliberately not part of CI: a load test
needs a machine of a known size all to itself, and a GitHub runner is neither.

- [What each script answers](#what-each-script-answers)
- [Before you start](#before-you-start)
- [Installing k6](#installing-k6)
- [Getting a token](#getting-a-token)
- [Running them](#running-them)
- [Reading the result](#reading-the-result)
- [Choosing the numbers](#choosing-the-numbers)
- [Watching the server while it runs](#watching-the-server-while-it-runs)
- [When it fails](#when-it-fails)
- [Many users instead of one](#many-users-instead-of-one)
- [Sign-in during a load test](#sign-in-during-a-load-test)
- [Things that will catch you out](#things-that-will-catch-you-out)

## What each script answers

| Script | The question it answers | Roughly how long |
| --- | --- | --- |
| `k6/smoke.js` | Does it work at all — right URL, valid token, routes answering? | seconds |
| `k6/load.js` | Can it serve the traffic I expect, at a response time I am happy with? | as long as you ask for |
| `k6/spike.js` | When far more traffic arrives than it can serve, does it refuse the excess politely and recover? | 2½ minutes |
| `k6/upload.js` | Where does image processing hit its ceiling, and does the ceiling hold? | 2½ minutes |

Always run `smoke.js` first. It catches the boring mistakes — wrong host,
expired token, the API not started — in a few seconds, instead of two minutes
into a run whose numbers all turn out to be 401s.

## Before you start

**Not against production.** `load.js` and `smoke.js` change the signed-in
user's display name, and `upload.js` stores a new avatar for every successful
request. Point them at a throwaway environment.

**Turn the rate limiter up, or you will measure the rate limiter.** The API
allows `THROTTLE_LIMIT` requests per `THROTTLE_TTL` seconds *from one address
to one route* (each route has its own count; see
[rate-limit.md](./rate-limit.md#buckets-per-endpoint-per-ip)), and a load test
is one address sending everything. At the default of 100 a minute (the same in
the code and in `.env.example`), request 101 to a route onwards comes back 429
and your beautiful graph is a picture of the throttler. On the machine you are
testing, set something far above what the test will send:

```bash
THROTTLE_LIMIT=1000000
THROTTLE_TTL=60
```

Then restart the API. Put it back afterwards — and if you actually want to
*test* the rate limiter, that is a different exercise: leave the default in
place and watch the `rate_limited` metric climb.

**Expect alerts.** If [alerts](./alerts.md) are set up on the target
environment, a load test looks exactly like an incident: slow responses, a
burst of 4xx, high CPU. Either warn whoever watches the channel, or silence the
alerts for the duration ([how to silence](./alerts.md#maintenance-silencing-alerts)).

**Watch your own machine too.** k6 is efficient, but a few thousand requests a
second from a laptop over home wifi tests the laptop and the wifi. See
[Things that will catch you out](#things-that-will-catch-you-out).

## Installing k6

k6 is a single binary:

```bash
winget install --id GrafanaLabs.k6     # Windows
brew install k6                        # macOS
```

On Linux it comes from Grafana's own apt or yum repository rather than the
distribution's — [the install page](https://grafana.com/docs/k6/latest/set-up/install-k6/)
has the three lines that add it. Check the result with `k6 version`.

**Or run it in a container**, which installs nothing:

```bash
docker run --rm -v "$PWD/k6:/k6:ro"   -e API_URL=http://host.docker.internal:8888 -e TOKEN   grafana/k6 run /k6/smoke.js
```

The only awkward part is letting the container reach your server.
`host.docker.internal` is the host machine as seen from inside a container on
Docker Desktop; on Linux, add `--add-host=host.docker.internal:host-gateway`.
If the API is itself running in Compose on the same machine, it is simpler to
join its network and use the service name:

```bash
docker run --rm --network myproject_backend -v "$PWD/k6:/k6:ro"   -e API_URL=http://app:3000 ... grafana/k6 run /k6/smoke.js
```

## Getting a token

Every script except the public health checks needs an access token. Two ways.

**The quick way — paste one in.** Sign in to the frontend, open the browser's
developer tools, and copy the token the app is using (in this starter, the
network tab shows it in the `Authorization` header of any API request). Then:

```bash
k6 run -e API_URL=https://api.example.com -e TOKEN=eyJhbGciOi... k6/smoke.js
```

Access tokens are short-lived, so this suits a smoke run rather than a
ten-minute load test.

**The proper way — let k6 sign in.** Give it an account and it signs in through
the API's own `POST /auth/login`, once per virtual user, and again shortly
before the token expires:

```bash
export API_URL=https://api.example.com
export LOAD_EMAIL=loadtest@example.test
export LOAD_PASSWORD='...'

pnpm load:accounts        # creates the account, confirmed (not in production)
k6 run k6/smoke.js
```

The account must exist, be confirmed, and **not have two-step sign-in on**.
`pnpm load:accounts` writes it straight into the database the app's
`DATABASE_URL` points at, with the same `LOAD_*` settings k6 reads; running it
again resets the password. It refuses to run with `NODE_ENV=production`.
Without a token or an account, the scripts skip their signed-in scenarios and
say so; the unauthenticated checks still run.

If k6 stops at the start with "The API refused the login for ...", the rest of
the message says why. The causes are in
[Sign-in during a load test](#sign-in-during-a-load-test).

## Running them

Each script has a `pnpm` shortcut, and all the settings are environment
variables, so they combine:

```bash
pnpm load:smoke                      # k6 run k6/smoke.js
pnpm load:test                       # k6 run k6/load.js
pnpm load:spike                      # k6 run k6/spike.js
pnpm load:upload                     # k6 run k6/upload.js

VUS=50 DURATION=5m pnpm load:test    # fifty users for five minutes
SPIKE_RATE=500 pnpm load:spike       # a harder spike
```

The settings, all optional except `API_URL`:

| Variable | Default | What it does |
| --- | --- | --- |
| `API_URL` | `http://localhost:8888` | Where the API is (8888 is the development `PORT`). No trailing slash needed. |
| `API_PREFIX` | `api` | Must match the API's own `API_PREFIX`. |
| `TOKEN` | — | Use this access token instead of signing in. |
| `LOAD_EMAIL`, `LOAD_PASSWORD` | — | The load-test account. Put `{n}` in the address to spread over several. |
| `LOAD_USER_COUNT` | `1` | Spread virtual users over several accounts — see [below](#many-users-instead-of-one). |
| `VUS` | `10` | Virtual users in `load.js`. |
| `DURATION` | `1m` | How long `load.js` holds that number. |
| `RAMP_UP`, `RAMP_DOWN` | `30s`, `10s` | How gradually `load.js` gets there and back. |
| `SPIKE_RATE` | `200` | Requests per second at the peak of `spike.js`. |
| `STEADY_RATE` | `5` | Requests per second of ordinary traffic during `spike.js`. |
| `READ_BUDGET_MS` | `500` | The 95th-percentile response time a read is allowed. |
| `WRITE_BUDGET_MS` | `1000` | The same for a write. |
| `UPLOAD_PEAK_VUS` | `20` | How many simultaneous uploaders `upload.js` climbs to. |

To keep the raw data for later comparison, add `--out json=run.json`. The file
is one JSON object per measurement, which is large but easy to filter.

## Reading the result

k6 prints a block of numbers at the end. These are the lines that matter.

```
    checks_total.......: 380     8.269467/s
    checks_succeeded...: 100.00% 380 out of 380

    CUSTOM
    rate_limited.......: 0.00%  0 out of 380

    HTTP
    http_req_duration..: avg=8ms     min=2ms    med=5.72ms  max=221.15ms p(95)=13.11ms
      { kind:read }....: avg=5.83ms  min=2ms    med=5.59ms  max=59.2ms   p(95)=10ms
      { kind:write }...: avg=11.26ms min=4.76ms med=11.94ms max=22.69ms  p(95)=15.09ms
    http_req_failed....: 0.00%  0 out of 390
    http_reqs..........: 390    8.487084/s

    EXECUTION
    iterations.........: 380    8.269467/s
    vus................: 1      min=1  max=10
```

(That is a real run: ten virtual users for forty seconds against a development
stack on a laptop.)

**`http_req_duration` — how long requests took.** Look at `p(95)`, not `avg`:
it means 95% of requests were faster than that and 5% were slower, which is
much closer to what a user experiences than an average that one fast route can
flatter. `max` is worth a glance too — a single 1.2s response in a run of
otherwise 40ms ones usually means something was warming up, or a garbage
collection, or one unlucky database query.

**`http_req_failed` — requests the server failed on.** In these scripts that
means 5xx responses and connections that never answered, *not* 4xx. A 429 or a
400 is the server working correctly, and counting those as failures would make
every rate-limited run look like an outage. This number should be zero.

There is one exception, in the two scripts that overload the server on purpose:
`spike.js` and `upload.js` also treat **503** as a correct answer, because
refusing work under overload is exactly what they are checking for. Everywhere
else a 503 counts as a failure.

**`checks_succeeded` — responses that were what the route is supposed to
give.** Each script lists the statuses it will accept. A failed check with no
failed request means the server answered, but answered something unexpected.

**`rate_limited` — the share of responses that were 429.** If this is not
approximately zero, re-read [Before you start](#before-you-start); you measured
the throttler.

**`server_errors`** — a plain count of 5xx responses, so you can see at a glance
whether there were any at all.

**`iterations`** — how many times the script's function ran. Divided by the run
length, that is roughly your requests per second. `http_reqs` is the same thing
counted in requests, including the sign-in traffic.

**`{ kind:read }` and `{ kind:write }`** — the same duration figures split by
what the request did. Writes being slower than reads is normal; writes being
*much* slower usually points at the database or a lock.

In `spike.js`, the interesting rows are the ones filtered by scenario:
`http_req_duration{scenario:steady}` is what an ordinary user experienced while
the burst was going on. That, not the burst's own numbers, is the result.

A run "fails" — k6 exits non-zero and marks the thresholds in red — when one of
the budgets in the script is missed. That is the point: it turns a wall of
numbers into a pass or a fail you can put in a release checklist.

## Choosing the numbers

The most common mistake is to pick a large `VUS` because large sounds
thorough. A virtual user is not a request: in `load.js` each one pauses about a
second between requests, so **50 virtual users ≈ 50 requests per second**.

Work backwards from what you actually expect:

- *"About 5,000 people use it a day, mostly between 9 and 6."* That is 5,000
  spread over nine hours ≈ 0.15 requests per second if each person makes one
  request. They don't: say each session is 20 requests, and half the traffic
  lands in two peak hours — that is 5,000 × 20 × 0.5 ÷ 7,200 ≈ **7 requests per
  second** at the peak.
- Test at that, then at 2× it, then at 5×. The useful finding is the shape:
  response times that stay flat to 5× mean you have room; response times that
  double between 1× and 2× mean you are already at the edge.

Start small and climb. A run that begins above what the server can do tells you
only that it broke, not where.

## Watching the server while it runs

The numbers k6 prints are the client's view. The server's view is in
[Grafana](./monitoring.md) — run the load test on one screen and the dashboards
on the other:

- **API dashboard** — request rate, response times and error rate as measured
  inside the app. If k6 says 400ms and Grafana says 20ms, the time is going
  somewhere between the two: the network, nginx, or a queue.
- **Postgres dashboard** — connections and slow queries. Connections pinned at
  the pool limit is the usual first ceiling.
- **Server dashboard** — CPU and memory. A CPU flat at 100% is a clear answer;
  memory climbing and never coming back down during a steady run is a leak.
- `docker stats` gives the same CPU and memory story in a terminal.

## When it fails

**Response times climb steadily with load.** Something is saturated. Check CPU
first, then the database connection pool (`DB_POOL_MAX`), then Redis. If CPU is
low and times are still climbing, it is usually waiting — for the database, or
on the image-processing queue.

**Times are fine, then suddenly cliff.** A limit was hit: the connection pool,
the image queue, the file descriptor limit, or memory starting to swap.

**5xx responses.** Read the logs for the same window — Grafana's Logs
dashboard, filtered to `level=error`, lined up with the spike in k6's output.
[Sentry](./error-tracking.md) will have the stack traces, though be aware a
load test can burn through a free plan's quota in one run; the reporter's own
rate cap keeps it to 10 events plus one every 6 minutes.

**Nothing but 429.** The rate limiter. See [Before you
start](#before-you-start).

**503 from the avatar route.** That is the image-processing cap refusing work
rather than melting — `IMAGE_PROCESSING_CONCURRENCY` and
`IMAGE_PROCESSING_QUEUE_LIMIT` in [`.env.example`](../.env.example). Raise them
only alongside memory: each concurrent resize holds a decoded image in memory.

**`upload.js` reports `image_queue_full` at 0%.** The cap never engaged, which
may mean your server is comfortable — or that the script never pushed hard
enough. Each virtual user waits for its upload before starting the next, so
nothing is refused until more uploads are in flight than
`IMAGE_PROCESSING_CONCURRENCY` plus `IMAGE_PROCESSING_QUEUE_LIMIT`. With the
shipped settings that is twelve, and `UPLOAD_PEAK_VUS` has to be above it. (On
a laptop, twenty uploaders against the defaults refused about two thirds of the
uploads and failed none of them — which is the cap working.)

**k6 itself reports `dial: i/o timeout` or refuses to go faster.** That is your
machine or your network, not the server. See below.

## Many users instead of one

With one account, every virtual user asks for the same profile, which is
answered from cache after the first request. That is a fine measurement of the
cache and a poor measurement of the database. For a realistic read mix, create
several accounts and set `LOAD_USER_COUNT`:

```bash
export LOAD_EMAIL='loadtest{n}@example.test'
export LOAD_USER_COUNT=50
pnpm load:accounts        # loadtest1@ … loadtest50@, all confirmed
```

Virtual user 1 signs in as `loadtest1@example.test`, virtual user 2 as
`loadtest2@example.test`, and so on. They all share one
password, which is acceptable for throwaway accounts on a throwaway
environment and nowhere else.

Each virtual user starts by signing in, and each sign-in is an argon2 hash —
deliberately slow. That makes the first seconds of a run slower than the rest,
which is why the scripts ramp up rather than starting at full load. The
sign-ins are tagged `auth login` and kept out of the API's numbers.

**The auth limits do not get in the way while the password is right**: only
*failed* sign-ins are counted. The global throttler does, as the top of this
page says. A wrong password is another matter; see the next section.

## Sign-in during a load test

The sign-in protections are built to stop exactly what a load test looks
like: many sign-ins from one address. With the right setup they stay out of
the way. Each of these stops k6 with "The API refused the login":

| k6 says | Cause | Fix |
|---|---|---|
| "two-step sign-in on" (HTTP 403, `AUTH_TWO_FACTOR_REQUIRED`) | The account has two-step sign-in on. `/auth/login` then answers with a challenge instead of an access token, and k6 cannot type a code from an authenticator app. `pnpm load:accounts` does **not** turn it off on an account that already exists | Use a fresh address, or turn it off: `pnpm auth:two-factor:off loadtest1@example.test` ([two-step-sign-in.md](./auth/two-step-sign-in.md)) |
| "Turnstile is asking for a check" (`AUTH_CAPTCHA_REQUIRED`) | Turnstile is on (`TURNSTILE_SECRET_KEY` set) and there were 2 or more failed sign-ins for that address, or from your IP, in the last 15 minutes. From then on every sign-in from there needs a solved CAPTCHA, which k6 cannot solve. A successful sign-in clears the address's count, not the IP's | Fix `LOAD_PASSWORD` and wait 15 minutes, or run against an environment with Turnstile off (both `TURNSTILE_*` keys empty) ([turnstile.md](./auth/turnstile.md)) |
| "not confirmed yet" | The address exists but never confirmed its email | `pnpm load:accounts` confirms it |
| "Wrong email or password" | `LOAD_PASSWORD` differs from the account's | Run `pnpm load:accounts` again with the same `LOAD_*`: it resets the password |
| "The sign-in limits refused it" (HTTP 429) | Too many failed sign-ins: 5 per address, or 10 per IP, in 15 minutes | Wait 15 minutes ([auth/rate-limits.md](./auth/rate-limits.md)) |

**A wrong password with many virtual users goes wrong fast.** Every virtual
user signs in at the start, all from your one IP. Ten of them failing is the
per-IP limit (10 failed sign-ins in 15 minutes), and every sign-in from your
IP is refused for the rest of the window, right password or not. If the
environment has [alerts](./alerts.md), more than 50 failures in 10 minutes
also fires `AuthFailedLoginSpike`. Run `smoke.js` first: one virtual user
finds a wrong password with one failure.

**Sessions pile up.** Each sign-in creates a session (a row in `Session`, with
its refresh token). k6 never signs out, and signs in again about every 14
minutes (the access token lasts `JWT_ACCESS_TTL_SECONDS`, 900 by default; k6
renews it 30 seconds early). Those sessions stay until they expire
(`AUTH_SESSION_TTL_DAYS`, 30 days) and are deleted a week later. On a
throwaway environment that does not matter; if you reuse one for months of
load tests, sign the accounts out everywhere now and then, or reset the
database.

**What to watch for sign-in.** On the API dashboard, the **Sign-in and
accounts** row shows `login_succeeded` climbing once per virtual user per
token, and no failures. The cache hit rate per cache tells you what "one
account against many" changes: with one account, `auth_session` misses once
per sign-in and `auth_user` almost never; with many, both miss more and
Postgres does more of the per-request check. See
[monitoring.md](./monitoring.md#auth-metrics).

## Things that will catch you out

**Your laptop is part of the test.** One machine can usually generate a few
thousand requests a second, but well before that you will run into open file
limits (`ulimit -n` on macOS and Linux) and the ephemeral port range. If k6
reports connection errors while the server is bored, the bottleneck is at your
end.

**Distance is latency.** Testing a Singapore server from Europe adds ~180ms to
every single request, and no amount of server tuning removes it. Either run k6
from a small VM in the same region, or subtract the round trip mentally — the
Grafana numbers, measured inside the app, are unaffected by it.

**The first run is always the slowest.** Caches are cold, the database has no
plans cached, containers may still be starting. Discard it.

**Writes accumulate.** `load.js` updates a display name and `upload.js` stores
an avatar every time. Uploads land on disk (or in your bucket) and stay there.
After a long upload run, check the disk.

**Signing in is in the test too.** With `LOAD_USER_COUNT` high and a short
run, signing everyone in can be a bigger burst than the API traffic itself —
and password hashing is deliberately expensive. Those requests are tagged
`auth login` so you can see them separately in the summary.

**One address, one bucket.** Everything above about the rate limiter applies to
nginx's own limits as well, if you have configured any — see
[deployment-guide.md](./deployment-guide.md).

## Related

- [monitoring.md](./monitoring.md) — the dashboards to watch while a test runs
- [alerts.md](./alerts.md) — silencing alerts for the duration
- [file-uploads-and-s3.md](./file-uploads-and-s3.md) — the image-processing cap
- [rate-limit.md](./rate-limit.md) — how the throttler counts
- [auth/rate-limits.md](./auth/rate-limits.md) — the sign-in limits
