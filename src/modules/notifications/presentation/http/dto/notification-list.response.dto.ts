import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsBoolean, IsInt, ValidateNested } from 'class-validator'
import { NotificationResponseDto } from './notification.response.dto'

/** A page of the inbox, newest first, with the badge's unread count (REQ-NOTIF-01). */
export class NotificationListResponseDto {
    @Expose()
    @ApiProperty({ type: [NotificationResponseDto] })
    @ValidateNested({ each: true })
    @Type(() => NotificationResponseDto)
    items: NotificationResponseDto[]

    /** Of the channels one views now, like the page. */
    @Expose()
    @IsInt()
    unreadCount: number

    @Expose()
    @IsBoolean()
    hasMore: boolean
}
