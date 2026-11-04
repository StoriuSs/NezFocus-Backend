import { plainToInstance, ClassConstructor } from 'class-transformer'
import { validateSync, ValidationError } from 'class-validator'
import { Logger } from '@nestjs/common'

const logger = new Logger('Serializer')

/**
 * Serialize data using class-transformer DTOs
 * @param cls - The DTO class to serialize to
 * @param plain - The plain object to serialize
 * @returns Serialized instance with only @Expose() decorated properties
 *
 * @note This only transforms, does NOT validate. Use validateAndTransform() for validation.
 */
export function serialize<T, V>(cls: ClassConstructor<T>, plain: V): T {
    return plainToInstance(cls, plain, {
        excludeExtraneousValues: true,
        enableImplicitConversion: true
    })
}

/**
 * Serialize an array of data using class-transformer DTOs
 * @param cls - The DTO class to serialize to
 * @param plain - The array of plain objects to serialize
 * @returns Array of serialized instances
 */
export function serializeArray<T, V>(cls: ClassConstructor<T>, plain: V[]): T[] {
    return plain.map((item) => serialize(cls, item))
}

/**
 * Options for validateAndTransform
 */
export interface ValidateAndTransformOptions {
    /** Whether to throw an error on validation failure (default: false, logs warning) */
    throwOnError?: boolean
    /** Whether to skip missing properties (default: true) */
    skipMissingProperties?: boolean
    /** Whether to skip null properties (default: true) */
    skipNullProperties?: boolean
    /** Whether to skip undefined properties (default: true) */
    skipUndefinedProperties?: boolean
}

/**
 * Serialize and validate data at runtime using class-transformer and class-validator.
 * Combines transformation with validation to catch malformed response data before sending to clients.
 *
 * @param cls - The DTO class with @Expose() and validation decorators
 * @param plain - The plain object to serialize and validate
 * @param options - Validation options
 * @returns Validated and serialized instance
 * @throws Error if validation fails and throwOnError is true
 *
 * @example
 * const responseData = validateAndTransform(UserPreferencesResponseDto, {
 *     username: user.username,
 *     displayName: user.displayName,
 *     avatarUrl: user.avatarUrl
 * })
 */
export function validateAndTransform<T extends object, V>(
    cls: ClassConstructor<T>,
    plain: V,
    options: ValidateAndTransformOptions = {}
): T {
    const {
        throwOnError = false,
        skipMissingProperties = true,
        skipNullProperties = true,
        skipUndefinedProperties = true
    } = options

    // Transform to class instance
    const instance = plainToInstance(cls, plain, {
        excludeExtraneousValues: true,
        enableImplicitConversion: true
    })

    // Validate the instance
    const errors = validateSync(instance, {
        skipMissingProperties,
        skipNullProperties,
        skipUndefinedProperties,
        whitelist: true,
        forbidNonWhitelisted: false
    })

    if (errors.length > 0) {
        const errorMessages = formatValidationErrors(errors)
        const errorMessage = `Response DTO validation failed for ${cls.name}: ${errorMessages.join(', ')}`

        if (throwOnError) {
            throw new Error(errorMessage)
        }

        // Log warning but don't throw - allows graceful degradation
        logger.warn(errorMessage)
    }

    return instance
}

/**
 * Serialize and validate an array of data at runtime
 *
 * @param cls - The DTO class with validation decorators
 * @param plain - The array of plain objects to serialize and validate
 * @param options - Validation options
 * @returns Array of validated and serialized instances
 */
export function validateAndTransformArray<T extends object, V>(
    cls: ClassConstructor<T>,
    plain: V[],
    options: ValidateAndTransformOptions = {}
): T[] {
    return plain.map((item) => validateAndTransform(cls, item, options))
}

/**
 * Format validation errors into readable messages
 */
function formatValidationErrors(errors: ValidationError[], prefix = ''): string[] {
    const messages: string[] = []

    for (const error of errors) {
        const property = prefix ? `${prefix}.${error.property}` : error.property

        if (error.constraints) {
            for (const constraint of Object.values(error.constraints)) {
                messages.push(`${property}: ${constraint}`)
            }
        }

        if (error.children && error.children.length > 0) {
            messages.push(...formatValidationErrors(error.children, property))
        }
    }

    return messages
}
