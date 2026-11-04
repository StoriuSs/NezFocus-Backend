import { HttpException, HttpStatus } from '@nestjs/common'

export interface CustomExceptionOptions {
    code: string
    type: string
    message?: string | string[]
    errors?: Record<string, unknown> | unknown[]
    status?: number
    /**
     * What went wrong underneath, for the log and error tracking only: a 5xx
     * answer carries `message`, and an SDK's own text can name internal hosts.
     */
    cause?: unknown
}

export class CustomException extends HttpException {
    readonly code: string
    readonly type: string
    readonly errors: Record<string, unknown> | unknown[] | null

    constructor(options: CustomExceptionOptions) {
        super(
            {
                message: options.message || 'Error',
                code: options.code,
                type: options.type,
                errors: options.errors || null
            },
            options.status || HttpStatus.INTERNAL_SERVER_ERROR,
            options.cause === undefined ? undefined : { cause: options.cause }
        )
        this.code = options.code
        this.type = options.type
        this.errors = options.errors || null
    }
}
