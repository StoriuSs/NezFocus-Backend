import { applyDecorators } from '@nestjs/common'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsISO8601, Matches, ValidateIf } from 'class-validator'

/**
 * A due date (REQ-TASK-01): an ISO time with its offset (`Z` or `+07:00`),
 * so the moment does not depend on the server's zone; null for none.
 */
export const DueAtField = () =>
    applyDecorators(
        ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }),
        ValidateIf((_, value) => value !== null && value !== undefined),
        IsISO8601({ strict: true }),
        Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/, { message: 'due_at must be a time with its offset, such as Z or +07:00' })
    )
