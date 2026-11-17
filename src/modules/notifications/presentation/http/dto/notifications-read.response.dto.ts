import { Expose } from 'class-transformer'
import { IsInt } from 'class-validator'

/** The unread count once marked: the badge (REQ-NOTIF-01). */
export class NotificationsReadResponseDto {
    @Expose()
    @IsInt()
    unreadCount: number
}
