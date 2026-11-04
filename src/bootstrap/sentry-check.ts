// Sends one test error to error tracking and says whether it was accepted.
// See docs/error-tracking.md.
//
//   pnpm sentry:check                    with .env.development
//   NODE_ENV=production pnpm sentry:check
//
// In a production container, with the environment compose gives the app:
//
//   docker compose --env-file .env.production -f docker-compose.prod.yaml \
//     exec app node dist/src/bootstrap/sentry-check.js
//
// Exits 1 when error tracking is off, the DSN is invalid, or the event was not
// accepted, with the reason.
import '../config/load-env'
import * as Sentry from '@sentry/nestjs'
import { sentryOptions } from '../config/sentry.config'
import { validationSchema } from '../config/validation'

async function main(): Promise<number> {
    const dsn = process.env.SENTRY_DSN?.trim()
    if (!dsn) {
        console.error('SENTRY_DSN is not set: error tracking is off, so there is nothing to check.')
        return 1
    }
    const { error } = validationSchema.extract('SENTRY_DSN').label('SENTRY_DSN').validate(dsn)
    if (error) {
        console.error(error.message)
        return 1
    }

    type TransportOptions = Parameters<typeof Sentry.makeNodeTransport>[0]
    type Transport = ReturnType<typeof Sentry.makeNodeTransport>
    const responses: Awaited<ReturnType<Transport['send']>>[] = []
    const failures: unknown[] = []
    const recording = (options: TransportOptions): Transport => {
        const transport = Sentry.makeNodeTransport(options)
        return {
            ...transport,
            send: async (envelope) => {
                try {
                    const response = await transport.send(envelope)
                    responses.push(response)
                    return response
                } catch (sendError) {
                    failures.push(sendError)
                    throw sendError
                }
            }
        }
    }

    // sentryOptions() returns null under NODE_ENV=test; the check is explicit.
    const options = sentryOptions({ ...process.env, NODE_ENV: process.env.NODE_ENV || 'development' })!
    Sentry.init({ ...options, transport: recording, integrations: [] })

    const eventId = Sentry.captureException(new Error('Test error from pnpm sentry:check'), {
        tags: { check: 'sentry:check' },
        level: 'info'
    })
    const flushed = await Sentry.close(10_000)
    const host = new URL(dsn).host
    const status = responses[0]?.statusCode

    if (status !== undefined && status >= 200 && status < 300) {
        console.log(`Accepted by ${host}: event ${eventId}, environment "${options.environment}".`)
        console.log('It shows up under Issues as "Test error from pnpm sentry:check" within a minute.')
        return 0
    }
    if (status === 401 || status === 403) {
        console.error(`${host} refused the DSN (HTTP ${status}): the key was revoked or belongs to another project.`)
    } else if (status === 429) {
        console.error(`${host} is rate limiting this project (HTTP 429): the plan's quota may be used up.`)
    } else if (status !== undefined) {
        console.error(`${host} answered HTTP ${status}.`)
    } else if (failures.length > 0) {
        console.error(`Could not reach ${host}: ${String((failures[0] as Error)?.message ?? failures[0])}`)
    } else {
        console.error(
            flushed
                ? `Nothing was sent to ${host}.`
                : `No answer from ${host} within 10 seconds (a firewall blocking outbound HTTPS?).`
        )
    }
    return 1
}

main().then(
    (code) => process.exit(code),
    (error: unknown) => {
        console.error(error)
        process.exit(1)
    }
)
