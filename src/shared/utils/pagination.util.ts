import { Type } from 'class-transformer'
import { IsInt, IsOptional, Min, Max } from 'class-validator'

/**
 * Standard pagination query parameters
 */
export class PaginationQueryDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number = 1

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(1000) // Increased to support loading all items for dropdowns
    limit?: number = 10
}

/**
 * Pagination metadata for responses
 */
export interface PaginationMeta {
    currentPage: number
    itemsPerPage: number
    totalItems: number
    totalPages: number
    hasNextPage: boolean
    hasPreviousPage: boolean
}

/**
 * Paginated response structure
 */
export interface PaginatedResponse<T> {
    items: T[]
    meta: PaginationMeta
}

/**
 * Calculate pagination metadata
 */
export function calculatePagination(page: number, limit: number, totalItems: number): PaginationMeta {
    const totalPages = Math.ceil(totalItems / limit)

    return {
        currentPage: page,
        itemsPerPage: limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
    }
}

/**
 * Get skip value for Prisma query
 */
export function getSkip(page: number, limit: number): number {
    return (page - 1) * limit
}

/**
 * Create paginated response
 */
export function createPaginatedResponse<T>(
    items: T[],
    page: number,
    limit: number,
    totalItems: number
): PaginatedResponse<T> {
    return {
        items,
        meta: calculatePagination(page, limit, totalItems)
    }
}
