/**
 * IDEMPOTENCY RACE CONDITION TEST
 * -------------------------------
 * This script simulates 5 concurrent requests sent at the exact same millisecond
 * to verify that the backend's "Processing Lock" and Idempotency logic are working.
 *
 * This is a manual tool, not an automated test — it needs a running backend
 * and a real user token — which is why it lives in scripts/ rather than test/.
 *
 * HOW TO USE:
 * 1. Start your backend: `pnpm docker:dev`
 * 2. Get a valid JWT Token:
 *    - Open your browser DevTools (F12) -> Network tab.
 *    - Sign in to the web app and perform any action (e.g., Save Profile).
 *    - Click the request -> Headers -> Request Headers.
 *    - Copy the string AFTER "Bearer " in the Authorization header.
 * 3. Run this script with the token in the environment (never paste it into
 *    this file — it is tracked by git):
 *    TOKEN=<paste> npx ts-node -r tsconfig-paths/register scripts/idempotency-race.ts
 *    Optionally override the target with API_URL=...
 *
 * EXPECTED RESULT:
 * - Request 1: Status 200 (The first one to hit the server processed successfully)
 * - Request 2-5: Status 409 (Blocked by the atomic processing lock), or 200
 *   with the first one's response if it had already finished (a replay).
 *
 * All five send the same body. One key with a different body is refused with
 * 422 (IDEMPOTENCY_KEY_MISMATCH), which is a different safety check.
 */

import { randomUUID } from 'crypto'

const API_URL = process.env.API_URL ?? 'http://localhost:8888/api/v1/users/me'
const TOKEN = process.env.TOKEN ?? ''
// Must be a UUID: the idempotency interceptor rejects anything else with a
// 400, so a key like 'test-key-<timestamp>' would never reach the lock at all.
const IDEMPOTENCY_KEY = randomUUID()

if (!TOKEN) {
    console.error('Set TOKEN to a valid access token, e.g. TOKEN=eyJ... npx ts-node ...')
    process.exit(1)
}

async function runTest() {
    console.log(`Firing 5 concurrent requests with key: ${IDEMPOTENCY_KEY}`)

    // Node's own fetch: an HTTP error status is an answer, not a throw; only a
    // request that never got one (refused, reset) rejects.
    const requests = Array(5)
        .fill(0)
        .map(() =>
            fetch(API_URL, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${TOKEN.replace(/[^\x20-\x7E]/g, '').trim()}`,
                    'Content-Type': 'application/json',
                    'Idempotency-Key': IDEMPOTENCY_KEY
                },
                body: JSON.stringify({ displayName: 'Race test' })
            }).then(
                (res) => `Status ${res.status}`,
                (err: Error & { cause?: { code?: string } }) => `FAILED (${err.message} [${err.cause?.code}])`
            )
        )

    const results = await Promise.all(requests)
    results.forEach((result, i) => console.log(`Request ${i + 1}: ${result}`))
}

runTest()
