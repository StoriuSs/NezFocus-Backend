import { readFileSync } from 'fs'
import { join } from 'path'
import { load } from 'js-yaml'

/**
 * The production healthcheck decides what "a release is healthy" means:
 * deploy.sh promotes a release once its containers report healthy, and rolls
 * back when they don't. Probing /health/live only asks whether the process is
 * up, so a release that could reach neither the database nor Redis was
 * promoted and kept serving 503s (seen on a test server).
 */
describe('the production app healthcheck', () => {
    it('asks, through the global prefix and version, whether the app can serve a request, after a start period', () => {
        const compose = load(readFileSync(join(process.cwd(), 'docker-compose.prod.yaml'), 'utf8')) as {
            services: Record<string, { healthcheck?: { test?: string[]; start_period?: string } }>
        }
        const healthcheck = compose.services.app.healthcheck
        const test = healthcheck?.test?.join(' ') ?? ''

        expect(test).toContain('/api/v1/health/ready')
        expect(test).not.toContain('/health/live')
        // Migrations and a first connection get time before failures count.
        expect(healthcheck?.start_period).toBeDefined()
    })
})
