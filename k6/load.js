import { sleep } from 'k6'
import { config } from './lib/config.js'
import { durationBudgets, expect, get, getPublic, patch } from './lib/api.js'

/**
 * Normal traffic, held steady.
 *
 * This is the run that answers "can it serve the load I expect, at a response
 * time I'm happy with". It ramps up, holds, and ramps down, with a pause
 * between each virtual user's requests the way a real person pauses between
 * clicks.
 *
 *     VUS=50 DURATION=5m k6 run k6/load.js
 *
 * **Arithmetic worth doing before you start.** A virtual user is not a
 * request. Each one here waits about a second between requests, so 50 of them
 * produce roughly 50 requests a second, not 50 requests. If you know the
 * requests per second you need, that is the number to aim at — start well
 * under it and work up.
 *
 * **Turn the rate limiter up first.** The API allows THROTTLE_LIMIT requests
 * per THROTTLE_TTL seconds from one address, and a load test comes from one
 * address. At the default of 100 a minute, everything past the first 100
 * requests is answered 429 and you have measured the rate limiter rather than
 * the application. docs/load-testing.md says what to set instead.
 */

const RAMP_UP = __ENV.RAMP_UP || '30s'
const RAMP_DOWN = __ENV.RAMP_DOWN || '10s'

export const options = {
    stages: [
        { duration: RAMP_UP, target: config.vus },
        { duration: config.duration, target: config.vus },
        { duration: RAMP_DOWN, target: 0 }
    ],
    thresholds: {
        ...durationBudgets,
        // 5xx and dropped connections only — see lib/api.js.
        http_req_failed: ['rate<0.01'],
        // Responses that were not what the route is supposed to give.
        checks: ['rate>0.99'],
        // Some 429s are normal if you share the limit with other traffic. A
        // lot of them means the limit, not the server, is what you measured.
        rate_limited: ['rate<0.05']
    }
}

/** Think time: a second either side of a second, so requests don't arrive in lockstep. */
function think() {
    sleep(0.5 + Math.random())
}

export default function () {
    const roll = Math.random()

    if (roll < 0.6) {
        // The commonest request in this application: the signed-in user's own
        // profile. Served from the auth cache after the first call.
        expect(get('users/me', 'GET users/me'), 'the profile comes back', [200, 429])
    } else if (roll < 0.85) {
        // A database read that the cache cannot answer.
        const name = `k6_${Math.random().toString(36).slice(2, 10)}`
        expect(
            get(`users/username-available/${name}`, 'GET users/username-available/:username'),
            'a username can be checked',
            [200, 429]
        )
    } else if (roll < 0.95) {
        // What a load balancer asks, as often as it asks it.
        expect(getPublic('health/ready', 'GET health/ready'), 'the dependencies answer', [200, 429])
    } else {
        // One request in twenty writes. Writes go through validation, the
        // database and the idempotency store, so they are the slow path.
        expect(
            patch('users/me', 'PATCH users/me', { display_name: `load test ${__VU}` }),
            'the profile can be updated',
            [200, 429]
        )
    }

    think()
}
