import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsOptional, ValidateNested } from 'class-validator'
import { CallMediaResponseDto } from './call-media.response.dto'
import { CallResponseDto } from './call.response.dto'

/** Joining a call's room (`POST /calls/{id}/join`, D-246): the call as it is, and a token while it is active. */
export class JoinCallResponseDto {
    /** The call now: a call ringing or over has no token, and its `status` says what became of it. */
    @Expose()
    @ValidateNested()
    @Type(() => CallResponseDto)
    call: CallResponseDto

    /** The token to join its room; null unless the call is `active`. */
    @Expose()
    @ApiProperty({ type: CallMediaResponseDto, nullable: true })
    @IsOptional()
    @ValidateNested()
    @Type(() => CallMediaResponseDto)
    media: CallMediaResponseDto | null
}
