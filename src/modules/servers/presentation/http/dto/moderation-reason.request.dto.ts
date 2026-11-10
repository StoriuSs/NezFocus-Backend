import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, MaxLength } from 'class-validator'
import { REASON_MAX_LENGTH } from '../../../domain'

/*
 * Kick, ban, unban and timeout (REQ-ROLE-04, S-SET-03, S-SET-04). A reason is
 * only bounded here; trimmed and held to 512 in domain/moderation.ts
 * (VALIDATION_ERROR with `data.rule`).
 */

/** Room for spaces trimmed off. */
const TYPED_REASON_MAX = REASON_MAX_LENGTH * 4

/** An optional reason, shown to the one acted on (D-156 for a kick). */
export class ModerationReasonRequestDto {
    @ApiPropertyOptional({ type: String, nullable: true, maxLength: REASON_MAX_LENGTH })
    @IsOptional()
    @IsString()
    @MaxLength(TYPED_REASON_MAX)
    reason?: string | null
}
