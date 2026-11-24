import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsBoolean, IsDate, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator'
import { CALL_END_REASONS, CALL_STATUSES, CallEndReason, CallStatus } from '../../../domain'
import { SocialPersonResponseDto } from './social-person.response.dto'

/**
 * A call as one of its two sees it (REQ-SOCIAL-05, D-242, D-245). A command
 * that came after it changed answers it as it is now: read `status`, not
 * only the HTTP code.
 */
export class CallResponseDto {
    @Expose()
    @IsString()
    id: string

    /** The DM it belongs to: its chat sits beside the call. */
    @Expose()
    @IsString()
    dmId: string

    @Expose()
    @IsString()
    callerId: string

    @Expose()
    @IsString()
    calleeId: string

    /** Started as a video call; either camera turns on or off at any time. */
    @Expose()
    @IsBoolean()
    video: boolean

    @Expose()
    @ApiProperty({ enum: CALL_STATUSES })
    @IsIn(CALL_STATUSES)
    status: CallStatus

    /** Why a call was missed: `no_answer` (45 seconds), `cancelled` (its caller hung up), `busy`; null otherwise. */
    @Expose()
    @ApiProperty({ enum: CALL_END_REASONS, nullable: true })
    @IsOptional()
    @IsIn(CALL_END_REASONS)
    endReason: CallEndReason | null

    /** The other one of the two, as I see them; nulls for an account deleted or waiting to be (D-182). */
    @Expose()
    @ValidateNested()
    @Type(() => SocialPersonResponseDto)
    user: SocialPersonResponseDto

    /** When it started ringing. */
    @Expose()
    @IsDate()
    createdAt: Date

    /** When it was answered: the call's clock counts from here (spec 09). */
    @Expose()
    @IsOptional()
    @IsDate()
    acceptedAt: Date | null

    @Expose()
    @IsOptional()
    @IsDate()
    endedAt: Date | null
}
