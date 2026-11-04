import http from 'k6/http'
import { check } from 'k6'
import { Counter, Rate } from 'k6/metrics'
import { config, url } from './config.js'
import { authHeaders } from './auth.js'

/**
 * Request helpers, and the extra metrics the summary reports.
 *
 * Two things here are worth knowing before you read a result.
 *
 * **What counts as a failed request.** By default k6 treats any status from
 * 400 up as a failure, which would make a rate-limited run look like a broken
 * application. This API answers 429 when a client goes over its limit and 4xx
 * when a client sends something wrong — both are the server working correctly.
 * So `http_req_failed` here means "5xx or no answer at all", and the 429s get
 * a metric of their own.
 *
 * **Every request is tagged.** `name` groups requests by route (without it,
 * every username in the URL would be its own row), and `kind` separates reads
 * from writes so each can have its own response-time budget.
 */

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }))

/**
 * For the scripts that overload the server on purpose.
 *
 * 503 normally means the application is broken, so by default it counts as a
 * failed request. In `spike.js` and `upload.js` it means the opposite: a limit
 * refused work rather than letting the server fall over, which is the outcome
 * those scripts are checking for. Pass this to the requests they send, so
 * `http_req_failed` keeps its meaning — 500s and unanswered connections only.
 */
export const sheddingIsFine = http.expectedStatuses({ min: 200, max: 499 }, 503)

/** Share of responses that were 429 — the rate limiter turning traffic away. */
export const rateLimited = new Rate('rate_limited')

/** Responses the application itself failed on. Any of these is a bug to chase. */
export const serverErrors = new Counter('server_errors')

/** Avatar uploads refused because the image queue was full (503). */
export const imageQueueFull = new Rate('image_queue_full')

function record(response) {
    rateLimited.add(response.status === 429)
    if (response.status >= 500) serverErrors.add(1)
    return response
}

/**
 * A random UUID for the Idempotency-Key header.
 *
 * Math.random is fine for this: the key only has to be unique within one run,
 * and nothing about it is a secret.
 */
export function idempotencyKey() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })
}

/**
 * Request options, with the response callback left out entirely when there
 * isn't one — passing `undefined` would override k6's default with nothing.
 */
function params(base, responseCallback) {
    return responseCallback ? Object.assign({ responseCallback }, base) : base
}

/** GET an API route as the signed-in user. */
export function get(path, name, responseCallback) {
    return record(
        http.get(
            url(path),
            params(
                {
                    headers: authHeaders(),
                    tags: { name, kind: 'read' }
                },
                responseCallback
            )
        )
    )
}

/** GET an API route with no token — for the public health probes. */
export function getPublic(path, name) {
    return record(http.get(url(path), { tags: { name, kind: 'read' } }))
}

/** PATCH an API route as the signed-in user, with a fresh idempotency key. */
export function patch(path, name, body) {
    return record(
        http.patch(url(path), JSON.stringify(body), {
            headers: authHeaders({
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotencyKey()
            }),
            tags: { name, kind: 'write' }
        })
    )
}

/**
 * POST a multipart body as the signed-in user.
 *
 * Content-Type is left to k6, which sets multipart/form-data with the boundary
 * it generated; writing one by hand here would break the upload.
 */
export function postForm(path, name, form, responseCallback) {
    return record(
        http.post(
            url(path),
            form,
            params(
                {
                    headers: authHeaders({ 'Idempotency-Key': idempotencyKey() }),
                    tags: { name, kind: 'write' }
                },
                responseCallback
            )
        )
    )
}

/**
 * Records whether a response was one the server was supposed to give.
 *
 * `expected` lists the acceptable statuses, so a 429 under deliberate overload
 * is a pass while a 500 is a failure. The check name is what shows up in the
 * summary, so it says what was being exercised, not what was returned.
 */
export function expect(response, name, expected) {
    return check(response, {
        [name]: (r) => expected.includes(r.status)
    })
}

/** Response-time budgets, shared by the scripts that measure steady traffic. */
export const durationBudgets = {
    'http_req_duration{kind:read}': [`p(95)<${config.readBudgetMs}`],
    'http_req_duration{kind:write}': [`p(95)<${config.writeBudgetMs}`]
}
