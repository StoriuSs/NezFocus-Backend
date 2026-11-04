/**
 * Settings shared by every script in this folder.
 *
 * k6 copies the shell's environment into `__ENV`, so a setting can be exported
 * once in a terminal or passed per run:
 *
 *     k6 run -e API_URL=https://api.example.com k6/load.js
 *
 * docs/load-testing.md lists all of them with examples.
 */

/** A whole number, falling back when the variable is unset or empty. */
function num(name, fallback) {
    const raw = __ENV[name]
    if (raw === undefined || raw === '') return fallback
    const value = Number(raw)
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`${name} must be a whole number, got "${raw}"`)
    }
    return value
}

/** An origin with trailing slashes removed, so joining with '/' never yields '//'. */
function origin(name, fallback) {
    return (__ENV[name] || fallback).replace(/\/+$/, '')
}

export const config = {
    apiUrl: origin('API_URL', 'http://localhost:8888'),
    // Matches API_PREFIX in the app's environment. The version segment is
    // added separately because URI versioning appends it after the prefix.
    apiPrefix: (__ENV.API_PREFIX || 'api').replace(/^\/+|\/+$/g, ''),

    // An access token you already have. Set this and no sign-in happens — the
    // quickest way to run the authenticated scripts once.
    // It expires, so it suits smoke runs, not long ones.
    token: __ENV.TOKEN || '',

    login: {
        // Put {n} in the address to spread virtual users over several accounts:
        // loadtest{n}@example.test with LOAD_USER_COUNT=50 signs in as
        // loadtest1@example.test ... loadtest50@example.test, so they don't all
        // share one cached profile — see docs/load-testing.md.
        email: __ENV.LOAD_EMAIL || '',
        password: __ENV.LOAD_PASSWORD || '',
        userCount: num('LOAD_USER_COUNT', 1)
    },

    // Shape of the run. Each script documents how it uses these.
    vus: num('VUS', 10),
    duration: __ENV.DURATION || '1m',

    // Response-time budgets in milliseconds, at the 95th percentile. Raise
    // them for a slow network between you and the server; lower them once you
    // know what the application actually does under its expected load.
    readBudgetMs: num('READ_BUDGET_MS', 500),
    writeBudgetMs: num('WRITE_BUDGET_MS', 1000)
}

/** Full URL of an API route: url('users/me') -> http://host/api/v1/users/me */
export function url(path) {
    return `${config.apiUrl}/${config.apiPrefix}/v1/${path.replace(/^\/+/, '')}`
}
