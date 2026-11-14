import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { ApiEnvelopeResponse, CurrentUser } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { validateAndTransform } from '@/shared/utils'
import { ListPinsQuery, PinMessageCommand, PinnedMessageView, UnpinMessageCommand } from '../../application'
import { ChannelIdParamsDto, PinListResponseDto, PinParamsDto } from './dto'

/**
 * The pins of a text channel (SRS 5.1, REQ-MSG-07): reading them, pinning and
 * unpinning one (MANAGE_MESSAGES). A channel one may not view, or a message
 * not of it, is NOT_FOUND (NFR-SEC-05).
 */
@ApiTags('messaging')
@ApiBearerAuth('bearer')
@Controller({ path: 'channels/:channelId/pins', version: '1' })
export class PinController {
    constructor(
        private readonly commandBus: CommandBus,
        private readonly queryBus: QueryBus
    ) {}

    /** The pinned messages, the latest pinned first, with their reactions as the reader sees them. */
    @Get()
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(PinListResponseDto)
    async list(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { channelId }: ChannelIdParamsDto
    ): Promise<ServiceResponse<PinListResponseDto>> {
        const items: PinnedMessageView[] = await this.queryBus.execute(new ListPinsQuery(user.id, channelId))
        return createResponse(MESSAGES.MESSAGING.PINS_LISTED, validateAndTransform(PinListResponseDto, { items }))
    }

    /**
     * Pin a regular message of the channel: told as `pins.updated`, with the
     * system message "<who> pinned a message" as `message.created`
     * (REQ-MSG-08). Pinning it again changes nothing; a 51st pin is
     * MAX_PINS_REACHED.
     */
    @Put(':messageId')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async pin(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { channelId, messageId }: PinParamsDto
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new PinMessageCommand(user.id, channelId, messageId))
        return createResponse(MESSAGES.MESSAGING.MESSAGE_PINNED, null)
    }

    /** Unpin it, told as `pins.updated`; no system message (SRS 1.71). */
    @Delete(':messageId')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async unpin(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { channelId, messageId }: PinParamsDto
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new UnpinMessageCommand(user.id, channelId, messageId))
        return createResponse(MESSAGES.MESSAGING.MESSAGE_UNPINNED, null)
    }
}
