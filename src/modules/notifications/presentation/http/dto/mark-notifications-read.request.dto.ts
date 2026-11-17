import { ApiPropertyOptional } from '@nestjs/swagger'
import { ArrayMaxSize, ArrayMinSize, Equals, IsArray, IsUUID, ValidateIf } from 'class-validator'
import { MAX_READ_IDS } from '../../../domain'

/**
 * POST /me/notifications/read (SRS 5.1, REQ-NOTIF-02): `ids`, up to 100
 * items; or `all: true` with `before_id`, the newest item shown, so one that
 * came after it stays unread.
 */
export class MarkNotificationsReadRequestDto {
    @ApiPropertyOptional({ type: [String] })
    @ValidateIf((dto: MarkNotificationsReadRequestDto) => dto.all === undefined)
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(MAX_READ_IDS)
    @IsUUID('all', { each: true })
    ids?: string[]

    @ApiPropertyOptional({ enum: [true] })
    @ValidateIf((dto: MarkNotificationsReadRequestDto) => dto.ids === undefined || dto.all !== undefined)
    @Equals(true)
    all?: true

    @ApiPropertyOptional()
    @ValidateIf((dto: MarkNotificationsReadRequestDto) => dto.all !== undefined)
    @IsUUID()
    beforeId?: string
}
