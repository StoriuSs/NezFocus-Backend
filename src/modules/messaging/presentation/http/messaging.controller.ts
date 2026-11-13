import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { ApiEnvelopeResponse, CurrentUser, Idempotent } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { validateAndTransform } from '@/shared/utils'
import { ListMessagesQuery, MessagePageView, MessageView, SendMessageCommand } from '../../application'
import { MESSAGE_PAGE_DEFAULT, MessageCursor } from '../../domain'
import {
    ChannelIdParamsDto,
    MessageHistoryQueryDto,
    MessagePageResponseDto,
    MessageResponseDto,
    SendMessageRequestDto
} from './dto'

/** Where the page the query asks for starts. */
function cursorOf({ before, after, around }: MessageHistoryQueryDto): MessageCursor {
    if (before) return { kind: 'before', id: before }
    if (after) return { kind: 'after', id: after }
    if (around) return { kind: 'around', id: around }
    return { kind: 'latest' }
}

/**
 * The messages of a text channel (SRS 5.1): its history, page by page, and
 * sending one. Whoever may not view the channel gets NOT_FOUND (NFR-SEC-05).
 */
@ApiTags('messaging')
@ApiBearerAuth('bearer')
@Controller({ path: 'channels/:channelId/messages', version: '1' })
export class MessagingController {
    constructor(
        private readonly commandBus: CommandBus,
        private readonly queryBus: QueryBus
    ) {}

    /** A page of history, oldest first; the newest when no cursor is given (D-48). */
    @Get()
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(MessagePageResponseDto)
    async list(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { channelId }: ChannelIdParamsDto,
        @Query() query: MessageHistoryQueryDto
    ): Promise<ServiceResponse<MessagePageResponseDto>> {
        const page: MessagePageView = await this.queryBus.execute(
            new ListMessagesQuery(user.id, channelId, cursorOf(query), query.limit ?? MESSAGE_PAGE_DEFAULT)
        )
        return createResponse(MESSAGES.MESSAGING.MESSAGES_LISTED, validateAndTransform(MessagePageResponseDto, page))
    }

    /**
     * Send a message (REQ-MSG-01): SEND_MESSAGES, then the limits (REQ-MSG-10),
     * then saved and told to the channel as `message.created`. A nonce already
     * used answers with that message, told to no one again. `reply_to_id`
     * answers a regular message of the channel (REQ-MSG-05).
     */
    @Post()
    @HttpCode(HttpStatus.CREATED)
    @ApiEnvelopeResponse(MessageResponseDto, HttpStatus.CREATED)
    @Idempotent()
    async send(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { channelId }: ChannelIdParamsDto,
        @Body() dto: SendMessageRequestDto
    ): Promise<ServiceResponse<MessageResponseDto>> {
        const message: MessageView = await this.commandBus.execute(
            new SendMessageCommand(user.id, channelId, dto.content, dto.nonce, dto.replyToId ?? null)
        )
        return createResponse(MESSAGES.MESSAGING.MESSAGE_SENT, validateAndTransform(MessageResponseDto, message))
    }
}
