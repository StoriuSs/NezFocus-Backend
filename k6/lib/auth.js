import http from 'k6/http'
import { fail } from 'k6'
import { config, url } from './config.js'

/**
 * Access tokens for the virtual users.
 *
 * Two ways to get one:
 *
 * - `TOKEN=...` — used as-is. Nothing to set up, no credentials in your shell
 *   history. It expires, so use it for smoke runs.
 * - `LOAD_EMAIL` and `LOAD_PASSWORD` — this file signs in through the API's
 *   own `POST /auth/login`, and again shortly before the token expires. The
 *   accounts must exist and be confirmed: `pnpm load:accounts` makes them.
 *
 * Without either, `canSignIn()` returns false and the scripts skip their
 * signed-in scenarios and say so.
 *
 * Every virtual user in k6 runs its own JavaScript instance, so the cache below
 * is per virtual user: one sign-in each, not one per request.
 */

let cached = null

/** Refresh this long before expiry, so a request never carries a token that dies in flight. */
const REFRESH_MARGIN_MS = 30_000

/**
 * Which login this virtual user uses. With LOAD_USER_COUNT=50 and
 * LOAD_EMAIL=loadtest{n}@example.test, virtual user 1 signs in as
 * loadtest1@example.test, virtual user 51 as loadtest1@example.test again,
 * and so on. Without `{n}` every virtual user shares one account.
 */
function emailForThisVu() {
    const { email, userCount } = config.login
    if (userCount <= 1) return email.replace('{n}', '')
    return email.replace('{n}', String(((__VU - 1) % userCount) + 1))
}

function missingSetting() {
    const { email, password } = config.login
    if (!email) return 'LOAD_EMAIL'
    if (!password) return 'LOAD_PASSWORD'
    return null
}

function fetchToken() {
    const missing = missingSetting()
    if (missing) {
        fail(`${missing} is not set. Set TOKEN, or LOAD_EMAIL and LOAD_PASSWORD. See docs/load-testing.md.`)
    }

    const response = http.post(
        url('auth/login'),
        JSON.stringify({ email: emailForThisVu(), password: config.login.password }),
        {
            headers: { 'Content-Type': 'application/json' },
            // Signing in is setup, not the thing being measured. Its own tag
            // keeps it out of the request statistics for the API.
            tags: { name: 'auth login' }
        }
    )

    if (response.status !== 200) {
        fail(`The API refused the login for ${emailForThisVu()} (HTTP ${response.status}). ${whyRefused(response)}`)
    }

    const body = response.json()
    return {
        token: body.data.access_token,
        // expires_in is in seconds.
        expiresAt: Date.now() + body.data.expires_in * 1000 - REFRESH_MARGIN_MS
    }
}

/** What to do about a refused login, from the error's `meta.type`. */
function whyRefused(response) {
    let type = null
    try {
        type = response.json().meta.type
    } catch {
        // Not the API's envelope (a proxy's error page): the body says more.
    }
    switch (type) {
        case 'AUTH_TWO_FACTOR_REQUIRED':
            return 'The account has two-step sign-in on, which a load test cannot pass: turn it off with pnpm auth:two-factor:off <email>, or use other accounts.'
        case 'AUTH_CAPTCHA_REQUIRED':
        case 'AUTH_CAPTCHA_FAILED':
            return 'Turnstile is asking for a check after failed sign-ins, and k6 cannot send one: fix LOAD_PASSWORD, then wait 15 minutes or run against an API with Turnstile off (docs/load-testing.md).'
        case 'AUTH_EMAIL_NOT_VERIFIED':
            return 'The account is not confirmed yet: pnpm load:accounts makes confirmed ones.'
        case 'RATE_LIMIT_EXCEEDED':
            return 'The sign-in limits refused it: too many failed sign-ins from this address or network.'
        case 'AUTH_INVALID_CREDENTIALS':
            return 'Wrong email or password, or no such account.'
        default:
            return `Response: ${response.body}`
    }
}

/** Whether a token, or credentials to get one, are available. */
export function canSignIn() {
    return Boolean(config.token) || missingSetting() === null
}

/** A valid access token for this virtual user. */
export function accessToken() {
    if (config.token) return config.token
    if (!cached || cached.expiresAt <= Date.now()) cached = fetchToken()
    return cached.token
}

/** Headers for an authenticated request, merged with anything you pass. */
export function authHeaders(extra) {
    return Object.assign({ Authorization: `Bearer ${accessToken()}` }, extra || {})
}
