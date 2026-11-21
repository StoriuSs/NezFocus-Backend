import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { ApiEnvelopeResponse, CurrentUser, Idempotent } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { validateAndTransform } from '@/shared/utils'
import { FocusSessionView, GetSoloSessionQuery, SoloSessionView, StartSoloSessionCommand } from '../../application'
import { FocusSessionResponseDto, SoloSessionResponseDto, StartSoloSessionRequestDto } from './dto'

/**
 * One's own study (SRS 5.1, REQ-STUDY-05): the Solo, started here and then
 * controlled through the routes of every session
 * (`/focus-sessions/{id}/pause|resume|skip|stop|config|continue`). Its
 * person hears each change as `solo_session.updated`.
 */
@ApiTags('study')
@ApiBearerAuth('bearer')
@Controller({ version: '1' })
export class MyStudyController {
    constructor(
        private readonly commandBus: CommandBus,
        private readonly queryBus: QueryBus
    ) {}

    /**
     * Start a Solo: its first focus phase runs from now. No cycle sent: the
     * last Solo's (D-103). One taking part in a session already (a Room
     * Session, or another Solo): FOCUS_SESSION_ACTIVE.
     */
    @Post('me/solo-session')
    @HttpCode(HttpStatus.CREATED)
    @ApiEnvelopeResponse(FocusSessionResponseDto, HttpStatus.CREATED)
    @Idempotent()
    async startSolo(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: StartSoloSessionRequestDto
    ): Promise<ServiceResponse<FocusSessionResponseDto>> {
        const session: FocusSessionView = await this.commandBus.execute(
            new StartSoloSessionCommand(user.id, {
                focusMinutes: dto.focusMinutes,
                shortBreakMinutes: dto.shortBreakMinutes,
                longBreakMinutes: dto.longBreakMinutes,
                longBreakEvery: dto.longBreakEvery
            })
        )
        return createResponse(MESSAGES.STUDY.SESSION_STARTED, validateAndTransform(FocusSessionResponseDto, session))
    }

    /** One's Solo not yet ended (a reload brings its clock back), and the cycle the next one starts with (D-229). */
    @Get('me/solo-session')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(SoloSessionResponseDto)
    async solo(@CurrentUser() user: AuthenticatedUser): Promise<ServiceResponse<SoloSessionResponseDto>> {
        const solo: SoloSessionView = await this.queryBus.execute(new GetSoloSessionQuery(user.id))
        return createResponse(MESSAGES.STUDY.SOLO_FETCHED, validateAndTransform(SoloSessionResponseDto, solo))
    }
}
