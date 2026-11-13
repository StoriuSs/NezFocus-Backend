import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { ApiEnvelopeResponse, CurrentUser } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { validateAndTransform } from '@/shared/utils'
import { IssueTicketCommand } from '@/modules/realtime/application'
import { RealtimeTicketResponseDto } from './dto'

/**
 * The ticket a socket connects with (SRS 5.2, D-13): bought with the access
 * token over REST, so the token never goes in the socket's URL.
 */
@ApiTags('realtime')
@ApiBearerAuth('bearer')
@Controller({ path: 'realtime', version: '1' })
export class RealtimeController {
    constructor(private readonly commandBus: CommandBus) {}

    /**
     * A ticket for this session, spendable once within 30 seconds. Not
     * `@Idempotent()`: it makes nothing that lasts, and a retry is simply
     * another ticket.
     */
    @Post('ticket')
    @HttpCode(HttpStatus.CREATED)
    @ApiEnvelopeResponse(RealtimeTicketResponseDto, HttpStatus.CREATED)
    async ticket(@CurrentUser() user: AuthenticatedUser): Promise<ServiceResponse<RealtimeTicketResponseDto>> {
        const issued: RealtimeTicketResponseDto = await this.commandBus.execute(
            new IssueTicketCommand(user.id, user.sessionId)
        )
        return createResponse(MESSAGES.REALTIME.TICKET_ISSUED, validateAndTransform(RealtimeTicketResponseDto, issued))
    }
}
