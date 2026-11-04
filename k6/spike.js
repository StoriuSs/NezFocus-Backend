import { config } from './lib/config.js'
import { expect, get, sheddingIsFine } from './lib/api.js'

/**
 * A sudden burst, and what it does to everyone else.
 *
 * Load tests ask "how fast at this rate". This one asks a different question:
 * when far more traffic arrives than the server can serve, does it refuse the
 * excess and keep working, or does it fall over and take the ordinary users
 * with it? Getting 429 and 503 here is a pass. Getting 500s, connection
 * errors, or a server that is still slow a minute later is not.
 *
 *     SPIKE_RATE=300 k6 run k6/spike.js
 *
 * Two kinds of traffic run at once:
 *
 * - **steady** — five requests a second for the whole run, start to finish.
 *   This is your ordinary user. Its numbers are the ones that matter: look at
 *   `http_req_duration{scenario:steady}` in the summary.
 * - **spike** — quiet for thirty seconds, then a wall of traffic for thirty,
 *   then gone. The run continues afterwards so you can see how long recovery
 *   takes.
 *
 * Unlike load.js this sends at a fixed *rate* rather than from a fixed number
 * of users, so a slow server does not slow the traffic down with it — which is
 * the whole point of a spike.
 */

const SPIKE_RATE = Number(__ENV.SPIKE_RATE || 200)
const STEADY_RATE = Number(__ENV.STEADY_RATE || 5)

export const options = {
    scenarios: {
        steady: {
            executor: 'constant-arrival-rate',
            rate: STEADY_RATE,
            timeUnit: '1s',
            duration: '2m30s',
            preAllocatedVUs: Math.max(10, STEADY_RATE * 2),
            // Without a ceiling, k6 would add virtual users indefinitely to
            // keep the rate up while the server is struggling.
            maxVUs: Math.max(50, STEADY_RATE * 10)
        },
        spike: {
            executor: 'ramping-arrival-rate',
            startTime: '30s',
            startRate: STEADY_RATE,
            timeUnit: '1s',
            stages: [
                { duration: '10s', target: SPIKE_RATE },
                { duration: '30s', target: SPIKE_RATE },
                { duration: '10s', target: 0 }
            ],
            preAllocatedVUs: Math.max(50, SPIKE_RATE),
            maxVUs: Math.max(200, SPIKE_RATE * 5)
        }
    },
    thresholds: {
        // Refusing traffic is fine. Failing to answer is not.
        http_req_failed: ['rate<0.01'],
        // Every response has to be one the API is supposed to give.
        checks: ['rate>0.95'],
        // What the ordinary users saw. Deliberately generous: some slowdown
        // during a spike is expected, an order of magnitude is not.
        'http_req_duration{scenario:steady}': [`p(95)<${config.readBudgetMs * 4}`]
    }
}

export default function () {
    // 200 served, 429 rate-limited, 503 shedding load — all correct answers,
    // so none of them counts as a failed request.
    expect(get('users/me', 'GET users/me', sheddingIsFine), 'the server gave a valid answer', [200, 429, 503])
}
