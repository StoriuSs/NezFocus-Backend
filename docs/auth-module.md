# Authentication

This page has moved. Authentication (sign-up, sign-in, sessions, passwords,
Google, two-step sign-in, Turnstile, account deletion) is now documented as a
set of pages in [docs/auth/](./auth/README.md). **Start at
[auth/README.md](./auth/README.md)**: it says which page to read for what you
are doing.

The headings below are the sections this page used to have. Links and code
comments still point at them, so each stays here and says where its content
went.

| If you want | Read |
|---|---|
| The ideas, in plain words | [auth/concepts.md](./auth/concepts.md) |
| Each flow step by step | [auth/flows.md](./auth/flows.md) |
| Every route, body, answer and error | [auth/api-reference.md](./auth/api-reference.md) |
| To change the code | [auth/in-the-code.md](./auth/in-the-code.md) |
| To run it in production | [auth/operations.md](./auth/operations.md) |

## What ends a session

Moved to [auth/sessions-and-tokens.md](./auth/sessions-and-tokens.md). The
`data.reason` each device is told is in the
[API reference](./auth/api-reference.md#session-end-reasons).

## Tokens and the cookie

Moved to [auth/sessions-and-tokens.md](./auth/sessions-and-tokens.md).

## Signing keys

Access tokens are signed with one shared secret (HS256):
[auth/sessions-and-tokens.md](./auth/sessions-and-tokens.md). What that rules
out (another service verifying them without the secret):
[auth/security.md](./auth/security.md#what-is-not-covered).

## Passwords

The rules, the common-password list and hashing:
[auth/passwords-and-codes.md](./auth/passwords-and-codes.md).

## Emailed codes

Moved to [auth/passwords-and-codes.md](./auth/passwords-and-codes.md). The
emails themselves: [auth/emails.md](./auth/emails.md).

## Rate limits

Moved to [auth/rate-limits.md](./auth/rate-limits.md). Per route:
[the API reference](./auth/api-reference.md#rate-limits-by-route).

## Signing in with Google

Moved to [auth/google-sign-in.md](./auth/google-sign-in.md). Getting the keys
from Google: [setup/google-sign-in.md](./setup/google-sign-in.md).

## Adding a provider

In the code: [auth/in-the-code.md](./auth/in-the-code.md#another-openid-connect-provider).
How providers fit the sign-in rules: [auth/google-sign-in.md](./auth/google-sign-in.md).

## Two-step sign-in

Moved to [auth/two-step-sign-in.md](./auth/two-step-sign-in.md).

## Changing the encryption key

The procedure, and what to do when the key is lost:
[auth/operations.md](./auth/operations.md#changing-the-encryption-key). How
sealing works: [auth/two-step-sign-in.md](./auth/two-step-sign-in.md).

## Turnstile

Moved to [auth/turnstile.md](./auth/turnstile.md). Getting the keys:
[setup/cloudflare-turnstile.md](./setup/cloudflare-turnstile.md).

## Roles and the first administrator

Roles and `pnpm user:promote`: [auth/accounts.md](./auth/accounts.md). Running
it on a server: [auth/operations.md](./auth/operations.md#the-command-line-tools).

## Errors a client sees

The full catalogue and what a client should do for each:
[auth/api-reference.md](./auth/api-reference.md#how-a-client-should-react).

## Settings

The auth variables and what changing each one does:
[auth/operations.md](./auth/operations.md#the-auth-settings). Every variable:
[environment.md](./environment.md#authentication).

## Deploying: the three things that break sign-in

The cross-site cookie, `CORS_ORIGINS` and a working mail server are on the
production checklist in
[auth/operations.md](./auth/operations.md#before-the-first-deploy), with the
symptoms in its [troubleshooting table](./auth/operations.md#troubleshooting).

## Inside the module

Moved to [auth/in-the-code.md](./auth/in-the-code.md).

## Tests

Moved to [auth/in-the-code.md](./auth/in-the-code.md#tests).

## Troubleshooting

Moved to [auth/operations.md](./auth/operations.md#troubleshooting).
