import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger'
import { ApiEnvelopeResponse, CurrentUser } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { validateAndTransform } from '@/shared/utils'
import { AckChannelCommand, ListReadStatesQuery, ReadStateView } from '../../application'
import { AckChannelRequestDto, ChannelIdParamsDto, ReadStateListResponseDto, ReadStateResponseDto } from './dto'

/**
 * Unread and read (REQ-MSG-09, SRS 5.1): where the reader stands in every
 * channel when the app opens, and marking one read as they see it (D-46).
 * Other tabs and devices follow through `read_state.updated`.
 */
@ApiTags('messaging')
@ApiBearerAuth('bearer')
@Controller({ version: '1' })
export class ReadStateController {
    constructor(
        private readonly commandBus: CommandBus,
        private readonly queryBus: QueryBus
    ) {}

    /** Every channel the reader may view (text, and voice rooms' chat), with its unread and mentions counted up to 100. */
    @Get('me/read-states')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(ReadStateListResponseDto)
    async list(@CurrentUser() user: AuthenticatedUser): Promise<ServiceResponse<ReadStateListResponseDto>> {
        const items: ReadStateView[] = await this.queryBus.execute(new ListReadStatesQuery(user.id))
        return createResponse(
            MESSAGES.MESSAGING.READ_STATES_LISTED,
            validateAndTransform(ReadStateListResponseDto, { items })
        )
    }

    /**
     * Mark the channel read up to a message of it, or its newest; never back.
     * A channel one may not view, or a message not of it, is NOT_FOUND. Two
     * marks close together may be told back out of order: a client keeps the
     * state whose `last_read_id` is not behind the one it has (D-173).
     */
    @Post('channels/:channelId/ack')
    @HttpCode(HttpStatus.OK)
    @ApiBody({ type: AckChannelRequestDto, required: false })
    @ApiEnvelopeResponse(ReadStateResponseDto)
    async ack(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { channelId }: ChannelIdParamsDto,
        @Body() body: AckChannelRequestDto
    ): Promise<ServiceResponse<ReadStateResponseDto>> {
        const state: ReadStateView = await this.commandBus.execute(
            new AckChannelCommand(user.id, channelId, body.messageId ?? null)
        )
        return createResponse(MESSAGES.MESSAGING.CHANNEL_ACKED, validateAndTransform(ReadStateResponseDto, state))
    }
}
