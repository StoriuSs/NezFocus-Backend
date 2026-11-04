# Passwords and emailed codes

The rules a password must follow, how it is stored, and how the six-digit
codes that confirm an address, reset a password, set a first password or
delete an account work.

Read this if you are building a sign-up or settings form, changing a rule, or
wondering why a code was refused. New to hashing and HMAC? See
[hashing and encryption](./concepts.md#hashing-and-encryption) first.

- [The password rules](#the-password-rules)
- [How passwords are stored](#how-passwords-are-stored)
- [The common-password list](#the-common-password-list)
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
| `common` | The word the password is built around is a common one ([below](#the-common-password-check)) | This password is too common. Choose one that is harder to guess. |

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
    "message": "Include a digit. This password is too common. Choose one that is harder to guess.",
    "...": "..."
  },
  "data": {
    "rules": ["digit", "common"],
    "details": "Include a digit. This password is too common. Choose one that is harder to guess.",
    "path": "/api/v1/auth/register",
    "method": "POST"
  }
}
```

### Examples

| Password | Context | Result |
|---|---|---|
| `Harbour-Lantern-42` | | accepted |
| `Dragon-Kettle-Moss-7` | | accepted: containing a common word is fine |
| `Password1!` | | `common` |
| `P@ssw0rd!`, `Summer2026!`, `Dragon#99`, `!!Monkey123` | | `common` |
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

### The common-password check

`Password1!` and `Summer2026!` pass every composition rule: they are exactly
what composition rules make people type, and the first thing an attacker
tries. So each password is reduced to the word it is built around, and that
word is looked up in a list.

The reduction (`baseWord`):

1. lower case;
2. digits and symbols trimmed from both ends (`!!Monkey123` gives `monkey`);
3. common swaps undone: `@` and `4` to `a`, `3` to `e`, `1` and `!` to `i`,
   `0` to `o`, `$` and `5` to `s`, `7` to `t` (`P@ssw0rd` gives `password`).

If what is left is 4 or more letters and nothing else, and it is in the list,
the rule `common` is broken. `Harbour-Lantern-42` reduces to
`harbour-lantern`, which is not a single word, so it passes.

### Which routes check what

| Route | Checked against |
|---|---|
| `POST /auth/register` | the address only (a new account has no username) |
| `POST /auth/reset-password` | the address first, before looking the account up; then the address and the username |
| `POST /auth/change-password` | the address and the username |
| `POST /auth/password` (first password) | the address and the username |
| `POST /auth/login` | nothing: an old password that predates a rule still signs in |

Reset checks with the address first so that whether the password is refused
cannot depend on whether the account exists. Every route checks the rules
before the emailed code, so a refused password does not use the code up.

### Mirroring the rules in the frontend

The React starter copies the rules (its `src/features/auth/lib/password-rules.ts`)
to tick them off while the person types. It checks every rule except
`common` (the list is too big to ship to every visitor) and
`matches_username` (a new account has no username yet). The API stays the
judge: a form shows `data.rules` from the refusal the same way.

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
  successful sign-in (and the confirmed-address check), a hash that is not
  Argon2id, or uses less memory, fewer passes or a different number of lanes
  than the current settings, is replaced with a fresh one.

Argon2 is slow on purpose: each sign-in costs a noticeable slice of a CPU.
That matters for load tests ([load-testing.md](../load-testing.md)) and is the
point against an attacker with a stolen database.

## The common-password list

[common-passwords.ts](../../src/modules/auth/domain/common-passwords.ts) holds
8,472 words: SecLists' "10k most common" passwords (MIT licence), each
reduced with the same `baseWord` as the check, keeping only results of 4 or
more letters. It is generated, committed, and never downloaded at run time.

To rebuild it:

```bash
pnpm passwords:generate              # downloads the list from SecLists
pnpm passwords:generate ./mylist.txt # or uses a file you have, one password per line
```

The script ([generate-common-passwords.ts](../../src/bootstrap/generate-common-passwords.ts))
uses the policy's own `baseWord`, so the list and the check can never reduce a
word differently. Do not edit the file by hand. After regenerating, run the
policy's tests: `pnpm exec jest src/modules/auth/domain/password-policy.spec.ts`.

## Emailed codes

A six-digit code sent to the address proves the person can read that inbox.
Four things use one:

| Purpose | Sent by | Checked by | Email |
|---|---|---|---|
| `email-verify` | `POST /auth/register`, `POST /auth/resend-verification` (unconfirmed address) | `POST /auth/verify-email` | "Verify your {app} account" |
| `password-reset` | `POST /auth/forgot-password` | `POST /auth/reset-password` | "Reset your {app} password", or "Choose a password for your {app} account" when the account has none |
| `password-set` | `POST /auth/password/code` | `POST /auth/password` | "Your code to set a {app} password" |
| `account-delete` | `POST /auth/account/delete-code` | `POST /auth/account/delete` | "Your code to delete your {app} account" |

`{app}` is `APP_NAME`. The emails are described in [emails.md](./emails.md).

| Rule | Value | Why |
|---|---|---|
| Format | 6 digits, `000000` to `999999`, from `crypto.randomInt`; leading zeros kept | A predictable generator would let codes be guessed; zero-padding keeps all million possible |
| Valid for | 10 minutes | Long enough to switch to the inbox, short enough that an old email is useless |
| Attempts | 5 per code | A million possibilities, five guesses: a one in 200,000 chance |
| One at a time | One live code per account and purpose. A new code replaces the old one, which stops working at once, and the attempt count starts again | So "send it again" never leaves two codes that work |
| Used once | A right code is used up | So it cannot be replayed |
| Separate purposes | A reset code does not work for confirming an address, and so on | The purpose is part of what is hashed |
| Input | Must be exactly six digits in the request (else `422`); surrounding spaces are trimmed | |

The 10 minutes and 5 attempts are hard-coded in
[auth.module.ts](../../src/modules/auth/auth.module.ts) (`codeTtlMinutes`,
`codeMaxAttempts`). The email states the lifetime from the same setting.

**Limits around codes** (full table in [rate-limits.md](./rate-limits.md)):

- code emails to one address: 1 a minute and 5 an hour (sign-up has its own
  one-a-minute counter, and shares the five an hour);
- code emails requested from one IP: 10 an hour (resend and forgot password);
- wrong codes from one IP, across addresses: 20 an hour. Only wrong codes
  count. This stops someone spreading guesses over many addresses, five at
  a time.

## How codes are stored

Never as the code itself. The `VerificationCode` table
([auth.prisma](../../prisma/models/auth.prisma)) has one row per account and
purpose:

| Column | Meaning |
|---|---|
| `userId`, `purpose` | Unique together: one live code per purpose |
| `codeHash` | `HMAC-SHA256(key = JWT_SECRET, "<purpose>:<user id>:<code>")`, hex |
| `createdAt`, `expiresAt` | When it was issued, and 10 minutes later |
| `attempts` | Guesses so far |
| `consumedAt` | When the right code was used |

Why an [HMAC](./concepts.md#hmac) and not a plain hash: six digits are only a
million options, so anyone with the database could hash all million and read
every code. Keyed with a secret that is not in the database, the stored
values are useless on their own. The user id and purpose are mixed in, so the
same code for two accounts or two purposes gives different values.

**A consequence: changing `JWT_SECRET` kills every code already sent.** The
stored HMACs were made with the old key, so every waiting code answers
`400 AUTH_CODE_INVALID`. People ask for a new one. Plan a `JWT_SECRET` change
for a quiet moment ([operations.md](./operations.md)).

Rows are deleted by the hourly clean-up one day after they expire or are
used ([clean-up-auth.handler.ts](../../src/modules/auth/application/commands/clean-up-auth/clean-up-auth.handler.ts)).

## How a code is checked

[prisma-verification-code.repository.ts](../../src/modules/auth/infrastructure/persistence/prisma-verification-code.repository.ts)
(`consume`). The attempt is counted in the same SQL statement that reads the
code (`UPDATE … SET attempts = attempts + 1 … RETURNING`), so ten guesses
sent at the same moment use up ten attempts, not one. Then:

| Situation | Answer |
|---|---|
| No code waiting for this purpose, or it was already used | `400 AUTH_CODE_INVALID` |
| Past `expiresAt`, or this is the 6th attempt or later | `400 AUTH_CODE_EXPIRED` |
| Wrong code, and that was the 5th attempt | `400 AUTH_CODE_EXPIRED`: said now, not on the next try |
| Wrong code, attempts 1 to 4 | `400 AUTH_CODE_INVALID` |
| Right code | Marked used (a conditional update, so two right answers at once succeed only once); the route carries on |

The hashes are compared in constant time (`timingSafeEqual`). An unknown
address at `verify-email` or `reset-password` answers
`400 AUTH_CODE_INVALID` too, so these routes cannot be used to find accounts.

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
| The common list | `pnpm passwords:generate [file]` | Run the policy tests |
| Argon2 cost | `ARGON2_PARAMETERS` in [argon2-password-hasher.adapter.ts](../../src/modules/auth/infrastructure/adapters/argon2-password-hasher.adapter.ts) | Existing hashes are upgraded at each person's next sign-in. Re-run a load test: the cost per sign-in changes |
| Code lifetime or attempts | `codeTtlMinutes`, `codeMaxAttempts` in [auth.module.ts](../../src/modules/auth/auth.module.ts) | The emails show the new lifetime by themselves |
| Code limits | [rate-limits.ts](../../src/modules/auth/application/rate-limits.ts) | See [rate-limits.md](./rate-limits.md) |

## Where it is in the code

| File | What |
|---|---|
| [password-policy.ts](../../src/modules/auth/domain/password-policy.ts) | The rules, `baseWord`, `checkPassword` |
| [common-passwords.ts](../../src/modules/auth/domain/common-passwords.ts) | The generated list |
| [generate-common-passwords.ts](../../src/bootstrap/generate-common-passwords.ts) | `pnpm passwords:generate` |
| [argon2-password-hasher.adapter.ts](../../src/modules/auth/infrastructure/adapters/argon2-password-hasher.adapter.ts) | Hashing, the dummy hash, rehash |
| [code-issuer.ts](../../src/modules/auth/application/services/code-issuer.ts) | Makes a code, stores its HMAC, queues the email; checks a code |
| [code-generator.util.ts](../../src/shared/utils/code-generator.util.ts) | The six random digits |
| [jose-token-service.adapter.ts](../../src/modules/auth/infrastructure/adapters/jose-token-service.adapter.ts) | `hashVerificationCode`, the HMAC |
| [prisma-verification-code.repository.ts](../../src/modules/auth/infrastructure/persistence/prisma-verification-code.repository.ts) | One live code per purpose; the counted check |
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
