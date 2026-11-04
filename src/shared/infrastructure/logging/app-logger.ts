import { Inject, Injectable } from '@nestjs/common'
import { Logger, PARAMS_PROVIDER_TOKEN, type Params, PinoLogger } from 'nestjs-pino'

type Level = 'verbose' | 'debug' | 'log' | 'warn' | 'error' | 'fatal'

/**
 * Library warnings about a choice this app made on purpose, dropped so that
 * every start doesn't log a warning nobody should act on. Matched by the
 * logger's context and the start of the message.
 */
const EXPECTED_WARNINGS: readonly { context: string; startsWith: string }[] = [
    // @nestjs-modules/mailer looks for its optional email previewer whenever a
    // template adapter is set. It is left out (pnpm-workspace.yaml) with the
    // other template engines, and the app never turns previews on.
    { context: 'MailerService', startsWith: 'preview-email is not installed' }
]

function isExpectedWarning(message: unknown, optionalParams: unknown[]): boolean {
    const context = optionalParams[optionalParams.length - 1]
    return (
        typeof message === 'string' &&
        EXPECTED_WARNINGS.some((warning) => warning.context === context && message.startsWith(warning.startsWith))
    )
}

/**
 * The app's Nest logger: nestjs-pino's, plus errors passed the Nest way.
 *
 * Nest's convention is `logger.error('what failed', error)`, and libraries
 * follow it: @nestjs/cqrs logs a failed event handler as
 * `error('"Handler" has thrown an unhandled exception.', error)`. nestjs-pino
 * hands the extra argument to pino as a format argument, and pino drops it:
 * the log line said something failed, without the error's message or stack.
 * Here an Error among the arguments becomes the entry's `err` field, which
 * pino writes with its type, message and stack.
 */
@Injectable()
export class AppLogger extends Logger {
    constructor(logger: PinoLogger, @Inject(PARAMS_PROVIDER_TOKEN) params: Params) {
        super(logger, params)
    }

    override verbose(message: unknown, ...optionalParams: unknown[]) {
        this.forward('verbose', message, optionalParams)
    }
    override debug(message: unknown, ...optionalParams: unknown[]) {
        this.forward('debug', message, optionalParams)
    }
    override log(message: unknown, ...optionalParams: unknown[]) {
        this.forward('log', message, optionalParams)
    }
    override warn(message: unknown, ...optionalParams: unknown[]) {
        if (isExpectedWarning(message, optionalParams)) return
        this.forward('warn', message, optionalParams)
    }
    override error(message: unknown, ...optionalParams: unknown[]) {
        this.forward('error', message, optionalParams)
    }
    override fatal(message: unknown, ...optionalParams: unknown[]) {
        this.forward('fatal', message, optionalParams)
    }

    private forward(level: Level, message: unknown, optionalParams: unknown[]) {
        super[level](...liftError(message, optionalParams))
    }
}

/**
 * `(message, error, context)` → `({ msg: message, err: error }, context)`.
 *
 * The last argument is nestjs-pino's context, unless it is the error itself
 * (a static `Logger.error(message, error)` has no context). An Error message
 * with nothing else is left alone: nestjs-pino already logs it as `err`.
 */
export function liftError(message: unknown, optionalParams: unknown[]): [unknown, ...unknown[]] {
    const index = optionalParams.findIndex((param) => param instanceof Error)
    if (index === -1) return [message, ...optionalParams]

    const err = optionalParams[index]
    const rest = optionalParams.filter((_, i) => i !== index)
    // Nest's Logger puts `undefined` before the context when a message came
    // alone; with the error lifted out, the placeholder is not needed either.
    const params = rest.filter((param, i) => !(param === undefined && i < rest.length - 1))
    const fields =
        message !== null && typeof message === 'object' && !(message instanceof Error)
            ? { ...message, err }
            : { msg: message instanceof Error ? message.message : message, err }
    return [fields, ...params]
}
