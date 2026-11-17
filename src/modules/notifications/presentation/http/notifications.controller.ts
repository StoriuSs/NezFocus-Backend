import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { ApiEnvelopeResponse, CurrentUser } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { validateAndTransform } from '@/shared/utils'
import { ListNotificationsQuery, MarkNotificationsReadCommand, NotificationList } from '../../application'
import {
    MarkNotificationsReadRequestDto,
    NotificationListQueryDto,
    NotificationListResponseDto,
    NotificationsReadResponseDto
} from './dto'

/** Items a page gives when the client names no `limit` (SRS 5.1). */
const DEFAULT_PAGE_SIZE = 50

/** The reader's inbox (SRS 5.1, REQ-NOTIF-01, S-NOTI-01). */
@ApiTags('notifications')
@ApiBearerAuth('bearer')
@Controller({ version: '1' })
export class NotificationsController {
    constructor(
        private readonly commandBus: CommandBus,
        private readonly queryBus: QueryBus
    ) {}

    /**
     * A page of the inbox, newest first, older than `before`, with how many
     * items are unread: only those of channels one views now (REQ-NOTIF-03).
     */
    @Get('me/notifications')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(NotificationListResponseDto)
    async list(
        @CurrentUser() user: AuthenticatedUser,
        @Query() { before, limit }: NotificationListQueryDto
    ): Promise<ServiceResponse<NotificationListResponseDto>> {
        const list: NotificationList = await this.queryBus.execute(
            new ListNotificationsQuery(user.id, before ?? null, limit ?? DEFAULT_PAGE_SIZE)
        )
        return createResponse(
            MESSAGES.NOTIFICATIONS.NOTIFICATIONS_LISTED,
            validateAndTransform(NotificationListResponseDto, list)
        )
    }

    /**
     * Marks items read (REQ-NOTIF-02): `ids`, or `all` up to `before_id`, the
     * newest shown. The channels stay unread as they were (D-99). Marking
     * twice changes nothing, so no Idempotency-Key.
     */
    @Post('me/notifications/read')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(NotificationsReadResponseDto)
    async markRead(
        @CurrentUser() user: AuthenticatedUser,
        @Body() { ids, all, beforeId }: MarkNotificationsReadRequestDto
    ): Promise<ServiceResponse<NotificationsReadResponseDto>> {
        const result: { unreadCount: number } = await this.commandBus.execute(
            new MarkNotificationsReadCommand(user.id, all ? { beforeId: beforeId! } : { ids: ids! })
        )
        return createResponse(
            MESSAGES.NOTIFICATIONS.NOTIFICATIONS_READ,
            validateAndTransform(NotificationsReadResponseDto, result)
        )
    }
}
