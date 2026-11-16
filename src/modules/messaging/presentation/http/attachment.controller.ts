import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { ApiEnvelopeResponse, CurrentUser } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { validateAndTransform } from '@/shared/utils'
import {
    AttachmentView,
    CompleteUploadCommand,
    GetAttachmentLinksQuery,
    RequestUploadCommand,
    UploadTicket
} from '../../application'
import { AttachmentIdParamsDto, AttachmentResponseDto, RequestUploadRequestDto, UploadTicketResponseDto } from './dto'
import { presentUploadTicket } from './attachment.presenter'

/**
 * Files for messages (REQ-MSG-04): the browser uploads each straight to the
 * storage with a form from here (D-165), then says it is done, and the
 * content is checked before the file can be sent (D-93).
 */
@ApiTags('messaging')
@ApiBearerAuth('bearer')
@Controller({ path: 'attachments', version: '1' })
export class AttachmentController {
    constructor(
        private readonly commandBus: CommandBus,
        private readonly queryBus: QueryBus
    ) {}

    /**
     * A form to upload one file for a channel, valid 15 minutes. Needs
     * SEND_MESSAGES and ATTACH_FILES there (a timeout says until when); the
     * name's extension must be of a type sent (UPLOAD_INVALID_TYPE, D-92,
     * D-177), the size at most 25 MB (UPLOAD_FILE_TOO_LARGE). At most 60
     * forms a minute per person (RATE_LIMIT_EXCEEDED, with Retry-After).
     */
    @Post()
    @HttpCode(HttpStatus.CREATED)
    @ApiEnvelopeResponse(UploadTicketResponseDto, HttpStatus.CREATED)
    async request(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: RequestUploadRequestDto
    ): Promise<ServiceResponse<UploadTicketResponseDto>> {
        const ticket: UploadTicket = await this.commandBus.execute(
            new RequestUploadCommand(user.id, dto.channelId, dto.filename, dto.size)
        )
        return createResponse(MESSAGES.MESSAGING.UPLOAD_READY, presentUploadTicket(ticket))
    }

    /**
     * The upload is done: its content is checked (D-93). Not what its name
     * says: the file is deleted (UPLOAD_INVALID_TYPE). Nothing uploaded yet:
     * UPLOAD_FILE_NOT_FOUND. Done once, it answers the same again.
     */
    @Post(':attachmentId/complete')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(AttachmentResponseDto)
    async complete(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { attachmentId }: AttachmentIdParamsDto
    ): Promise<ServiceResponse<AttachmentResponseDto>> {
        const file: AttachmentView = await this.commandBus.execute(new CompleteUploadCommand(user.id, attachmentId))
        return createResponse(MESSAGES.MESSAGING.UPLOAD_COMPLETED, validateAndTransform(AttachmentResponseDto, file))
    }

    /** New links to a file whose links ended: one in a channel the person views, or their own not sent yet. */
    @Get(':attachmentId/url')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(AttachmentResponseDto)
    async links(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { attachmentId }: AttachmentIdParamsDto
    ): Promise<ServiceResponse<AttachmentResponseDto>> {
        const file: AttachmentView = await this.queryBus.execute(new GetAttachmentLinksQuery(user.id, attachmentId))
        return createResponse(MESSAGES.MESSAGING.ATTACHMENT_LINKS, validateAndTransform(AttachmentResponseDto, file))
    }
}
