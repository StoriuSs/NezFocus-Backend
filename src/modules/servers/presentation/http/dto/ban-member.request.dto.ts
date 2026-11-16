import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional } from 'class-validator'
import { DELETE_MESSAGE_DAYS } from '../../../domain'
import { ModerationReasonRequestDto } from './moderation-reason.request.dto'

/**
 * PUT /servers/{id}/bans/{user_id}: out of the server and kept out, and with
 * 1 or 7 days, their messages of those days deleted soon after (D-181).
 */
export class BanMemberRequestDto extends ModerationReasonRequestDto {
    /** How many days of their messages go: 0 (none, when left out), 1 or 7. */
    @ApiPropertyOptional({ type: Number, enum: DELETE_MESSAGE_DAYS, default: 0 })
    @IsOptional()
    @IsIn(DELETE_MESSAGE_DAYS)
    deleteMessageDays?: number
}
