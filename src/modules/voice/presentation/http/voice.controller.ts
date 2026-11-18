import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { ApiEnvelopeResponse, CurrentUser } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { validateAndTransform } from '@/shared/utils'
import { IssueJoinTokenCommand, JoinToken, LeaveVoiceCommand } from '../../application'
import { JoinVoiceRequestDto, VoiceTokenResponseDto } from './dto'

/**
 * Joining and leaving voice rooms (SRS 5.1, REQ-VC-01, VC-02). Who is in a
 * room is not answered here: it comes with the rooms in `GET /servers` and
 * `voice_state.updated` (D-205).
 */
@ApiTags('voice')
@ApiBearerAuth('bearer')
@Controller({ path: 'voice', version: '1' })
export class VoiceController {
    constructor(private readonly commandBus: CommandBus) {}

    /**
     * A token to join a voice room (CONNECT), sending what SPEAK and VIDEO
     * allow (D-210). Being in another room puts one out of it first. A room
     * one may not view is NOT_FOUND; no CONNECT FORBIDDEN_ERROR; a timeout
     * MEMBER_TIMED_OUT with `timeout_until`; LiveKit unreachable
     * SERVICE_UNAVAILABLE_ERROR. Not `@Idempotent()`: a retry is simply
     * another token.
     */
    @Post('token')
    @HttpCode(HttpStatus.CREATED)
    @ApiEnvelopeResponse(VoiceTokenResponseDto, HttpStatus.CREATED)
    async token(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: JoinVoiceRequestDto
    ): Promise<ServiceResponse<VoiceTokenResponseDto>> {
        const issued: JoinToken = await this.commandBus.execute(new IssueJoinTokenCommand(user.id, dto.channelId))
        return createResponse(MESSAGES.VOICE.TOKEN_ISSUED, validateAndTransform(VoiceTokenResponseDto, issued))
    }

    /**
     * Leave the room one is in: out of LiveKit and off the room's list at
     * once. In no room: answered the same.
     */
    @Post('leave')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async leave(@CurrentUser() user: AuthenticatedUser): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new LeaveVoiceCommand(user.id))
        return createResponse(MESSAGES.VOICE.LEFT, null)
    }
}
