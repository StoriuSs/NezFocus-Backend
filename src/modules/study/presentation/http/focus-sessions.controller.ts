import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { ApiEnvelopeResponse, CurrentUser, Idempotent } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { validateAndTransform } from '@/shared/utils'
import {
    ChangeFocusCycleCommand,
    ControlFocusSessionCommand,
    FocusSessionView,
    GetNextHostQuery,
    NextHostView,
    StartRoomSessionCommand
} from '../../application'
import { ControlAction } from '../../domain'
import {
    ChangeCycleRequestDto,
    ChannelIdParamsDto,
    FocusSessionIdParamsDto,
    FocusSessionResponseDto,
    NextHostResponseDto,
    SessionVersionRequestDto,
    StartRoomSessionRequestDto
} from './dto'

/**
 * Study sessions (SRS 5.1, REQ-STUDY-02, STUDY-03, STUDY-05, D-222):
 * starting one in a study room, and controlling it or a Solo (started at
 * POST /me/solo-session). Each answers the session as it is after, which
 * the room also hears as `focus_session.*` (its person, for a Solo, as
 * `solo_session.updated`). Another's Solo is NOT_FOUND (D-229). A room or session one may
 * not see is NOT_FOUND (NFR-SEC-05); one not allowed, FORBIDDEN with its
 * `reason`. A command sent with an old version changes nothing and answers
 * the session as it is (D-225).
 */
@ApiTags('study')
@ApiBearerAuth('bearer')
@Controller({ version: '1' })
export class FocusSessionsController {
    constructor(
        private readonly commandBus: CommandBus,
        private readonly queryBus: QueryBus
    ) {}

    /**
     * Start a Room Session, from inside the study room, as its Host: everyone
     * in the room takes part from now. A room with a session already:
     * FOCUS_SESSION_ACTIVE.
     */
    @Post('channels/:channelId/focus-session')
    @HttpCode(HttpStatus.CREATED)
    @ApiEnvelopeResponse(FocusSessionResponseDto, HttpStatus.CREATED)
    @Idempotent()
    async start(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { channelId }: ChannelIdParamsDto,
        @Body() dto: StartRoomSessionRequestDto
    ): Promise<ServiceResponse<FocusSessionResponseDto>> {
        const session: FocusSessionView = await this.commandBus.execute(
            new StartRoomSessionCommand(user.id, channelId, {
                focusMinutes: dto.focusMinutes,
                shortBreakMinutes: dto.shortBreakMinutes,
                longBreakMinutes: dto.longBreakMinutes,
                longBreakEvery: dto.longBreakEvery
            })
        )
        return createResponse(MESSAGES.STUDY.SESSION_STARTED, validateAndTransform(FocusSessionResponseDto, session))
    }

    /** Pause: what is left of the phase is kept (Host or MANAGE_STUDY_ROOMS). */
    @Post('focus-sessions/:sessionId/pause')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(FocusSessionResponseDto)
    pause(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { sessionId }: FocusSessionIdParamsDto,
        @Body() { version }: SessionVersionRequestDto
    ): Promise<ServiceResponse<FocusSessionResponseDto>> {
        return this.control(user, sessionId, 'pause', version)
    }

    /** Resume for what was left; with no Host, anyone in the room may (D-119). */
    @Post('focus-sessions/:sessionId/resume')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(FocusSessionResponseDto)
    resume(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { sessionId }: FocusSessionIdParamsDto,
        @Body() { version }: SessionVersionRequestDto
    ): Promise<ServiceResponse<FocusSessionResponseDto>> {
        return this.control(user, sessionId, 'resume', version)
    }

    /** Skip to the next phase now; skipped while paused, it stays paused. */
    @Post('focus-sessions/:sessionId/skip')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(FocusSessionResponseDto)
    skip(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { sessionId }: FocusSessionIdParamsDto,
        @Body() { version }: SessionVersionRequestDto
    ): Promise<ServiceResponse<FocusSessionResponseDto>> {
        return this.control(user, sessionId, 'skip', version)
    }

    /** Học tiếp of a waiting Solo: its next focus phase begins now (REQ-STUDY-05). Not waiting: nothing changes. */
    @Post('focus-sessions/:sessionId/continue')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(FocusSessionResponseDto)
    continue(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { sessionId }: FocusSessionIdParamsDto,
        @Body() { version }: SessionVersionRequestDto
    ): Promise<ServiceResponse<FocusSessionResponseDto>> {
        return this.control(user, sessionId, 'continue', version)
    }

    /** End the session for the whole room; each one's seconds come in `focus_session.ended` (D-49). */
    @Post('focus-sessions/:sessionId/stop')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(FocusSessionResponseDto)
    stop(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { sessionId }: FocusSessionIdParamsDto,
        @Body() { version }: SessionVersionRequestDto
    ): Promise<ServiceResponse<FocusSessionResponseDto>> {
        return this.control(user, sessionId, 'stop', version)
    }

    /** A new cycle, only while paused: the phase begins again at its new length, still paused (D-50). */
    @Post('focus-sessions/:sessionId/config')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(FocusSessionResponseDto)
    async config(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { sessionId }: FocusSessionIdParamsDto,
        @Body() dto: ChangeCycleRequestDto
    ): Promise<ServiceResponse<FocusSessionResponseDto>> {
        const cycle = {
            focusMinutes: dto.focusMinutes,
            shortBreakMinutes: dto.shortBreakMinutes,
            longBreakMinutes: dto.longBreakMinutes ?? null,
            longBreakEvery: dto.longBreakEvery ?? null
        }
        const session: FocusSessionView = await this.commandBus.execute(
            new ChangeFocusCycleCommand(user.id, sessionId, cycle, dto.version)
        )
        return createResponse(MESSAGES.STUDY.SESSION_UPDATED, validateAndTransform(FocusSessionResponseDto, session))
    }

    /**
     * Who would control the session if its Host left now, for the question
     * "Rời phòng?" (D-233): null when nobody present may start. Only its
     * Host asks; anyone else who sees the room is FORBIDDEN `not_host`.
     */
    @Get('focus-sessions/:sessionId/next-host')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(NextHostResponseDto)
    async nextHost(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { sessionId }: FocusSessionIdParamsDto
    ): Promise<ServiceResponse<NextHostResponseDto>> {
        const next: NextHostView | null = await this.queryBus.execute(new GetNextHostQuery(user.id, sessionId))
        return createResponse(
            MESSAGES.STUDY.NEXT_HOST_FETCHED,
            validateAndTransform(NextHostResponseDto, { nextHost: next })
        )
    }

    private async control(
        user: AuthenticatedUser,
        sessionId: string,
        action: ControlAction,
        version: number
    ): Promise<ServiceResponse<FocusSessionResponseDto>> {
        const session: FocusSessionView = await this.commandBus.execute(
            new ControlFocusSessionCommand(user.id, sessionId, action, version)
        )
        return createResponse(MESSAGES.STUDY.SESSION_UPDATED, validateAndTransform(FocusSessionResponseDto, session))
    }
}
