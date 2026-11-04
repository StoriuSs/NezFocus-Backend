/**
 * The detail a failing health indicator reports.
 *
 * `/health` is public, and a dependency's error text names internals: Prisma's
 * "Can't reach database server at `postgres:5432`", a Redis host, an auth
 * failure. Outside production the message helps; in production only the
 * indicator's up/down status is exposed — the full error is in the log line
 * the exception filter writes for the failed check.
 */
export function failureDetail(error: unknown): Record<string, string> {
    if (process.env.NODE_ENV === 'production') return {}
    return { message: error instanceof Error ? error.message : String(error) }
}
