import http from 'k6/http'
import { check } from 'k6'
import { config, url } from './lib/config.js'
import { canSignIn } from './lib/auth.js'
import { expect, get, getPublic, patch } from './lib/api.js'

/**
 * Does it work at all?
 *
 * One virtual user, one pass over every route, no load. Run this first: if
 * something is wrong with the URL, the token or the deployment, it says so in
 * two seconds instead of two minutes. It also runs quickly enough to use as a
 * post-deploy check.
 *
 *     k6 run -e API_URL=https://api.example.com -e TOKEN=eyJ... k6/smoke.js
 *
 * Without a token it checks the public routes and stops.
 */
export const options = {
    vus: 1,
    iterations: 1,
    thresholds: {
        // Nothing is allowed to fail in a smoke run. Anything less than a
        // clean pass means don't bother with the load scripts yet.
        checks: ['rate==1.00'],
        http_req_failed: ['rate==0.00']
    }
}

export default function () {
    expect(getPublic('health/live', 'GET health/live'), 'the process is serving HTTP', [200])

    const ready = getPublic('health/ready', 'GET health/ready')
    expect(ready, 'the database and Redis answer', [200])
    check(ready, {
        'the readiness body names its checks': (r) => r.json('data.info') !== undefined
    })

    // No token: the guard has to refuse. If this passes with a 200, the API is
    // open to the internet.
    const anonymous = http.get(url('users/me'), { tags: { name: 'GET users/me', kind: 'read' } })
    expect(anonymous, 'an unauthenticated profile read is refused', [401])

    if (!canSignIn()) {
        console.warn('No TOKEN and no LOAD_EMAIL/LOAD_PASSWORD — skipping the signed-in routes.')
        return
    }

    const profile = get('users/me', 'GET users/me')
    expect(profile, 'the profile comes back', [200])
    check(profile, {
        'the profile has an id': (r) => typeof r.json('data.id') === 'string'
    })

    // A name that will not collide with a real one, and shows which run wrote it.
    const updated = patch('users/me', 'PATCH users/me', { display_name: `load test ${Date.now()}` })
    expect(updated, 'the profile can be updated', [200])

    const available = get(`users/username-available/${randomName()}`, 'GET users/username-available/:username')
    expect(available, 'a username can be checked', [200])
    check(available, {
        'an unused name reads as available': (r) => r.json('data.available') === true
    })

    console.log(`Smoke run finished against ${config.apiUrl}.`)
}

/** A name nobody has taken, in the format the API accepts (lowercase, digits, underscore). */
function randomName() {
    return `k6_${Math.random().toString(36).slice(2, 10)}`
}
