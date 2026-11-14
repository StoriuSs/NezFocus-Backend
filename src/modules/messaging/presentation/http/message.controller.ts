import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Put } from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { ApiEnvelopeResponse, CurrentUser } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { validateAndTransform } from '@/shared/utils'
import {
    AddReactionCommand,
    DeleteMessageCommand,
    EditMessageCommand,
    ListReactorsQuery,
    MessageView,
    ReactorsView,
    RemoveReactionCommand
} from '../../application'
import {
    EditMessageRequestDto,
    MessageIdParamsDto,
    MessageResponseDto,
    ReactionParamsDto,
    ReactorsResponseDto
} from './dto'

/**
 * One message, by its id (SRS 5.1, REQ-MSG-05): editing and deleting it,
 * and its reactions. A message one may not see, or a deleted one, is
 * NOT_FOUND (NFR-SEC-05).
 */
@ApiTags('messaging')
@ApiBearerAuth('bearer')
@Controller({ path: 'messages/:messageId', version: '1' })
export class MessageController {
    constructor(
        private readonly commandBus: CommandBus,
        private readonly queryBus: QueryBus
    ) {}

    /**
     * New text for one's own message, while one may still post in the
     * channel; marked edited and told to the channel as `message.updated`.
     * Answers with the message as it now is (D-169).
     */
    @Patch()
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(MessageResponseDto)
    async edit(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { messageId }: MessageIdParamsDto,
        @Body() dto: EditMessageRequestDto
    ): Promise<ServiceResponse<MessageResponseDto>> {
        const message: MessageView = await this.commandBus.execute(
            new EditMessageCommand(user.id, messageId, dto.content)
        )
        return createResponse(MESSAGES.MESSAGING.MESSAGE_EDITED, validateAndTransform(MessageResponseDto, message))
    }

    /**
     * One's own message unless timed out, anyone's with MANAGE_MESSAGES; told
     * to the channel as `message.deleted`.
     */
    @Delete()
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async delete(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { messageId }: MessageIdParamsDto
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new DeleteMessageCommand(user.id, messageId))
        return createResponse(MESSAGES.MESSAGING.MESSAGE_DELETED, null)
    }

    /**
     * Give an emoji (one standard emoji, URL-encoded) to the message, told to
     * the channel as `reaction.added`; giving it again changes nothing. A new
     * emoji needs ADD_REACTIONS and room under 20; a timeout refuses
     * (SRS 1.71).
     */
    @Put('reactions/:emoji')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async react(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { messageId, emoji }: ReactionParamsDto
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new AddReactionCommand(user.id, messageId, emoji))
        return createResponse(MESSAGES.MESSAGING.REACTION_ADDED, null)
    }

    /** Take one's own emoji off, told as `reaction.removed`; one not given changes nothing. */
    @Delete('reactions/:emoji')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async unreact(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { messageId, emoji }: ReactionParamsDto
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new RemoveReactionCommand(user.id, messageId, emoji))
        return createResponse(MESSAGES.MESSAGING.REACTION_REMOVED, null)
    }

    /** The reaction's tooltip: the first three people to give the emoji, and how many did (SRS 1.71). */
    @Get('reactions/:emoji')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(ReactorsResponseDto)
    async reactors(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { messageId, emoji }: ReactionParamsDto
    ): Promise<ServiceResponse<ReactorsResponseDto>> {
        const reactors: ReactorsView = await this.queryBus.execute(new ListReactorsQuery(user.id, messageId, emoji))
        return createResponse(MESSAGES.MESSAGING.REACTORS_LISTED, validateAndTransform(ReactorsResponseDto, reactors))
    }
}
