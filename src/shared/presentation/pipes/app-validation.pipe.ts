import { HttpStatus, ValidationError, ValidationPipe } from '@nestjs/common'
import { CustomException } from '@/shared/presentation/exceptions/custom.exception'
import { ERROR_CODES, ERROR_TYPES } from '@/shared/constants'

export interface ValidationErrorItem {
    /** Dotted path to the failing field, e.g. `address.street` or `items.0.qty`. */
    property: string
    constraints: Record<string, string>
    value: unknown
}

/**
 * One entry per failing field, however deeply nested.
 *
 * class-validator reports a failure inside a @ValidateNested() object on the
 * parent's `children`, with no constraints of its own. Mapping only the top
 * level returned `{ property: 'address', constraints: undefined }` — the
 * client was told something under `address` was wrong, but not what.
 */
export function flattenValidationErrors(errors: ValidationError[], parentPath = ''): ValidationErrorItem[] {
    return errors.flatMap((error) => {
        const property = parentPath ? `${parentPath}.${error.property}` : error.property
        const own = error.constraints ? [{ property, constraints: error.constraints, value: error.value }] : []
        return [...own, ...flattenValidationErrors(error.children ?? [], property)]
    })
}

/** The app's global ValidationPipe: 422 with the standard error envelope. */
export function createValidationPipe(): ValidationPipe {
    return new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: {
            enableImplicitConversion: true,
            excludeExtraneousValues: false // Allow properties without @Expose() decorator
        },
        skipMissingProperties: false,
        stopAtFirstError: false,
        exceptionFactory: (validationErrors) =>
            new CustomException({
                code: ERROR_CODES.VALIDATION_ERROR,
                type: ERROR_TYPES.VALIDATION_ERROR,
                message: 'Validation failed',
                errors: flattenValidationErrors(validationErrors),
                status: HttpStatus.UNPROCESSABLE_ENTITY
            })
    })
}
