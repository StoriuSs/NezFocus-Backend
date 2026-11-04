import './load-env' // LOG_LEVEL is read at import time, before ConfigModule
import { Params } from 'nestjs-pino'
import {
    REDACTED,
    SENSITIVE_BODY_FIELDS,
    SENSITIVE_REQUEST_HEADERS,
    SENSITIVE_RESPONSE_HEADERS
} from '@/shared/constants/sensitive-fields'

const logLevel = process.env.LOG_LEVEL || 'info'

/**
 * Logging policy: the app writes to stdout, and nothing else.
 *
 * Shipping logs is the platform's job, not the application's. In Docker,
 * Alloy reads every container's stdout (this app, Postgres, Redis, the
 * backups, ...) and pushes it to Loki — one pipeline for everything. The app
 * used to also push its own logs straight to Loki (pino-loki), which stored
 * every line twice and made the app depend on Loki's address; a crash or
 * `docker kill` also lost whatever that transport still had batched in memory.
 *
 * Format:
 *  - json   — one JSON object per line. What Alloy/Loki parse. The default
 *             whenever stdout is not an interactive terminal (every container)
 *             and always in production.
 *  - pretty — human-readable, via pino-pretty (a devDependency). The default
 *             when you run the app yourself in a terminal outside production,
 *             and with MONITORING=off (development only), where no Alloy
 *             reads the container's output.
 *
 * LOG_FORMAT=json|pretty overrides the default. Pretty is never used in
 * production: pino-pretty is not installed in the production image.
 *
 * To read a dev container's JSON output prettily: `pnpm docker:logs`.
 */
export type LogFormat = 'json' | 'pretty'

export function resolveLogFormat(
    env: NodeJS.ProcessEnv = process.env,
    isTTY = Boolean(process.stdout.isTTY)
): LogFormat {
    if (env.NODE_ENV === 'production') return 'json'
    if (env.LOG_FORMAT === 'json' || env.LOG_FORMAT === 'pretty') return env.LOG_FORMAT
    return isTTY || env.MONITORING === 'off' ? 'pretty' : 'json'
}

/** The shared sensitive-field list (also scrubbed from Sentry events), as pino paths. */
export const REDACT_PATHS: string[] = [
    ...SENSITIVE_REQUEST_HEADERS.map((header) => `req.headers["${header}"]`),
    ...SENSITIVE_RESPONSE_HEADERS.map((header) => `res.headers["${header}"]`),
    ...SENSITIVE_BODY_FIELDS.flatMap((field) => {
        const snake = field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
        return snake === field ? [`req.body.${field}`] : [`req.body.${field}`, `req.body.${snake}`]
    })
]

const prettyTransport = {
    target: 'pino-pretty',
    options: {
        singleLine: false,
        colorize: true,
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname,req.id,req.headers,req.remoteAddress,req.remotePort,res.headers'
    }
}

export const pinoConfig: Params = {
    pinoHttp: {
        level: logLevel,
        messageKey: 'msg',
        // No transport for JSON: pino writes straight to stdout, synchronously
        // on the main thread, so nothing is lost if the process dies.
        ...(resolveLogFormat() === 'pretty' && { transport: prettyTransport }),
        customProps: (req) => ({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            requestId: (req as any)['requestId'],
            context: 'HTTP'
        }),
        autoLogging: false,
        customLogLevel: function (req, res, err) {
            if (res.statusCode >= 400 && res.statusCode < 500) {
                return 'warn'
            } else if (res.statusCode >= 500 || err) {
                return 'error'
            }
            return 'info'
        },
        redact: {
            paths: REDACT_PATHS,
            censor: REDACTED
        }
    },
    // No routes: request/response logging is handled by LoggingInterceptor,
    // and `autoLogging` above is off. nestjs-pino's HTTP middleware is
    // therefore deliberately not mounted anywhere.
    forRoutes: []
}
