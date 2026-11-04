import { PaginatedResponse, PaginationMeta, createPaginatedResponse as createPagination } from '@/shared/utils'

/**
 * Type for what services return BEFORE TransformInterceptor processes it.
 * The interceptor transforms this into ApiResponse<T> with { meta, data } structure.
 *
 * Only the message is chosen here. A success carries no code or type of its
 * own: the route and the HTTP status already say what happened, and nothing
 * reads one. Errors do carry both (ERROR_CODES, ERROR_TYPES), because a
 * client has to tell apart failures that share a status.
 *
 * @example
 * // Service method with type-safe return
 * async updateProfile(id: string, dto: UpdateDto): Promise<ServiceResponse<UserDto>> {
 *     const user = await this.repo.update(id, dto)
 *     return createResponse(MESSAGES.USER.PROFILE_UPDATED, serialize(UserDto, user))
 * }
 */
/**
 * Marker for envelopes produced by `createResponse`.
 *
 * TransformInterceptor once identified these by shape — "does the object
 * have these keys?" — which is a guess about user data, not a contract: any
 * payload that happened to carry them was silently reinterpreted as an
 * envelope and its real content dropped. An explicit, non-enumerable brand
 * cannot be produced by accident, and being non-enumerable it never reaches
 * the wire.
 */
export const SERVICE_RESPONSE_BRAND = Symbol('ServiceResponse')

export interface ServiceResponse<T = unknown> {
    message: string
    data: T
    readonly [SERVICE_RESPONSE_BRAND]?: true
}

/** Type guard used by TransformInterceptor to recognise a built envelope. */
export function isServiceResponse(value: unknown): value is ServiceResponse {
    return typeof value === 'object' && value !== null && SERVICE_RESPONSE_BRAND in value
}

function brand<T>(response: ServiceResponse<T>): ServiceResponse<T> {
    Object.defineProperty(response, SERVICE_RESPONSE_BRAND, { value: true, enumerable: false })
    return response
}

/**
 * Type-safe builder function for service responses.
 * Ensures all required fields are present and data matches the expected type.
 *
 * @param message - Human-readable message, from MESSAGES
 * @param data - Response payload (type-checked)
 * @returns ServiceResponse<T> that TransformInterceptor will wrap in { meta, data }
 */
export function createResponse<T>(message: string, data: T): ServiceResponse<T> {
    return brand({ message, data })
}

/**
 * Paginated service response type using existing pagination utilities.
 * Uses PaginatedResponse from pagination.util.ts to avoid duplication.
 *
 * @example
 * async getUsers(query: PaginationQueryDto): Promise<PaginatedServiceResponse<UserDto>> {
 *     const [items, total] = await this.repo.findAndCount(query)
 *     return createPaginatedServiceResponse(
 *         'Users fetched successfully',
 *         items,
 *         query.page,
 *         query.limit,
 *         total
 *     )
 * }
 */
export type PaginatedServiceResponse<T> = ServiceResponse<PaginatedResponse<T>>

/**
 * Helper to create paginated responses with type safety.
 * Wraps the existing createPaginatedResponse from pagination.util.ts.
 *
 * @param message - Human-readable message
 * @param items - Array of items for current page
 * @param page - Current page number
 * @param limit - Items per page
 * @param totalItems - Total count of all items
 * @returns PaginatedServiceResponse<T>
 */
export function createPaginatedServiceResponse<T>(
    message: string,
    items: T[],
    page: number,
    limit: number,
    totalItems: number
): PaginatedServiceResponse<T> {
    // Use existing pagination utility
    const paginatedData = createPagination(items, page, limit, totalItems)

    return brand({
        message,
        data: paginatedData
    })
}

// Re-export pagination types for convenience
export { PaginatedResponse, PaginationMeta }
