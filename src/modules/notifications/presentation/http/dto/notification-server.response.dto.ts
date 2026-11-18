import { ApiProperty } from '@nestjs/swagger'
import { Expose } from 'class-transformer'
import { IsDate, IsIn, IsOptional, IsString } from 'class-validator'
import { ModerationAction } from '../../../domain'

const ACTIONS: ModerationAction[] = ['kick', 'ban', 'timeout']

/**
 * The server of an owner or moderation item as it was when the item was made
 * (spec 06 Q9): the client names it from here, as the server may be gone
 * from the person's list. A moderation item never says who acted (REQ-ROLE-04).
 */
export class NotificationServerResponseDto {
    /** The server's name then. */
    @Expose()
    @IsString()
    name: string

    /** `moderation`: put out, banned, or timed out (a new length too); null on `owner_transferred`. */
    @Expose()
    @ApiProperty({ enum: ACTIONS, nullable: true })
    @IsOptional()
    @IsIn(ACTIONS)
    action: ModerationAction | null

    /** A timeout: when it ends; null otherwise. */
    @Expose()
    @ApiProperty({ type: Date, nullable: true })
    @IsOptional()
    @IsDate()
    timeoutUntil: Date | null

    /** Why, when one was given (≤ 512 characters); null otherwise. */
    @Expose()
    @ApiProperty({ type: String, nullable: true })
    @IsOptional()
    @IsString()
    reason: string | null
}
