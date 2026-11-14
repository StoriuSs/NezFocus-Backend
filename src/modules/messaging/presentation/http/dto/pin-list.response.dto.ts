import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { ValidateNested } from 'class-validator'
import { PinnedMessageResponseDto } from './pinned-message.response.dto'

/** The pinned messages of a channel, the latest pinned first; at most 50 (REQ-MSG-07). */
export class PinListResponseDto {
    @Expose()
    @ApiProperty({ type: [PinnedMessageResponseDto] })
    @ValidateNested({ each: true })
    @Type(() => PinnedMessageResponseDto)
    items: PinnedMessageResponseDto[]
}
