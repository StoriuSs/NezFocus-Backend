import { applyDecorators } from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsInt, Max, Min, ValidateIf } from 'class-validator'
import { STUDY_CYCLE_LIMITS } from '@/modules/servers'

type CyclePart = keyof typeof STUDY_CYCLE_LIMITS

/**
 * A part of a session's cycle, in the ranges of a study room's (D-223):
 * whole minutes, or for `longBreakEvery` focus phases. `optional`: may be
 * left out; the long-break halves may be null (no long break). Both halves
 * or neither is the handler's to check (`study_cycle`).
 */
export function CycleMinutes(part: CyclePart, { optional, nullable }: { optional: boolean; nullable: boolean }) {
    const { min, max } = STUDY_CYCLE_LIMITS[part]
    const Doc = optional ? ApiPropertyOptional : ApiProperty
    return applyDecorators(
        Doc({ type: Number, nullable, minimum: min, maximum: max }),
        ...(optional || nullable
            ? [ValidateIf((_: unknown, value: unknown) => value !== undefined && value !== null)]
            : []),
        IsInt(),
        Min(min),
        Max(max)
    )
}
