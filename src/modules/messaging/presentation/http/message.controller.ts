import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Patch } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { ApiEnvelopeResponse, CurrentUser } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { validateAndTransform } from '@/shared/utils'
import { DeleteMessageCommand, EditMessageCommand, MessageView } from '../../application'
import { EditMessageRequestDto, MessageIdParamsDto, MessageResponseDto } from './dto'

/**
 * One message, by its id (SRS 5.1, REQ-MSG-05): editing and deleting it. A
 * message one may not see, or a deleted one, is NOT_FOUND (NFR-SEC-05).
 */
@ApiTags('messaging')
@ApiBearerAuth('bearer')
@Controller({ path: 'messages/:messageId', version: '1' })
export class MessageController {
    constructor(private readonly commandBus: CommandBus) {}

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
}
