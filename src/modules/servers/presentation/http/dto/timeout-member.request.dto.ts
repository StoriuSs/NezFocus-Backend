import { ApiProperty } from '@nestjs/swagger'
import { IsIn, ValidateIf } from 'class-validator'
import { TIMEOUT_SECONDS } from '../../../domain'
import { ModerationReasonRequestDto } from './moderation-reason.request.dto'

/**
 * PATCH /servers/{id}/members/{user_id}: time out for one of the six lengths
 * from now (a new length for a running one too), or end it with null.
 */
export class TimeoutMemberRequestDto extends ModerationReasonRequestDto {
    @ApiProperty({ type: Number, nullable: true, enum: TIMEOUT_SECONDS })
    @ValidateIf((_dto: object, value: unknown) => value !== null)
    @IsIn(TIMEOUT_SECONDS)
    timeoutSeconds: number | null
}
