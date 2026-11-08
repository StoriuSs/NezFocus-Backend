# Auth in plain words

This page is for anyone who has never built sign-in before, or who wants the
words straight before reading the rest. Each idea is explained in plain
language first, sometimes with an everyday comparison, and then tied to the
exact place this starter uses it.

If you already know what a refresh token, SameSite and PKCE are, skip to
[flows.md](./flows.md) or [sessions-and-tokens.md](./sessions-and-tokens.md).

- [The pieces involved](#the-pieces-involved)
- [The life of a sign-in, as a story](#the-life-of-a-sign-in-as-a-story)
- [Glossary](#glossary)

## The pieces involved

Signing in here involves a handful of programs. The diagrams in
[flows.md](./flows.md) use these names:

| Piece | What it is | What it does for auth |
|---|---|---|
| **Browser / web app** | The React app the person uses (the companion React starter, on `http://localhost:3001` in development) | Shows the forms, keeps the access token in memory, sends requests to the API |
| **API** | This NestJS app (`http://localhost:8888/api/v1` in development) | Checks passwords and codes, starts and ends sessions, signs tokens |
| **Postgres** | The database | Holds the accounts, password hashes, sessions, refresh-token hashes, emailed-code hashes and Google links ([auth.prisma](../../prisma/models/auth.prisma)) |
| **Redis** | A fast in-memory store | Caches "is this session still live?", counts rate limits, holds short-lived things (a Google sign-in in progress) and the email queue |
| **Email queue and SMTP** | BullMQ jobs on the `auth` queue, then your mail provider | Sends codes and security notices without making the request wait. In development, Mailpit catches every email at `http://localhost:8025` |
| **Google** | Optional | "Continue with Google" ([google-sign-in.md](./google-sign-in.md)) |

All the auth code lives in [src/modules/auth/](../../src/modules/auth/). The
folder layout is explained in [in-the-code.md](./in-the-code.md).

## The life of a sign-in, as a story

Ada creates an account and uses the app for a month. Here is what happens,
with the terms from the glossary in bold.

1. **Ask for a code.** Ada types her address. The API emails her a six-digit
   code, and stores only an **HMAC** of it, never the code itself. Every
   address gets a code and the same answer, whether or not it already had an
   account, so nobody can use the form to find out who has one (**account
   enumeration**). Only the email's wording says which.
2. **Send it back.** Ada types the code. The API compares it with what it
   stored. Her address had no account, so the right code creates one now:
   her address is confirmed by the code itself, and the account has no
   password or username yet ("not completed": before anything else in the
   app she must choose them in "complete your account"). Then the API starts a
   **session**: a row in Postgres that says "Ada is signed in on this browser
   until 30 days from now". (A password, if she sets one later, is stored
   only as a **hash** made with **Argon2**.)
3. **Two tokens.** The API hands back two secrets. The **access token** (a
   **JWT**) goes in the response body; the web app keeps it in memory and
   sends it with every request as `Authorization: Bearer …`. The **refresh
   token** goes in a **cookie** that is **httpOnly**, so the page's
   JavaScript can never read it.
4. **Every request.** The API checks the access token's signature, then asks
   Redis (or Postgres, if Redis is down) whether the session is still live.
   That is why signing out takes effect at once.
5. **Fifteen minutes later.** The access token expires. The web app calls
   `POST /api/v1/auth/refresh`; the browser attaches the cookie by itself.
   The API swaps the refresh token for a new one (**rotation**) and hands
   out a new access token. If an old refresh token ever comes back, someone
   copied it (**replay**), and the session ends.
6. **Day 30.** The session reaches its end. Refreshing never extends it, so
   Ada signs in again.

## Glossary

- [Access token](#access-token)
- [Bearer token](#bearer-token)
- [Refresh token](#refresh-token)
- [Session](#session)
- [Cookie](#cookie)
- [httpOnly](#httponly)
- [Site and origin](#site-and-origin)
- [SameSite](#samesite)
- [CORS and credentials](#cors-and-credentials)
- [Hashing and encryption](#hashing-and-encryption)
- [Argon2](#argon2)
- [HMAC](#hmac)
- [JWT](#jwt)
- [OAuth and OpenID Connect](#oauth-and-openid-connect)
- [PKCE](#pkce)
- [State and nonce](#state-and-nonce)
- [Rate limit](#rate-limit)
- [Account enumeration](#account-enumeration)
- [CSRF](#csrf)
- [Replay](#replay)

### Access token

A short-lived secret that proves "this request comes from a signed-in
person". The client sends it with every request. Think of a wristband at a
festival: staff glance at it at each gate instead of checking your ID again,
and it is only good for the day.

Because a token cannot be taken back once handed out, it is kept short-lived:
if one leaks into a log or a proxy, it stops working soon.

In this starter:

- A [JWT](#jwt) the API signs itself, valid **15 minutes** by default
  (`JWT_ACCESS_TTL_SECONDS`, 60 to 3600). Returned in the body of every route
  that signs you in, as `{ access_token, token_type: "Bearer", expires_in }`.
- It carries only who you are and which session you are in (`sub`, `sid`).
  No roles, no email: those are read fresh on every request, so taking a role
  away works at once.
- Made in [jose-token-service.adapter.ts](../../src/modules/auth/infrastructure/adapters/jose-token-service.adapter.ts),
  checked on every request by [access-token.guard.ts](../../src/modules/auth/presentation/guards/access-token.guard.ts).
- The web app keeps it **in memory only**, never in `localStorage`: any
  script on the page can read `localStorage`, so one cross-site-scripting bug
  would hand the token over.
- Details: [sessions-and-tokens.md](./sessions-and-tokens.md#the-access-token).

### Bearer token

"Bearer" means "whoever holds this may use it", like cash. The request header
is `Authorization: Bearer <access_token>`. The API does not ask for anything
else, which is why the token must not leak and why it is short-lived.

In this starter, every route needs a bearer token unless it is marked
`@Public()` ([public.decorator.ts](../../src/shared/presentation/decorators/public.decorator.ts)).
Without one the answer is `401 AUTH_TOKEN_MISSING`.

### Refresh token

A long-lived secret whose only job is to get a new access token when the old
one expires, so the person does not type their password every 15 minutes.
Think of the stub of a coat-check ticket: you hand it in, you get your coat
and a new stub, and the old stub is void.

In this starter:

- 32 random bytes, stored by the browser in a cookie named `refresh_token`
  that page scripts cannot read ([httpOnly](#httponly)).
- Only its SHA-256 hash is stored in Postgres (the `RefreshToken` table), so
  a copy of the database does not hand out working tokens.
- **Single use.** Each refresh swaps it for a new one (rotation). If a used
  one comes back, it was copied, and the whole session ends
  ([reuse detection](./sessions-and-tokens.md#reuse-detection)).
- It never extends the session: after 30 days (`AUTH_SESSION_TTL_DAYS`) the
  person signs in again.
- Used only by `POST /api/v1/auth/refresh` and `POST /api/v1/auth/logout`
  ([auth.controller.ts](../../src/modules/auth/presentation/http/auth.controller.ts)).

### Session

One sign-in on one browser or device, from the moment of signing in until
signing out, expiry, or something else ends it. Signing in on a phone and a
laptop makes two sessions.

In this starter:

- A row in the `Session` table ([auth.prisma](../../prisma/models/auth.prisma)).
  Its id is the `sid` inside every access token issued in it.
- Started in exactly one place, [session-issuer.ts](../../src/modules/auth/application/services/session-issuer.ts),
  always through [sign-in-gate.ts](../../src/modules/auth/application/services/sign-in-gate.ts),
  the one gate every way of signing in passes.
- Listed for its owner on the settings page's list of devices
  (`GET /auth/sessions`), with the browser and system of its last refresh
  and a masked IP (D-75, D-138).
- Ended by signing out, signing it out from the list of devices, "sign out
  the other devices", a password change or reset, a replayed refresh token, a request to delete the account (or its deletion), or reaching its end date. Each
  reason is recorded and told to the device that finds out: see
  [what ends a session](./sessions-and-tokens.md#what-ends-a-session).

### Cookie

A small named value a website asks the browser to keep. The browser then
sends it back by itself with every request to that site that matches the
cookie's rules. The API sets one with a `Set-Cookie` response header.

The rules that matter here:

| Attribute | Means |
|---|---|
| `Path` | Only requests whose path starts with this carry the cookie |
| `Expires` | When the browser throws it away |
| `HttpOnly` | Page scripts cannot read it ([httpOnly](#httponly)) |
| `Secure` | Only sent over HTTPS |
| `SameSite` | Whether requests started by other sites carry it ([SameSite](#samesite)) |
| no `Domain` | Only the exact host that set it gets it back (a "host-only" cookie) |

In this starter, two cookies, both httpOnly and all scoped to auth paths:

| Cookie | Holds | Path | Lives |
|---|---|---|---|
| `refresh_token` | the refresh token | `/api/v1/auth` | until the session ends |
| `oauth_state` | the `state` of a Google sign-in in progress | `/api/v1/auth/google/callback` | 10 minutes |

The paths follow `API_PREFIX` (default `api`). See
[the cookie](./sessions-and-tokens.md#the-refresh-cookie).

### httpOnly

A cookie attribute that hides the cookie from JavaScript. The browser still
sends it with requests, but `document.cookie` does not show it. Like a
sealed envelope the courier carries for you without being able to open it.

Why it matters: if an attacker manages to run a script on your page (a
cross-site-scripting bug), they still cannot read the refresh token and walk
away with the session.

In this starter both auth cookies are httpOnly
([auth-cookies.ts](../../src/modules/auth/presentation/http/auth-cookies.ts)).

### Site and origin

Two words browsers use to decide what counts as "the same place". They are
not the same thing, and the difference decides whether sign-in works across
domains.

- **Origin** = scheme + host + port. `https://app.example.com` and
  `https://api.example.com` are **different origins**. So are
  `http://localhost:3001` and `http://localhost:8888`.
- **Site** = scheme + the registrable domain (the part you buy, like
  `example.com`), ignoring subdomains and ports. `https://app.example.com`
  and `https://api.example.com` are the **same site**. So are
  `http://localhost:3001` and `http://localhost:8888`.
  `https://myapp.com` and `https://myapi.net` are **different sites**.

A trap: some hosting domains are treated as registrable domains of their own
(they are on the Public Suffix List): `vercel.app`, `netlify.app`,
`pages.dev`, `github.io` and others. `myapp.vercel.app` and
`myapi.vercel.app` are **different sites**, even though they look like
subdomains of one domain.

[CORS](#cors-and-credentials) is about origins. [SameSite](#samesite) is about
sites. The setups this allows are in
[cross-site setups](./sessions-and-tokens.md#cross-site-setups).

### SameSite

A cookie attribute that says whether the browser should attach the cookie to
requests that another **site** started. It is the browser's main defence
against [CSRF](#csrf).

| Value | The cookie goes along with |
|---|---|
| `Strict` | Only requests started from the same site |
| `Lax` (the browser default) | Same-site requests, plus a person clicking a link from another site to yours |
| `None` | Every request, from anywhere. Browsers accept it only together with `Secure` (HTTPS) |

In this starter:

- `AUTH_COOKIE_SAMESITE`, default `lax`
  ([auth.config.ts](../../src/config/auth.config.ts)). `lax` works when the
  web app and the API are on the same site (subdomains of one domain, or
  `localhost` on two ports).
- `none` is only for a web app and API on different sites, and it needs
  HTTPS. Some browsers block such cookies anyway. See
  [cross-site setups](./sessions-and-tokens.md#cross-site-setups).
- The `oauth_state` cookie uses `none` when you chose `none`, and `lax`
  otherwise (never `strict`: a strict cookie would not
  come back with the return from Google).

### CORS and credentials

By default a page on one origin may send a request to another origin, but
may not read the answer. **CORS** (cross-origin resource sharing) is how the
API tells the browser "pages from these origins may read my answers". It is
like a guest list at a door: the bouncer (the browser) checks the list the
venue (the API) published.

**Credentials** are cookies (and HTTP auth). A cross-origin request carries
cookies, and the browser stores cookies from its answer, only when both
sides agree:

- the page asks for it (`fetch(url, { credentials: 'include' })`, or axios
  `withCredentials: true`);
- the API answers with `Access-Control-Allow-Credentials: true` and names the
  page's exact origin (never `*`).

In this starter:

- `CORS_ORIGINS`: the web app's origins, comma-separated, exact
  (`https://app.example.com`, scheme included, no trailing slash). Default
  `http://localhost:3001` ([cors.config.ts](../../src/config/cors.config.ts)).
- `CORS_CREDENTIALS`: must stay `true`, or the refresh cookie never reaches
  the API and every session ends when its first access token expires.
  Production refuses to start with `false`
  ([validation.ts](../../src/config/validation.ts)).
- The same `CORS_ORIGINS` list is also the **Origin check** on the routes the
  cookie authenticates (`refresh` and `logout`): a request from an origin not on the list gets
  `403 AUTH_FORBIDDEN`.
- CORS also exposes the `Retry-After` header so the web app can say how long
  to wait after a 429 ([configure-app.ts](../../src/bootstrap/configure-app.ts)).

### Hashing and encryption

Both turn a value into something unreadable. The difference is whether you
can get the original back.

- **Hashing** is one-way. You cannot turn a hash back into the value; you can
  only hash a candidate and compare. Like a fingerprint: it identifies a
  person, but you cannot rebuild the person from it. Use it when you only
  ever need to check a value, never read it.
- **Encryption** is two-way. With the key you get the original back. Like a
  locked box. Use it when the server must read the value again later.

In this starter:

| Value | How it is stored | Why |
|---|---|---|
| Passwords | Argon2id hash | Only ever checked; must resist guessing even if the database leaks ([Argon2](#argon2)) |
| Refresh tokens | SHA-256 hash | 32 random bytes cannot be guessed, so a fast hash is enough |
| Emailed codes | HMAC-SHA256 keyed with `JWT_SECRET` | Six digits are only a million options: a plain hash could be reversed by trying them all ([HMAC](#hmac)) |

### Argon2

A password-hashing function designed to be slow and to need a lot of memory
on purpose. A real person signs in once and does not notice a fraction of a
second. An attacker with a stolen database who wants to try a billion guesses
notices very much, and the memory requirement stops them using cheap
graphics cards to go faster.

In this starter:

- Argon2id with 19 MiB of memory, 2 passes, 1 lane: the OWASP recommendation
  ([argon2-password-hasher.adapter.ts](../../src/modules/auth/infrastructure/adapters/argon2-password-hasher.adapter.ts)).
- Signing in with an unknown address still runs a hash, against a dummy, so
  the response time does not reveal which addresses exist.
- When the parameters are raised, each account is re-hashed the next time it
  signs in.
- Details: [passwords-and-codes.md](./passwords-and-codes.md#how-passwords-are-stored).

### HMAC

A hash mixed with a secret key. Without the key, nobody can compute or check
the result, even knowing the input is one of only a million six-digit codes.
Like a wax seal made with your own ring: anyone can see the seal, only you
can make it.

In this starter:

- Emailed codes are stored as `HMAC-SHA256(JWT_SECRET, "<purpose>:<email>:<code>")`
  ([jose-token-service.adapter.ts](../../src/modules/auth/infrastructure/adapters/jose-token-service.adapter.ts),
  `hashVerificationCode`). A consequence: changing `JWT_SECRET` makes every
  code already emailed stop working.

### JWT

A JSON Web Token: a small JSON document plus a signature, written as three
base64url parts separated by dots (`header.payload.signature`). Anyone can
decode and **read** the payload; the signature only proves nobody **changed**
it. So never put secrets in one.

In this starter the access token is a JWT signed with HS256 (an HMAC with
`JWT_SECRET`). Its payload looks like this (decoded):

```json
{
  "sub": "8f6c1e0a-…",
  "sid": "2b7d93f4-…",
  "typ": "access",
  "iss": "http://localhost:8888",
  "aud": "http://localhost:8888",
  "jti": "c0a4…",
  "iat": 1790000000,
  "exp": 1790000900
}
```

`sub` is the user id, `sid` the session id, `iss` and `aud` are `BASE_URL`.
The full rules are in [sessions-and-tokens.md](./sessions-and-tokens.md#the-access-token).
The refresh token is **not** a JWT: it is random bytes that mean nothing
without the database.

### OAuth and OpenID Connect

**OAuth 2.0** lets one site get permission from another on a person's behalf
without seeing their password. **OpenID Connect (OIDC)** is a layer on top
that adds "and tell me who this person is", in a signed **ID token**. "Sign
in with Google" is OpenID Connect.

The shape of it, like a hotel front desk confirming your identity with your
home country's passport office:

1. The API sends the browser to Google with "please sign this person in for
   this app".
2. The person signs in at Google and agrees.
3. Google sends the browser back to the API with a one-time **code**.
4. The API trades that code, server to server, for an ID token that says
   "this is Google user 1234, address ada@example.com, verified".

In this starter: [openid-connect-provider.adapter.ts](../../src/modules/auth/infrastructure/adapters/openid-connect-provider.adapter.ts)
(using the `openid-client` library), [start-oauth.handler.ts](../../src/modules/auth/application/commands/start-oauth/start-oauth.handler.ts)
and [finish-oauth.handler.ts](../../src/modules/auth/application/commands/finish-oauth/finish-oauth.handler.ts).
The person is recognised by Google's id for them (`sub`), not by their
address. Full story: [google-sign-in.md](./google-sign-in.md), and the flow in
[flows.md](./flows.md#sign-in-with-google).

### PKCE

"Proof Key for Code Exchange", pronounced "pixie". Before sending the browser
to Google, the API makes a random secret (the *verifier*) and sends only a
hash of it (the *challenge*). When trading the code back, it must show the
verifier. Someone who intercepts the code cannot use it without the
verifier, which never left the server. Like tearing a banknote in half: only
the person holding the matching half can claim it.

In this starter: `code_challenge_method=S256`
([openid-connect-provider.adapter.ts](../../src/modules/auth/infrastructure/adapters/openid-connect-provider.adapter.ts)).
The verifier is kept in Redis, never in the browser.

### State and nonce

Two random values that tie a Google sign-in to the attempt that started it.

- **state** travels to Google and back in the URL. The API also puts it in
  the `oauth_state` cookie when the attempt starts, and checks that the two
  match on the way back. Without it, an attacker could send a victim a
  return link carrying the attacker's own code, and the victim would end up
  signed in to the attacker's account (a "login CSRF").
- **nonce** goes inside the ID token Google signs. Checking it proves the ID
  token was made for this attempt, not replayed from another.

In this starter both are made per attempt, kept in Redis for 10 minutes
(`auth:oauth:<state>`), and can be used once
([redis-oauth-state.adapter.ts](../../src/modules/auth/infrastructure/adapters/redis-oauth-state.adapter.ts)).

### Rate limit

A cap on how often something may happen in a time window, like a cash
machine that locks the card after three wrong PINs. It turns "guess a
password a million times" into "guess five times, then wait".

In this starter there are two layers:

- a global limit per route, per user when signed in (`THROTTLE_LIMIT`,
  default 100 per `THROTTLE_TTL` 60 seconds) and per IP otherwise
  (`THROTTLE_ANONYMOUS_LIMIT`, default 300; D-135);
- auth limits per address, per IP or per user, for example 5 failed sign-ins
  per address per 15 minutes
  ([rate-limits.ts](../../src/modules/auth/application/rate-limits.ts)).
  If Redis is down they refuse rather than allow (`503`, D-137); the global
  limit allows.

A refusal is `429 RATE_LIMIT_EXCEEDED` with a `Retry-After` header and a
`data.reason`. Full table: [rate-limits.md](./rate-limits.md).

### Account enumeration

Finding out which email addresses have an account by watching how a site
answers ("no account with that address" versus "wrong password"). A list of
confirmed accounts is the first thing a password-guessing or phishing
campaign wants.

In this starter, routes that take an address answer the same either way:

- asking for a code and "forgot password" always answer `202`; what goes out
  (a sign-in code, a create-account code, a reset code, or nothing) is only
  visible in the inbox;
- "forgot password" for an address with no account still stores a code
  nobody is sent, so guesses at it wear it out after five like a real one
  (D-121);
- a wrong password, an unknown address and an account with no password are
  one error, `401 AUTH_INVALID_CREDENTIALS`, in the same time;
- at `reset-password`, "the password is your username" is said only after
  the right code (D-66);
- limits keyed on an address count whether or not the account exists.

More in [security.md](./security.md).

### CSRF

Cross-site request forgery: a page on another site makes the person's browser
send a request to your API, and the browser attaches the person's cookies
automatically. If the API trusted the cookie alone, the other site could act
as the person.

In this starter three locks stop it:

1. Ordinary API routes do not use cookies at all: they need the bearer token
   in a header, which another site cannot add.
2. The refresh cookie is `SameSite=Lax` by default, so the browser does not
   send it with requests other sites start.
3. The routes the cookie does authenticate (`refresh` and `logout`) also
   check the `Origin` header against
   `CORS_ORIGINS` and answer `403 AUTH_FORBIDDEN` otherwise
   ([auth-cookies.ts](../../src/modules/auth/presentation/http/auth-cookies.ts),
   `assertAllowedOrigin`). A request with no `Origin` header at all comes from
   a non-browser client, which cannot be a page using someone else's cookie,
   so it is allowed.

### Replay

Sending a valid message a second time to get its effect twice: re-using a
code, a token or a sign-in return that was meant to work once.

In this starter, everything that should work once does:

| What | How a second use is stopped |
|---|---|
| Refresh token | Marked used; a second use ends the session ([reuse detection](./sessions-and-tokens.md#reuse-detection)) |
| Emailed code | Each wrong guess counts a try in the statement that checks it; a right code is then used up by a conditional update that matches its hash and "not used yet", so only one request wins |
| Google sign-in attempt | Taken from Redis with `GETDEL`, so only one return can finish it |

## Related

- [flows.md](./flows.md): every flow, step by step, with diagrams
- [sessions-and-tokens.md](./sessions-and-tokens.md): tokens, cookies, sessions, cross-site setups
- [passwords-and-codes.md](./passwords-and-codes.md): password rules, hashing, emailed codes
- [security.md](./security.md): the threats and how each is handled
- [README.md](./README.md): the start page of this set
