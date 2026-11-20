import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { ApiEnvelopeResponse, CurrentUser } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { validateAndTransform } from '@/shared/utils'
import {
    DisconnectParticipantCommand,
    IssueJoinTokenCommand,
    JoinToken,
    LeaveVoiceCommand,
    MuteParticipantCommand,
    UnmuteParticipantCommand
} from '../../application'
import { JoinVoiceRequestDto, RoomParticipantParamsDto, VoiceTokenResponseDto } from './dto'

/**
 * Joining and leaving voice rooms (SRS 5.1, REQ-VC-01, VC-02), and what
 * moderators do to the people in them (REQ-VC-04). Who is in a room is not
 * answered here: it comes with the rooms in `GET /servers` and
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
     * another token. The token carries this request's sign-in session, whose
     * end puts the connection out (D-214).
     */
    @Post('token')
    @HttpCode(HttpStatus.CREATED)
    @ApiEnvelopeResponse(VoiceTokenResponseDto, HttpStatus.CREATED)
    async token(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: JoinVoiceRequestDto
    ): Promise<ServiceResponse<VoiceTokenResponseDto>> {
        const issued: JoinToken = await this.commandBus.execute(
            new IssueJoinTokenCommand(user.id, dto.channelId, user.sessionId)
        )
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

    /**
     * Turn someone's microphone off until they leave or are unmuted
     * (MUTE_MEMBERS, D-207); they are told `voice.muted`. A room one cannot
     * view, or someone not in it, NOT_FOUND; no MUTE_MEMBERS FORBIDDEN_ERROR;
     * timed out MEMBER_TIMED_OUT; someone ranked level or above, or oneself,
     * ROLE_HIERARCHY_VIOLATION; LiveKit unreachable SERVICE_UNAVAILABLE_ERROR.
     * Muted already: answered the same (D-212).
     */
    @Post('rooms/:channelId/participants/:userId/mute')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async mute(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { channelId, userId }: RoomParticipantParamsDto
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new MuteParticipantCommand(user.id, channelId, userId))
        return createResponse(MESSAGES.VOICE.PARTICIPANT_MUTED, null)
    }

    /** Let someone muted turn their microphone on again (MUTE_MEMBERS, D-207); the same answers as muting. */
    @Delete('rooms/:channelId/participants/:userId/mute')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async unmute(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { channelId, userId }: RoomParticipantParamsDto
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new UnmuteParticipantCommand(user.id, channelId, userId))
        return createResponse(MESSAGES.VOICE.PARTICIPANT_UNMUTED, null)
    }

    /**
     * Put someone out of the room (MOVE_MEMBERS, REQ-VC-04); they are told
     * `voice.disconnected` with reason `moderator` and may join again at
     * once. The same answers as muting.
     */
    @Delete('rooms/:channelId/participants/:userId')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async disconnect(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { channelId, userId }: RoomParticipantParamsDto
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new DisconnectParticipantCommand(user.id, channelId, userId))
        return createResponse(MESSAGES.VOICE.PARTICIPANT_DISCONNECTED, null)
    }
}
