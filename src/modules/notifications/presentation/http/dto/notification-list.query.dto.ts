import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator'

/** The most items one page may ask for (SRS 5.1). */
export const NOTIFICATION_PAGE_MAX = 100

/** GET /me/notifications (SRS 5.1): newest first, older than `before`. */
export class NotificationListQueryDto {
    /** The oldest item the client holds; left out, the newest page. */
    @IsOptional()
    @IsUUID()
    before?: string

    /** 1-100; 50 when left out. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(NOTIFICATION_PAGE_MAX)
    limit?: number
}
