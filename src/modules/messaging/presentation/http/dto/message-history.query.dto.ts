import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator'
import { MESSAGE_PAGE_MAX } from '../../../domain'
import { AloneAmong } from './message-history.decorators'

/**
 * GET /channels/{id}/messages (SRS 5.1, D-48). At most one of `before`,
 * `after`, `around`; none: the newest messages.
 */
export class MessageHistoryQueryDto {
    /** Messages older than this id: scrolling up. */
    @IsOptional()
    @IsUUID()
    @AloneAmong(['after', 'around'])
    before?: string

    /** Messages newer than this id: catching up after a lost connection. */
    @IsOptional()
    @IsUUID()
    @AloneAmong(['before', 'around'])
    after?: string

    /** This message and those on both sides of it: opening a link to a message. */
    @IsOptional()
    @IsUUID()
    @AloneAmong(['before', 'after'])
    around?: string

    /** 1-100; 50 when left out. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(MESSAGE_PAGE_MAX)
    limit?: number
}
