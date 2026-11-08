# OpenAPI spec (`openapi.json`)

`openapi.json`, at the repository root, describes every API route: its URL and
method, the request body and the exact response shape — field names, types,
which fields may be missing and which may be `null`. Nobody writes it: Nest
generates it from the controllers and DTOs.

It is committed for two reasons:

- **Frontends generate their types from it**, without the backend running.
  The React starter does this with `pnpm api:types` (see its
  `docs/api-types.md`).
- **API changes show up in `git diff`**, so a changed response shape gets
  reviewed like any other code change.

The same document is served live while the app runs:

| URL | What |
|---|---|
| `/api-docs` | Swagger UI |
| `/api-docs-json` | the document as JSON |
| `/api-docs-yaml` | the document as YAML |

In development these are public. In production they need basic auth with
`BULL_BOARD_USER` / `BULL_BOARD_PASSWORD`, the same credentials as the queue
dashboard.

## Signing in, in the spec and in Swagger UI

The document declares two **security schemes**, in
[`operational-endpoints.ts`](../src/bootstrap/operational-endpoints.ts):

| Scheme | What it is | Routes that use it |
|---|---|---|
| `bearer` | the access token (a JWT) in `Authorization: Bearer <token>` | every route that needs a signed-in user: all of `/users/*` (`@ApiBearerAuth('bearer')` on the controller) and the protected auth routes, such as `/auth/change-password`, `/auth/account/delete` |
| `refresh_token` | the httpOnly cookie that holds the refresh token | `/auth/refresh` and `/auth/logout` (`@ApiCookieAuth('refresh_token')`) |

To call a protected route from Swagger UI: run `POST /api/v1/auth/login`,
copy `access_token` from the answer, click **Authorize**, and paste it under
`bearer`. Swagger UI keeps it across page reloads (`persistAuthorization`).
It expires after 15 minutes (`JWT_ACCESS_TTL_SECONDS`); sign in again then.

Two things Swagger UI cannot do:

- **Refresh or sign out.** Swagger UI is served by the API itself
  (`http://localhost:8888/api-docs`), so its requests carry that origin.
  `/auth/refresh` and `/auth/logout` refuse any `Origin` that is not in
  `CORS_ORIGINS` (the web app's), with 403 `AUTH_FORBIDDEN`: that check is
  what stops another site from using the cookie. Test them from the web app,
  or with `curl`, which sends no `Origin`. The cookie is also scoped to the
  path `/api/v1/auth`, so it is only ever sent to the auth routes.
  ([sessions-and-tokens.md](./auth/sessions-and-tokens.md) explains both.)
- **Google sign-in.** `GET /auth/{provider}` and
  `GET /auth/{provider}/callback` answer with a redirect (302): they are
  browser navigations, not API calls. Open
  `http://localhost:8888/api/v1/auth/google` in the browser instead
  ([google-sign-in.md](./auth/google-sign-in.md)). A client generated from
  the spec should skip them too.

## Commands

| Command | What it does |
|---|---|
| `pnpm openapi:export` | Writes `openapi.json` from the current code. |
| `pnpm openapi:check` | Fails if `openapi.json` doesn't match the code. For CI. |

Neither needs a database or Redis: the app is created in Nest's
preview mode, so nothing connects. They build into `dist-openapi/`, so running
them never disturbs a dev container serving from `dist/`. Values missing from
your env file are taken from `.env.example`, so both also work in CI.

## When you change the API

1. Change the controller or DTO.
2. `pnpm openapi:export`
3. Commit `openapi.json` with the code change.
4. In the frontend, regenerate the types and fix whatever TypeScript reports.

Forget step 2 and `pnpm openapi:check` fails.

## Writing DTOs the spec gets right

The Swagger CLI plugin reads DTO classes at build time (`nest-cli.json`,
`plugins`). It only reads files ending in `.dto.ts`, `.request.dto.ts` or
`.response.dto.ts`.

**The TypeScript types are the contract.** The plugin turns them into the spec,
and the frontend's types come from the spec, so they must say what the API
really sends:

| In the DTO | In the spec | Meaning on the wire |
|---|---|---|
| `bio: string` | required | always sent |
| `bio?: string` | optional | may be left out |
| `bio: string \| null` | required, nullable | always sent, possibly `null` |
| `bio?: string \| null` | optional, nullable | may be left out or `null` |

A mismatch is a real bug for clients: if the DTO says `completed?:
boolean` but the API always sends it, every frontend has to handle a
`undefined` that never happens — or worse, the other way round.

**Property names are written in camelCase** in DTOs, like the rest of the code.
The spec shows them in snake_case, as they appear on the wire; the response
interceptor converts them.

**A JSDoc comment on a property becomes its description** in the spec and in
generated client types. Keep rationale and history in the class comment
instead:

```ts
/**
 * The "complete your account" page (S-ONB-01, REQ-AUTH-01, D-61). — this stays in the code.
 */
export class CompleteAccountRequestDto {
    /** 2-32 characters of `a-z 0-9 _ .`; upper case is lowered. Permanent. — this is published. */
    @Matches(USERNAME_PATTERN)
    username: string
    // ...
}
```

A `//` comment directly above the property's JSDoc stops the plugin from reading
that JSDoc at all.

### Documenting a route

Every success response is wrapped as `{ meta, data }`. Describe it with
`@ApiEnvelopeResponse`, passing the DTO that goes in `data` — or `null` when
`data` is `null`:

```ts
@Get('me')
@ApiEnvelopeResponse(UserProfileResponseDto)
async getProfile() { … }

@Post('logout')
@ApiEnvelopeResponse(null)
async logout() { … }
```

Without it the spec has no response type for the route, and clients get none.

## The contract test

`test/e2e/openapi-contract.e2e-spec.ts` calls the **users** routes and checks
each real response against the committed `openapi.json`: required fields
present, types and `null`s as declared, no undeclared fields. It runs with
`pnpm test:e2e`.

`openapi:check` catches a spec that is stale; the contract test catches a spec
that is wrong. When you add a route, add it to this test too.

The **auth** routes are not in it. Their response shapes (`TokenResponseDto`,
`AuthOptionsResponseDto`) are checked only by the auth
integration suites, which assert on the fields they use, not against the
spec. If you change an auth DTO, run `pnpm openapi:export` and look at the
diff of `openapi.json` yourself; extending the contract test to the auth
controller is a reasonable next step.
