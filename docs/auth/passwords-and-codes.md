# Passwords and emailed codes

The rules a password must follow, how it is stored, and how the six-digit
codes that sign in (or create an account) and reset a password work.

Read this if you are building a sign-up or settings form, changing a rule, or
wondering why a code was refused. New to hashing and HMAC? See
[hashing and encryption](./concepts.md#hashing-and-encryption) first.

- [The password rules](#the-password-rules)
- [How passwords are stored](#how-passwords-are-stored)
- [Emailed codes](#emailed-codes)
- [How codes are stored](#how-codes-are-stored)
- [How a code is checked](#how-a-code-is-checked)
- [Changing the rules](#changing-the-rules)
- [Where it is in the code](#where-it-is-in-the-code)

## The password rules

Every rule has a stable id the API sends back, and the message a person
reads. They are in [password-policy.ts](../../src/modules/auth/domain/password-policy.ts),
which is plain TypeScript with no framework imports, so a frontend can copy
it.

| Rule id | Refused when | Message |
|---|---|---|
| `min_length` | Fewer than 8 characters | Use at least 8 characters. |
| `max_length` | More than 128 characters (a bound on hashing work, not a security rule) | Use at most 128 characters. |
| `lowercase` | No lower-case letter (any alphabet: `é` and `ж` count) | Include a lower-case letter. |
| `uppercase` | No upper-case letter | Include an upper-case letter. |
| `digit` | No digit | Include a digit. |
| `special` | No character that is neither a letter nor a digit (a space, `_` and `-` count) | Include a character that is not a letter or a digit. |
| `matches_email` | The password **is** the address, or the part before `@` ([below](#not-the-address-or-the-username)) | Do not use your email address as your password. |
| `matches_username` | The password **is** the username | Do not use your username as your password. |

Characters are counted as Unicode code points, not bytes: `é` is one
character, whatever its size in UTF-8.

**What a refusal looks like.** Every broken rule is reported at once, in the
order of the table: `422 AUTH_PASSWORD_REJECTED` (code `422004`), the
messages joined in `meta.message`, and the ids in `data.rules`, so a form can
mark each rule:

```json
{
  "meta": {
    "code": "422004",
    "type": "AUTH_PASSWORD_REJECTED",
    "message": "Include an upper-case letter. Include a digit.",
    "...": "..."
  },
  "data": {
    "rules": ["uppercase", "digit"],
    "details": "Include an upper-case letter. Include a digit.",
    "path": "/api/v1/auth/reset-password",
    "method": "POST"
  }
}
```

### Examples

| Password | Context | Result |
|---|---|---|
| `Harbour-Lantern-42` | | accepted |
| `Password1!`, `P@ssw0rd!` | | accepted: there is no common-password list (D-29) |
| `Đàlạt 2026` | | accepted: Vietnamese letters are letters, a space is a special character |
| `ontap2026` | | `uppercase`, `special` |
| `Jane.doe7!`, `JaneDoe2026!` | address `Jane.Doe@example.test` | `matches_email` |
| `Uiia2024!` | username `uiia` | `matches_username` |
| `UiiaUiia1~`, `Harbour-Uiia-42` | username `uiia` | accepted: it contains the username, but is not it |
| `harbour` | | `min_length`, `uppercase`, `digit`, `special` |

These come from [password-policy.spec.ts](../../src/modules/auth/domain/password-policy.spec.ts).

### Not the address or the username

Only *being* the address or username is refused, not *containing* it. A rule
against containing a short username would refuse many reasonable passwords,
and people who build a password around their name on purpose usually add
more to it.

"Being it" means either:

- the password, lower-cased, equals the identity; or
- the identity has at least 3 letters, and once digits, symbols and common
  swaps (`@` for `a`, `0` for `o`, below) are set aside, the password's
  letters are exactly the identity's letters. So `Uiia2024!` and `U-i-i-a`
  are both `uiia`.

The address is compared both whole and by the part before `@`.

### No common-password list

The base this project started from also refused passwords built around one of
the ~8,500 most common words (`Password1!`, `P@ssw0rd`). NezFocus dropped
that rule (D-29): the app and the web share one set of rules, and the person
sees every rule ticked off while typing. The cost is written in D-29: current
guidance (NIST SP 800-63B) prefers a common-password check to composition
rules, and `Password1!` passes.

The reduction the old check used (`baseWord`: lower case, digits and symbols
trimmed from both ends, swaps such as `@` for `a` and `0` for `o` undone)
is still how "being the address or the username" is compared, above.

### Which routes check what

| Route | Checked against |
|---|---|
| `POST /auth/complete-account` | the address and the username chosen in the same form |
| `POST /auth/reset-password` | the rules that need only the address, before the code; then, only once the code is known right, "not the username" |
| `POST /auth/change-password` | the address and the username |
| `POST /auth/login` | nothing: an old password that predates a rule still signs in |

Reset checks in this order (D-66): the rules that need only the address,
then the code, then the account and "the password is not the username", then
the code is used up. Whether the password is refused by the address rules
cannot depend on whether the account exists, and a refused password does not
use a try. The username rule waits for the right code: checked before it, the
answer would tell anyone guessing that an account with this username has this
address. A password refused by it keeps the code, so the person can try
another.

### Mirroring the rules in the frontend

The frontend copies the rules (NezFocus-Frontend
`src/features/auth/lib/password-rules.ts`) to tick them off while the person
types. It checks every rule; `matches_username` only where the form knows the
username. The API stays the judge: a form shows `data.rules` from the
refusal the same way.

### What is deliberately not a rule

- No password history, and no "must differ from the current one".
- No forced expiry. Changing passwords on a schedule makes people pick
  weaker ones, and current guidance (NIST SP 800-63B) advises against it.
- No limit other than 128 characters. Long passphrases are welcome.

## How passwords are stored

Only a hash is stored, in the `Credential` table (`passwordHash`), never the
password. An account made with Google has no `Credential` row at all.

[argon2-password-hasher.adapter.ts](../../src/modules/auth/infrastructure/adapters/argon2-password-hasher.adapter.ts):

| | |
|---|---|
| Algorithm | Argon2id, through `@node-rs/argon2` (a prebuilt binary: nothing compiles when the image is built) |
| Parameters | 19 MiB of memory (`memoryCost: 19456` KiB), 2 passes (`timeCost: 2`), 1 lane (`parallelism: 1`): the OWASP recommendation |
| Stored as | The standard string `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`. The salt and the parameters are inside it |
| Input bound | The request accepts 1 to 1024 characters, so a megabyte-long password is refused before it is hashed. New passwords are then limited to 128 by the rules |

Three details:

- **Unknown addresses cost the same.** Signing in with an address that has no
  account, or an account with no password, still runs a hash check, against
  a dummy hash made at start-up. Otherwise the faster answer would reveal
  which addresses exist.
- **A damaged stored hash** counts as a wrong password, not a server error.
- **Raising the parameters upgrades accounts as they sign in.** After a
  successful sign-in, a hash that is not
  Argon2id, or uses less memory, fewer passes or a different number of lanes
  than the current settings, is replaced with a fresh one.

Argon2 is slow on purpose: each sign-in costs a noticeable slice of a CPU.
That matters for load tests ([load-testing.md](../load-testing.md)) and is the
point against an attacker with a stolen database.

## Emailed codes

A six-digit code sent to the address proves the person can read that inbox.
Two things use one (D-129):

| Purpose | Sent by | Checked by | Email (English) |
|---|---|---|---|
| `sign-in` | `POST /auth/email-code` | `POST /auth/email-code/verify` | "Your {app} sign-in code" when the address has an account, "Your code to create a {app} account" when it has none (D-59, D-60) |
| `password-reset` | `POST /auth/forgot-password` | `POST /auth/reset-password` | "Reset your {app} password", or "Choose a password for your {app} account" when the account has none |

`{app}` is `APP_NAME`. Each email is in the request's `language` (`vi` or
`en`, D-132). The emails are described in [emails.md](./emails.md).

Codes are keyed by address, not by account: a sign-in code goes to an address
that may have no account yet. And `forgot-password` for an address with no
account still stores a reset code, one nobody is sent. Guesses at it are
counted and wear it out after five exactly as for a real one, so "the fifth
guess says expired" cannot tell which addresses have accounts (D-121).

| Rule | Value | Why |
|---|---|---|
| Format | 6 digits, `000000` to `999999`, from `crypto.randomInt`; leading zeros kept | A predictable generator would let codes be guessed; zero-padding keeps all million possible |
| Valid for | 10 minutes | Long enough to switch to the inbox, short enough that an old email is useless |
| Attempts | 5 per code | A million possibilities, five guesses: a one in 200,000 chance |
| One at a time | One live code per address and purpose. A new code replaces the old one, which stops working at once, and the attempt count starts again | So "send it again" never leaves two codes that work |
| Used once | A right code is used up | So it cannot be replayed |
| Separate purposes | A reset code does not sign in, and a sign-in code does not reset a password | The purpose is part of the key and of what is hashed |
| Input | Must be exactly six digits in the request (else `422`); surrounding spaces are trimmed | |

The 10 minutes and 5 attempts are hard-coded in
[auth.module.ts](../../src/modules/auth/auth.module.ts) (`codeTtlMinutes`,
`codeMaxAttempts`). The email states the lifetime from the same setting.

**Limits around codes** (full table in [rate-limits.md](./rate-limits.md)):

- code emails to one address: 1 a minute and 5 an hour, shared by sign-in
  and reset codes;
- code emails requested from one IP: 30 in 5 minutes (D-135);
- wrong codes from one IP, across addresses: 30 in 5 minutes. Only wrong codes
  count. This stops someone spreading guesses over many addresses, five at
  a time;
- wrong codes for one address, across its codes: 10 an hour (D-134). Without
  it, five codes an hour would give 25 guesses an hour at one address from
  many IPs.

## How codes are stored

Never as the code itself. The `VerificationCode` table
([auth.prisma](../../prisma/models/auth.prisma)) has one row per address and
purpose, whether or not the address has an account (D-129):

| Column | Meaning |
|---|---|
| `email`, `purpose` | Unique together: one live code per address and purpose. The address is normalised (trimmed, lower case) |
| `codeHash` | `HMAC-SHA256(key = JWT_SECRET, "<purpose>:<email>:<code>")`, hex |
| `createdAt`, `expiresAt` | When it was issued, and 10 minutes later |
| `attempts` | Guesses so far |
| `consumedAt` | When the right code was used |

Why an [HMAC](./concepts.md#hmac) and not a plain hash: six digits are only a
million options, so anyone with the database could hash all million and read
every code. Keyed with a secret that is not in the database, the stored
values are useless on their own. The address and purpose are mixed in, so the
same code for two addresses or two purposes gives different values.

**A consequence: changing `JWT_SECRET` kills every code already sent.** The
stored HMACs were made with the old key, so every waiting code answers
`400 AUTH_CODE_INVALID`. People ask for a new one. Plan a `JWT_SECRET` change
for a quiet moment ([operations.md](./operations.md)).

Rows are deleted by the hourly clean-up one day after they expire or are
used ([clean-up-auth.handler.ts](../../src/modules/auth/application/commands/clean-up-auth/clean-up-auth.handler.ts)).

## How a code is checked

[prisma-verification-code.repository.ts](../../src/modules/auth/infrastructure/persistence/prisma-verification-code.repository.ts)
in two steps.

**`check`** counts the attempt in the same SQL statement that reads the
code (`UPDATE … SET attempts = attempts + 1 … RETURNING`), so ten guesses
sent at the same moment use up ten attempts, not one. It answers `right`,
`wrong` or `expired`, and does **not** use the code up:

| Situation | Answer |
|---|---|
| No code waiting for this address and purpose, or it was already used | `wrong`: `400 AUTH_CODE_INVALID` |
| Past `expiresAt`, or this is the 6th attempt or later | `expired`: `400 AUTH_CODE_EXPIRED` |
| Wrong code, and that was the 5th attempt | `expired`: said now, not on the next try |
| Wrong code, attempts 1 to 4 | `wrong`: `400 AUTH_CODE_INVALID` |
| Right code | `right`; the route carries on |

**`use`** uses a right code up, once the route's other checks have passed
(reset keeps the code when the password is refused). It is a conditional
update matching the address, the purpose, the code's hash and "not used yet".
Two right answers at once succeed only once (the other gets
`400 AUTH_CODE_INVALID`), and an older code cannot use up a newer one that
replaced it after `check`.

The hashes are compared in constant time (`timingSafeEqual`). Every address
that asked has a code, account or not, so `email-code/verify` and
`reset-password` answer a wrong guess the same everywhere and cannot be used
to find accounts.

The messages the person sees:

- `AUTH_CODE_INVALID`: "That code is not right. If you asked for more than
  one, only the newest works."
- `AUTH_CODE_EXPIRED`: "This code no longer works: it expired, or had too
  many wrong tries. Ask for a new one."

On the 5th attempt a right code still works; only a 5th wrong one ends it.

## Changing the rules

| To change | Edit | Then |
|---|---|---|
| Minimum or maximum length | `PASSWORD_MIN_LENGTH`, `PASSWORD_MAX_LENGTH` in [password-policy.ts](../../src/modules/auth/domain/password-policy.ts) | Update the frontend copy and [password-policy.spec.ts](../../src/modules/auth/domain/password-policy.spec.ts). The message updates itself |
| Add or drop a rule | `checkPassword` and `PASSWORD_RULE_MESSAGES` in the same file | Add the id to the frontend's list and its translations; existing passwords keep signing in |
| Argon2 cost | `ARGON2_PARAMETERS` in [argon2-password-hasher.adapter.ts](../../src/modules/auth/infrastructure/adapters/argon2-password-hasher.adapter.ts) | Existing hashes are upgraded at each person's next sign-in. Re-run a load test: the cost per sign-in changes |
| Code lifetime or attempts | `codeTtlMinutes`, `codeMaxAttempts` in [auth.module.ts](../../src/modules/auth/auth.module.ts) | The emails show the new lifetime by themselves |
| Code limits | [rate-limits.ts](../../src/modules/auth/application/rate-limits.ts) | See [rate-limits.md](./rate-limits.md) |

## Where it is in the code

| File | What |
|---|---|
| [password-policy.ts](../../src/modules/auth/domain/password-policy.ts) | The rules, `baseWord`, `checkPassword` |
| [argon2-password-hasher.adapter.ts](../../src/modules/auth/infrastructure/adapters/argon2-password-hasher.adapter.ts) | Hashing, the dummy hash, rehash |
| [code-issuer.ts](../../src/modules/auth/application/services/code-issuer.ts) | Makes a code, stores its HMAC, queues the email; checks a code |
| [code-generator.util.ts](../../src/shared/utils/code-generator.util.ts) | The six random digits |
| [jose-token-service.adapter.ts](../../src/modules/auth/infrastructure/adapters/jose-token-service.adapter.ts) | `hashVerificationCode`, the HMAC |
| [prisma-verification-code.repository.ts](../../src/modules/auth/infrastructure/persistence/prisma-verification-code.repository.ts) | One live code per address and purpose; the counted check; using a code up |
| [domain/errors/](../../src/modules/auth/domain/errors/) | The error messages |

Tests: [password-policy.spec.ts](../../src/modules/auth/domain/password-policy.spec.ts)
(the rules, and the list's form), the command specs beside the handlers
(which route checks what, in which order) and
[auth.integration-spec.ts](../../test/integration/auth.integration-spec.ts)
(codes guessed at the same moment).

## Related

- [flows.md](./flows.md): the routes that use these, step by step
- [emails.md](./emails.md): the emails that carry the codes
- [rate-limits.md](./rate-limits.md): every limit
- [security.md](./security.md): password guessing, credential stuffing, a leaked database
